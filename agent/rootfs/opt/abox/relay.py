#!/usr/bin/env python3
"""
abox-relay: In-container relay process for Claude Code stream-json integration.

Spawns Claude with --output-format stream-json, reads structured events from
stdout, batches them, and POSTs to the Agentobox backend. Receives pending
messages/signals via piggyback pattern in POST responses.

Two output paths:
    Batched (50-100ms): system, assistant, user, result events
        -> POST /agents/<id>/stream (persisted by backend)
    Real-time: stream_event (from --include-partial-messages)
        -> POST /agents/<id>/stream/live (ephemeral, WebSocket passthrough)

Synthetic events (not from Claude):
    process_exit: {type: "system", subtype: "process_exit", exit_code, stderr}
        Emitted when Claude process terminates. Includes exit code and
        captured stderr for crash diagnosis.

See: docs/ARCHITECTURE.md, "Relay Process"
See: docs/ARCHITECTURE.md, "Piggyback Pattern"
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

LOG_FORMAT = "[relay] %(asctime)s %(levelname)s %(message)s"
LOG_DATEFMT = "%H:%M:%S"
LOG_FILE = "/tmp/abox-relay.log"

logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    datefmt=LOG_DATEFMT,
)

# Add file handler so logs persist beyond tmux scroll buffer
_file_handler = logging.FileHandler(LOG_FILE)
_file_handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=LOG_DATEFMT))
logging.getLogger().addHandler(_file_handler)

log = logging.getLogger("abox-relay")

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

AGENT_ID = os.environ.get("AGENT_ID", "")
CALLBACK_URL = os.environ.get("ABOX_CALLBACK_URL", "").rstrip("/")
RELAY_AUTH_TOKEN = os.environ.get("RELAY_AUTH_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Relay tuning
BATCH_INTERVAL_S = 0.075  # 75ms batch window
HEARTBEAT_INTERVAL_S = 2.0
MAX_RETRY_DELAY_S = 30.0
RETRY_BASE_DELAY_S = 1.0
MAX_BATCH_SIZE = 2000

# ---------------------------------------------------------------------------
# Claude spawn command
# ---------------------------------------------------------------------------


def build_claude_cmd(resume_session_id: str = "") -> list[str]:
    """
    Build the Claude CLI command with stream-json flags and team agent flags.

    Args:
        resume_session_id: If non-empty, adds --resume <id> so Claude loads
            the prior session's messages. Used after soft restart to preserve
            conversation context. Preferred over --continue because --continue
            picks the most recent session on disk, which may be stale from a
            previous container lifecycle (volume-persisted .claude dir).

    Flag reference from docs/ARCHITECTURE.md, "All Spawn Flags".
    Team flags from env vars set by backend's _provision_agent().
    """
    cmd = [
        "claude", "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
    ]

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
# HTTP helpers (stdlib only — no external dependencies)
# ---------------------------------------------------------------------------


def post_events(events: list[dict]) -> dict | None:
    """
    POST a batch of Claude Code stream-json events to the backend.

    Events are the raw JSON objects from Claude's stdout, each with
    a `type` field: "system", "assistant", "user", or "result".

    Retries up to 3 times with exponential backoff on transient connection
    errors (URLError, OSError). Does not retry on JSON parse errors or
    HTTP 4xx responses.

    Returns piggyback response from backend:
        pending_input:  list of JSON messages to write to Claude's stdin
        pending_signal: Signal name to send to Claude process (or null)

    See: docs/ARCHITECTURE.md, "Piggyback Pattern"
    """
    if not CALLBACK_URL:
        return None

    url = f"{CALLBACK_URL}/agents/{AGENT_ID}/stream"
    body = json.dumps(events).encode()

    delay = RETRY_BASE_DELAY_S
    for attempt in range(3):
        req = Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        if RELAY_AUTH_TOKEN:
            req.add_header("X-Relay-Token", RELAY_AUTH_TOKEN)
        try:
            with urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except (URLError, OSError) as exc:
            log.warning("POST failed (attempt %d/3): %s", attempt + 1, exc)
            if attempt < 2:
                time.sleep(delay)
                delay = min(delay * 2, MAX_RETRY_DELAY_S)
        except json.JSONDecodeError as exc:
            log.warning("POST response parse failed: %s", exc)
            return None  # Don't retry JSON parse errors
    return None


# ---------------------------------------------------------------------------
# Main relay
# ---------------------------------------------------------------------------


class Relay:
    """
    Main relay process. Manages Claude subprocess lifecycle, stdout/stderr
    reading, event batching, backend communication, and piggyback delivery.
    """

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None
        self.session_id: str = ""
        self.stderr_output: str = ""
        self.batch: list[dict] = []
        self.batch_lock = asyncio.Lock()
        self.last_event_time: float = 0.0
        self.shutting_down = False
        self.restart_requested = False
        self.clear_requested = False

    async def run(self):
        """Entry point — spawn Claude with restart loop for soft restarts.

        On normal exit: flush events, post process_exit, return.
        On soft restart (pending_signal="restart"): respawn Claude with
        --resume <session_id> to preserve conversation context. MCP servers
        re-init from updated .mcp.json on restart.

        On first launch after a hard restart, RESUME_SESSION_ID env var
        carries the prior session_id so context is preserved across
        container reprovisioning.
        """
        # Check env for resume session from hard restart (container reprovision)
        resume_session_id = os.environ.get("RESUME_SESSION_ID", "")

        while True:
            cmd = build_claude_cmd(resume_session_id=resume_session_id)
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
                self._post_exit_event(127, "claude: command not found")
                return

            log.info("Claude started, pid=%d", self.proc.pid)

            tasks = [
                asyncio.create_task(self._read_stdout(), name="stdout"),
                asyncio.create_task(self._read_stderr(), name="stderr"),
                asyncio.create_task(self._batch_flusher(), name="flusher"),
                asyncio.create_task(self._heartbeat(), name="heartbeat"),
            ]

            await self.proc.wait()
            exit_code = self.proc.returncode
            log.info("Claude exited, code=%d", exit_code)

            # Give readers a moment to finish draining
            self.shutting_down = True
            await asyncio.sleep(0.2)

            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

            # Flush remaining events before deciding next action
            await self._flush_batch()

            if self.clear_requested:
                # Clear: wipe session and restart fresh (no --resume)
                self.clear_requested = False
                self.restart_requested = False
                resume_session_id = ""
                self.session_id = ""
                log.info("Clear: respawning fresh (no resume)")
                self.proc = None
                self.stderr_output = ""
                self.shutting_down = False
                continue

            if self.restart_requested:
                self.restart_requested = False
                if self.session_id:
                    resume_session_id = self.session_id
                    log.info("Soft restart: respawning with --resume %s", self.session_id)
                else:
                    log.info("Soft restart: no session_id captured, starting fresh")
                # Reset state for new subprocess
                self.proc = None
                self.stderr_output = ""
                self.shutting_down = False
                continue

            # Normal exit
            self._post_exit_event(exit_code, self.stderr_output)
            break

    async def _read_stdout(self):
        """
        Read Claude's stdout line-by-line. Each line is a JSON event.

        stream_event types (from --include-partial-messages) are forwarded
        immediately (not batched) for live typing display.
        All other types are collected into the batch buffer.

        See: docs/ARCHITECTURE.md, "Output Event Stream"
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

            # stream_event = real-time (not batched)
            if event.get("type") == "stream_event":
                # Fire-and-forget for live streaming — run in thread to avoid
                # blocking stdout reading during post_events retry backoff
                await asyncio.to_thread(post_events, [event])
            else:
                async with self.batch_lock:
                    self.batch.append(event)
                    self.last_event_time = time.monotonic()

    async def _read_stderr(self):
        """
        Read Claude's stderr and accumulate for process_exit event.
        Stderr contains errors/warnings not in the stream-json output.
        """
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
        self.stderr_output = "".join(chunks)[-4096:]  # Keep last 4KB

    async def _batch_flusher(self):
        """
        Flush batched events to backend every BATCH_INTERVAL_S (75ms).
        Only flushes if there are events in the buffer.
        """
        while not self.shutting_down:
            await asyncio.sleep(BATCH_INTERVAL_S)
            await self._flush_batch()

    async def _heartbeat(self):
        """
        Send empty heartbeat POST every HEARTBEAT_INTERVAL_S when idle
        to poll for pending input/signals via piggyback.

        See: docs/ARCHITECTURE.md, "Piggyback Pattern"
        """
        while not self.shutting_down:
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)
            # Only heartbeat if no recent events (flusher handles active periods)
            if time.monotonic() - self.last_event_time > HEARTBEAT_INTERVAL_S:
                resp = await asyncio.to_thread(post_events, [])
                if resp:
                    await self._handle_piggyback(resp)

    async def _flush_batch(self):
        """Flush the current event batch to the backend and handle piggyback response."""
        async with self.batch_lock:
            if not self.batch:
                return
            events = self.batch[:]
            self.batch.clear()

        resp = await asyncio.to_thread(post_events, events)
        if resp:
            await self._handle_piggyback(resp)
        elif events:
            # Re-enqueue on failure so events aren't lost
            async with self.batch_lock:
                self.batch = events + self.batch
                if len(self.batch) > MAX_BATCH_SIZE:
                    dropped = len(self.batch) - MAX_BATCH_SIZE
                    self.batch = self.batch[-MAX_BATCH_SIZE:]
                    log.warning("Batch overflow: dropped %d oldest events", dropped)

    async def _handle_piggyback(self, resp: dict):
        """
        Process piggyback response from backend POST.

        The backend includes pending_input (list of messages to write to stdin),
        pending_signal (signal to send to Claude) in every POST response.

        pending_input is a list because multiple send_message() calls may
        queue up between relay POSTs.

        See: docs/ARCHITECTURE.md, "Piggyback Pattern"
        """
        # Handle pending input messages
        pending_input = resp.get("pending_input")
        if pending_input and self.proc and self.proc.stdin:
            if isinstance(pending_input, list):
                for msg in pending_input:
                    await self._write_stdin(msg)
            elif isinstance(pending_input, dict):
                await self._write_stdin(pending_input)

        # Handle pending signal
        pending_signal = resp.get("pending_signal")
        if pending_signal == "clear" and self.proc:
            log.info(
                "Clear requested, sending SIGINT (pid=%d, session=%s)",
                self.proc.pid, self.session_id or "none",
            )
            self.clear_requested = True
            self.proc.send_signal(signal.SIGINT)
        elif pending_signal == "restart" and self.proc:
            log.info(
                "Restart requested, sending SIGINT (pid=%d, session=%s)",
                self.proc.pid, self.session_id or "none",
            )
            self.restart_requested = True
            self.proc.send_signal(signal.SIGINT)
        elif pending_signal == "SIGINT" and self.proc:
            log.info("Sending SIGINT to Claude (pid=%d)", self.proc.pid)
            self.proc.send_signal(signal.SIGINT)

    async def _write_stdin(self, msg: dict):
        """
        Write a JSON message to Claude's stdin.

        Input must follow the stream-json input format:
            {"type": "user", "message": {"role": "user", "content": [...]}}

        See: docs/ARCHITECTURE.md, "Input Format"
        """
        if not self.proc or not self.proc.stdin:
            log.warning("Cannot write to stdin — process not running")
            return
        line = json.dumps(msg) + "\n"
        self.proc.stdin.write(line.encode())
        await self.proc.stdin.drain()
        log.info("Wrote to stdin: type=%s", msg.get("type", "?"))

    def _post_exit_event(self, exit_code: int, stderr: str):
        """
        Post synthetic process_exit event to backend.

        This event is NOT from Claude's stream-json output — it's created
        by the relay when the Claude process terminates.

        Schema:
            {type: "system", subtype: "process_exit", exit_code, stderr,
             session_id, agent_id}

        See: docs/ARCHITECTURE.md, "system/process_exit"
        """
        event = {
            "type": "system",
            "subtype": "process_exit",
            "exit_code": exit_code,
            "stderr": stderr[:4096],
            "session_id": self.session_id,
            "agent_id": AGENT_ID,
        }
        log.info("Posting process_exit (code=%d)", exit_code)
        post_events([event])


# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------


def setup_signal_handlers(relay: Relay):
    """Forward SIGTERM/SIGINT to Claude for graceful shutdown."""
    loop = asyncio.get_event_loop()

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
        log.warning("ABOX_CALLBACK_URL not set — events will not be forwarded")

    log.info("abox-relay starting (agent=%s)", AGENT_ID)

    relay = Relay()
    setup_signal_handlers(relay)
    asyncio.run(relay.run())

    exit_code = relay.proc.returncode if relay.proc else 1
    log.info("Relay exiting (claude exit_code=%s)", exit_code)
    sys.exit(0 if exit_code == 0 else 1)


if __name__ == "__main__":
    main()
