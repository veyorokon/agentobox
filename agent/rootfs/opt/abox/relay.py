#!/usr/bin/env python3
"""
abox-relay: In-container relay process for Claude Code stream-json integration.

Spawns Claude with --output-format stream-json, reads structured events from
stdout, and sends them to the Agentobox backend over WebSocket.

    WebSocket (ws://backend/ws/relay/<agent_id>/?token=<relay_token>):
        upstream:   every stdout line from Claude → ws.send(json) verbatim
        downstream: commands from backend (input, signal, mode) → route to stdin/process

This relay is a DUMB PIPE. It forwards ALL stream-json events without filtering,
batching, or transformation. The backend decides what to store and how to process it.

Why no filtering: every event type Anthropic adds to stream-json is automatically
captured without relay code changes. Thinking content, tool progress, rate limits,
content deltas — all forwarded verbatim.

Why no batching: WebSockets have no per-message overhead worth batching for.
Events flow at wire speed.

Synthetic events (not from Claude):
    process_exit: {type: "system", subtype: "process_exit", exit_code, stderr}
        Emitted when Claude process terminates.
"""

import asyncio
import json
import logging
import os
import signal
import sys

import websockets

LOG_FORMAT = "[relay] %(asctime)s %(levelname)s %(message)s"
LOG_DATEFMT = "%H:%M:%S"

logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    datefmt=LOG_DATEFMT,
)

log = logging.getLogger("abox-relay")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

AGENT_ID = os.environ.get("AGENT_ID", "")
CALLBACK_URL = os.environ.get("ABOX_CALLBACK_URL", "").rstrip("/")
RELAY_AUTH_TOKEN = os.environ.get("RELAY_AUTH_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# WebSocket reconnect
WS_RECONNECT_DELAY_S = 1.0
WS_MAX_RECONNECT_DELAY_S = 30.0

# ---------------------------------------------------------------------------
# Claude spawn command
# ---------------------------------------------------------------------------


def build_claude_cmd(resume_session_id: str = "", permission_mode: str = "") -> list[str]:
    """Build the Claude CLI command with stream-json flags and team agent flags."""
    cmd = [
        "claude", "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
    ]

    if permission_mode:
        cmd.extend(["--permission-mode", permission_mode])
    else:
        cmd.append("--dangerously-skip-permissions")

    if resume_session_id:
        cmd.extend(["--resume", resume_session_id])

    agent_name = os.environ.get("AGENT_NAME", "")
    team_name = os.environ.get("TEAM_NAME", "")
    parent_session_id = os.environ.get("PARENT_SESSION_ID", "")
    model = os.environ.get("CLAUDE_MODEL", "claude-opus-4-6")

    if agent_name and team_name:
        cmd.extend([
            "--agent-id", f"{agent_name}@{team_name}",
            "--agent-name", agent_name,
            "--team-name", team_name,
            "--agent-type", "general-purpose",
        ])
    if parent_session_id:
        cmd.extend(["--parent-session-id", parent_session_id])
    if model:
        cmd.extend(["--model", model])

    mcp_config = os.environ.get("MCP_CONFIG", "")
    if mcp_config:
        cmd.extend(["--mcp-config", mcp_config])

    return cmd


# ---------------------------------------------------------------------------
# WebSocket transport
# ---------------------------------------------------------------------------


class WSTransport:
    """WebSocket connection to the backend relay endpoint.

    Handles connect, reconnect, send, and receive. No fallback —
    if WS is down, events are lost until reconnection succeeds.
    """

    def __init__(self):
        self.ws = None
        self._connected = False
        self._reconnect_delay = WS_RECONNECT_DELAY_S

    def _ws_url(self) -> str:
        """Build WS URL from HTTP callback URL."""
        base = CALLBACK_URL.replace("http://", "ws://").replace("https://", "wss://")
        return f"{base}/ws/relay/{AGENT_ID}/?token={RELAY_AUTH_TOKEN}"

    async def connect(self) -> bool:
        """Connect to the backend WS endpoint. Returns True on success."""
        try:
            self.ws = await websockets.connect(
                self._ws_url(),
                ping_interval=20,
                ping_timeout=10,
            )
            self._connected = True
            self._reconnect_delay = WS_RECONNECT_DELAY_S
            log.info("WebSocket connected")
            return True
        except Exception as exc:
            log.warning("WebSocket connect failed: %s", exc)
            self._connected = False
            return False

    async def reconnect(self) -> bool:
        """Reconnect with exponential backoff."""
        await asyncio.sleep(self._reconnect_delay)
        self._reconnect_delay = min(self._reconnect_delay * 2, WS_MAX_RECONNECT_DELAY_S)
        return await self.connect()

    async def send(self, event: dict) -> bool:
        """Send an event via WS. Returns False if WS is unavailable."""
        if not self._connected or not self.ws:
            return False
        try:
            await self.ws.send(json.dumps(event))
            return True
        except Exception:
            self._connected = False
            return False

    async def recv(self) -> dict | None:
        """Receive a command from the backend. Returns None on disconnect."""
        if not self._connected or not self.ws:
            return None
        try:
            data = await self.ws.recv()
            return json.loads(data)
        except Exception:
            self._connected = False
            return None

    @property
    def connected(self) -> bool:
        return self._connected

    async def close(self):
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self._connected = False


# ---------------------------------------------------------------------------
# Main relay
# ---------------------------------------------------------------------------


class Relay:
    """Main relay process. Manages Claude lifecycle, event forwarding, and command routing."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None
        self.session_id: str = ""
        self.stderr_output: str = ""
        self.shutting_down = False
        self.restart_requested = False
        self.clear_requested = False
        self.next_permission_mode: str = ""
        self.ws = WSTransport()

    async def run(self):
        """Entry point — spawn Claude with restart loop for soft restarts."""
        resume_session_id = os.environ.get("RESUME_SESSION_ID", "")
        permission_mode = os.environ.get("PERMISSION_MODE", "")

        # Connect to backend — retry until connected
        connected = await self.ws.connect()
        while not connected:
            log.warning("WS not connected, retrying...")
            connected = await self.ws.reconnect()

        while True:
            cmd = build_claude_cmd(
                resume_session_id=resume_session_id,
                permission_mode=permission_mode,
            )
            log.info("Spawning: %s", " ".join(cmd))

            try:
                self.proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={**os.environ, "CLAUDECODE": "1"},
                )
            except FileNotFoundError:
                log.error("claude binary not found")
                await self._post_exit_event(127, "claude: command not found")
                return

            log.info("Claude started, pid=%d", self.proc.pid)

            tasks = [
                asyncio.create_task(self._read_stdout(), name="stdout"),
                asyncio.create_task(self._read_stderr(), name="stderr"),
                asyncio.create_task(self._ws_downstream(), name="ws_downstream"),
            ]

            await self.proc.wait()
            exit_code = self.proc.returncode
            log.info("Claude exited, code=%d", exit_code)

            self.shutting_down = True
            await asyncio.sleep(0.2)

            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

            if self.clear_requested:
                self.clear_requested = False
                self.restart_requested = False
                resume_session_id = ""
                self.session_id = ""
                log.info("Clear: respawning fresh (no resume)")
                self._reset_state()
                continue

            if self.restart_requested:
                self.restart_requested = False
                if self.session_id:
                    resume_session_id = self.session_id
                    log.info("Soft restart: respawning with --resume %s", self.session_id)
                else:
                    log.info("Soft restart: no session_id, starting fresh")
                if self.next_permission_mode:
                    permission_mode = self.next_permission_mode
                    self.next_permission_mode = ""
                    log.info("Permission mode for next spawn: %s", permission_mode)
                self.session_id = ""
                self._reset_state()
                continue

            # Normal exit
            await self._post_exit_event(exit_code, self.stderr_output)
            break

        await self.ws.close()

    def _reset_state(self):
        """Reset state between Claude respawns."""
        self.proc = None
        self.stderr_output = ""
        self.shutting_down = False

    async def _send_event(self, event: dict):
        """Send an event to the backend via WS.

        If the send fails, attempt reconnect and retry once.
        If that also fails, log the error — no silent swallowing.
        """
        sent = await self.ws.send(event)
        if sent:
            return

        # WS failed — try reconnect once
        log.warning("WS send failed, attempting reconnect")
        reconnected = await self.ws.reconnect()
        if reconnected:
            sent = await self.ws.send(event)
            if sent:
                return

        log.error("Event lost — WS send failed after reconnect: type=%s", event.get("type", "?"))

    async def _read_stdout(self):
        """Read Claude stdout line-by-line, forward each event verbatim.

        No filtering. No batching. Every line goes straight to the backend.
        The relay is a dumb pipe.
        """
        assert self.proc and self.proc.stdout
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                continue
            try:
                event = json.loads(text)
            except json.JSONDecodeError:
                log.debug("Non-JSON stdout: %s", text[:200])
                continue

            # Capture session_id from first event
            if not self.session_id and "session_id" in event:
                self.session_id = event["session_id"]
                log.info("Session ID: %s", self.session_id)

            await self._send_event(event)

    async def _read_stderr(self):
        """Read Claude stderr for crash diagnostics."""
        assert self.proc and self.proc.stderr
        chunks = []
        while True:
            data = await self.proc.stderr.read(4096)
            if not data:
                break
            text = data.decode("utf-8", errors="replace")
            chunks.append(text)
            if text.strip():
                log.warning("Claude stderr: %s", text.strip()[:500])
        self.stderr_output = "".join(chunks)[-4096:]

    # ── WS downstream: receive commands from backend ──

    async def _ws_downstream(self):
        """Listen for commands from the backend over WebSocket."""
        while not self.shutting_down:
            cmd = await self.ws.recv()
            if cmd is None:
                # Disconnected — try reconnect
                log.warning("WS disconnected, attempting reconnect")
                reconnected = await self.ws.reconnect()
                if not reconnected:
                    log.error("WS reconnect failed — downstream commands will not be received")
                    # Keep trying in the background
                    while not self.shutting_down:
                        await asyncio.sleep(WS_RECONNECT_DELAY_S)
                        if await self.ws.reconnect():
                            log.info("WS reconnected")
                            break
                continue

            await self._handle_command(cmd)

    async def _handle_command(self, cmd: dict):
        """Route a command from the backend to the appropriate action."""
        cmd_type = cmd.get("type", "")

        if cmd_type == "input":
            payload = cmd.get("payload")
            if payload and self.proc and self.proc.stdin:
                await self._write_stdin(payload)

        elif cmd_type == "signal":
            sig = cmd.get("signal", "")
            if sig == "clear" and self.proc:
                log.info("Clear requested via WS")
                self.clear_requested = True
                self.proc.send_signal(signal.SIGINT)
            elif sig == "restart" and self.proc:
                log.info("Restart requested via WS")
                self.restart_requested = True
                self.proc.send_signal(signal.SIGINT)
            elif sig == "SIGINT" and self.proc:
                log.info("SIGINT requested via WS")
                self.proc.send_signal(signal.SIGINT)

        elif cmd_type == "mode":
            mode = cmd.get("mode", "")
            if mode and self.proc:
                log.info("Mode change via WS: %s", mode)
                self.next_permission_mode = mode
                self.restart_requested = True
                self.proc.send_signal(signal.SIGINT)

    # ── Shared helpers ──

    async def _write_stdin(self, msg: dict):
        """Write a JSON message to Claude's stdin."""
        if not self.proc or not self.proc.stdin:
            log.warning("Cannot write to stdin — process not running")
            return
        line = json.dumps(msg) + "\n"
        self.proc.stdin.write(line.encode())
        await self.proc.stdin.drain()
        log.info("Wrote to stdin: type=%s", msg.get("type", "?"))

    async def _post_exit_event(self, exit_code: int, stderr: str):
        """Post synthetic process_exit event."""
        event = {
            "type": "system",
            "subtype": "process_exit",
            "exit_code": exit_code,
            "stderr": stderr[:4096],
            "session_id": self.session_id,
            "agent_id": AGENT_ID,
        }
        log.info("Posting process_exit (code=%d)", exit_code)
        await self._send_event(event)


# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------


def setup_signal_handlers(relay: Relay):
    """Forward SIGTERM/SIGINT to Claude for graceful shutdown."""
    def handler(signum, _frame):
        sig_name = signal.Signals(signum).name
        log.info("Received %s, forwarding SIGINT to Claude", sig_name)
        if relay.proc and relay.proc.returncode is None:
            relay.proc.send_signal(signal.SIGINT)

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    if not AGENT_ID:
        log.error("AGENT_ID not set")
        sys.exit(1)
    if not CALLBACK_URL:
        log.error("ABOX_CALLBACK_URL not set — cannot connect to backend")
        sys.exit(1)

    log.info("abox-relay starting (agent=%s)", AGENT_ID)

    relay = Relay()
    setup_signal_handlers(relay)
    asyncio.run(relay.run())

    exit_code = relay.proc.returncode if relay.proc else 1
    log.info("Relay exiting (claude exit_code=%s)", exit_code)
    sys.exit(0 if exit_code == 0 else 1)


if __name__ == "__main__":
    main()
