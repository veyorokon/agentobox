#!/usr/bin/env python3
"""
abox-relay: In-container relay process for Claude Code SDK integration.

Manages a Claude Code session via the Agent SDK and bridges events to the
Agentobox backend over WebSocket.

    WebSocket (ws://backend/ws/relay/<agent_id>/):
        auth:       Authorization header on WS upgrade (Bearer <relay_token>)
        upstream:   SDK messages → raw event dicts → ws.send(json)
        downstream: commands from backend (input, signal, mode) → SDK methods

The SDK spawns and manages the Claude Code CLI subprocess internally.
We monkey-patch the SDK's message parser to preserve the raw JSON dict from
stdout on every parsed message (as msg._raw). This lets us forward the exact
wire-format dicts the backend expects — no manual serialization, no field loss.

See the comment block above the monkey-patch for why this exists and when it can be removed.

Synthetic events (not from Claude):
    process_exit: {type: "system", subtype: "process_exit", exit_code, stderr}
        Emitted when the SDK client disconnects or the subprocess terminates.
"""

import asyncio
import json
import logging
import os
import signal
import sys
from urllib.parse import urlparse, urlunparse

import websockets
import websockets.exceptions

# ---------------------------------------------------------------------------
# SDK monkey-patch: preserve raw stdout dicts on parsed messages
# ---------------------------------------------------------------------------
#
# IMPORTANT: This patch MUST run BEFORE importing SDK classes (ClaudeSDKClient,
# etc.) because Python resolves `from .module import name` at import time.
# The SDK client does `from .message_parser import parse_message`, creating a
# direct name binding. If we import SDK classes first, the client already holds
# an unpatched reference and our patch has no effect. By patching first, we
# ensure the client picks up our wrapped version when it imports.
#
# We also patch the client module's local binding directly as a safety net,
# in case the SDK's import chain has already run (e.g., if websockets or
# another dep transitively imports the SDK).
#
# WHY THIS EXISTS:
#   The SDK parses each stdout JSON line into typed dataclasses (AssistantMessage,
#   ResultMessage, etc.) but drops fields the backend actively uses:
#     - modelUsage (cost tracking → SessionResult.model_usage)
#     - permission_denials (→ SessionResult.permission_denials)
#     - message.id (feed grouping in feed_transform.py)
#     - message.usage (token counts per message)
#     - session_id on AssistantMessage
#   Manually reconstructing these from typed fields is fragile (we'd have to
#   track every field the SDK might add/drop in future versions) and lossy.
#
# WHAT IT DOES:
#   Wraps the SDK's internal parse_message() to attach the original raw dict
#   as msg._raw on every successfully parsed message. Our _message_to_event()
#   then returns msg._raw directly — zero serialization, zero field loss.
#
# WHEN TO REMOVE:
#   If the SDK adds a built-in way to access the raw dict (e.g. a .raw or
#   .to_dict() method), or if it starts preserving all fields we need,
#   this patch can be replaced with that API. Check SDK changelog on upgrade.
#
# RISK:
#   Depends on claude_agent_sdk._internal.message_parser and
#   claude_agent_sdk._internal.client existing. If the SDK refactors its
#   internals, these imports will fail at startup — which is what we want
#   (loud failure, not silent data loss).
#
from claude_agent_sdk._internal import client as _client_mod
from claude_agent_sdk._internal import message_parser as _mp

_orig_parse = _mp.parse_message


def _parse_with_raw(data: dict):
    """Wrap SDK parse_message to attach the raw stdout dict to every message."""
    msg = _orig_parse(data)
    if msg is not None:
        msg._raw = data  # noqa: SLF001 — intentional private attr on SDK type
    return msg


# Patch both the module attribute AND the client's local binding.
# The module attribute catches future imports; the client binding catches
# the reference that was already resolved at import time.
_mp.parse_message = _parse_with_raw
_client_mod.parse_message = _parse_with_raw

# NOW import SDK classes — safe because the patch is already installed.
from claude_agent_sdk import (  # noqa: E402
    CLINotFoundError,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ProcessError,
    UserMessage,
)

class JSONFormatter(logging.Formatter):
    """JSON log formatter — zero dependencies, matches backend structlog output shape."""

    def format(self, record):
        entry = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0]:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


_handler = logging.StreamHandler(sys.stderr)
_handler.setFormatter(JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ"))
logging.root.addHandler(_handler)
logging.root.setLevel(logging.INFO)

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

# Close codes the backend sends that mean "stop retrying" — the problem is
# permanent and reconnecting won't help. Defined in consumers.py:
#   4001 = bad_token (auth failure)
#   4003 = forbidden
#   4004 = agent_not_found
WS_FATAL_CLOSE_CODES = {4001, 4003, 4004}


class FatalWSClose(Exception):
    """Backend rejected the connection with a non-retryable close code."""

    def __init__(self, code: int, reason: str = ""):
        self.code = code
        self.reason = reason
        super().__init__(f"Fatal WS close: code={code} reason={reason}")


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
        """Build WS URL from HTTP callback URL.

        Properly swaps scheme via urlparse rather than naive string replace.
        """
        parsed = urlparse(CALLBACK_URL)
        ws_scheme = "wss" if parsed.scheme == "https" else "ws"
        ws_parsed = parsed._replace(
            scheme=ws_scheme,
            path=f"/ws/relay/{AGENT_ID}/",
        )
        return urlunparse(ws_parsed)

    async def connect(self) -> bool:
        """Connect to the backend WS endpoint with Authorization header.

        Token is sent as an HTTP header on the WS upgrade request — same
        pattern as REST auth. Never appears in URLs, logs, or proxy traces.

        Raises FatalWSClose if the backend rejects with a non-retryable code
        (4001 bad token, 4003 forbidden, 4004 agent not found). Callers must
        not retry after FatalWSClose — the problem is permanent.
        """
        try:
            self.ws = await websockets.connect(
                self._ws_url(),
                additional_headers={
                    "Authorization": f"Bearer {RELAY_AUTH_TOKEN}",
                },
                ping_interval=20,
                ping_timeout=10,
            )
            self._connected = True
            self._reconnect_delay = WS_RECONNECT_DELAY_S
            log.info("WebSocket connected")
            return True
        except websockets.exceptions.InvalidStatus as exc:
            # HTTP-level rejection before upgrade completed (e.g. 403).
            code = exc.response.status_code if hasattr(exc, "response") else 0
            log.warning("WebSocket upgrade rejected: status=%s %s", code, exc)
            self._connected = False
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalWSClose(code, str(exc)) from exc
            return False
        except websockets.exceptions.ConnectionClosed as exc:
            # Server accepted the upgrade then immediately sent a close frame
            # (this is how our consumer rejects: accept() then close(code=4001)).
            code = exc.rcvd.code if exc.rcvd else 0
            reason = exc.rcvd.reason if exc.rcvd else ""
            log.warning("WebSocket closed during connect: code=%s reason=%s", code, reason)
            self._connected = False
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalWSClose(code, reason) from exc
            return False
        except Exception as exc:
            log.warning("WebSocket connect failed: %s", exc)
            self._connected = False
            return False

    async def reconnect(self) -> bool:
        """Reconnect with exponential backoff.

        Raises FatalWSClose if the backend rejects with a non-retryable code.
        Callers must catch FatalWSClose and stop retrying.
        """
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
        """Receive a command from the backend. Returns None on disconnect.

        Raises FatalWSClose if the connection was closed with a non-retryable
        code. JSON parse failures are logged but do NOT mark as disconnected —
        the WS connection is still alive, only the message was malformed.
        """
        if not self._connected or not self.ws:
            return None
        try:
            data = await self.ws.recv()
        except websockets.exceptions.ConnectionClosed as exc:
            code = exc.rcvd.code if exc.rcvd else 0
            reason = exc.rcvd.reason if exc.rcvd else ""
            log.warning("WS recv closed: code=%s reason=%s", code, reason)
            self._connected = False
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalWSClose(code, reason) from exc
            return None
        except Exception:
            self._connected = False
            return None

        try:
            return json.loads(data)
        except (json.JSONDecodeError, TypeError) as exc:
            log.warning("WS recv: malformed JSON (connection still alive): %s", exc)
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


class SDKRelay:
    """Main relay process.

    Manages a ClaudeSDKClient lifecycle, forwards SDK messages to the backend
    via WebSocket, and routes backend commands to SDK methods.

    The SDK handles subprocess spawning, stream parsing, signal routing, and
    session management internally. This class bridges SDK events to the
    backend's expected JSON dict format.
    """

    def __init__(self):
        self.client: ClaudeSDKClient | None = None
        self.session_id: str = ""
        self.restart_requested = False
        self.clear_requested = False
        self.next_permission_mode: str = ""
        self._exit_posted = False  # guards against double process_exit events
        self._stderr_lines: list[str] = []  # accumulated CLI stderr for exit event
        self._pending_input: dict | None = None  # buffered input from idle wait
        self.ws = WSTransport()

    def _build_options(self, resume_session_id: str = "", permission_mode: str = "") -> ClaudeAgentOptions:
        """Build SDK client options from relay environment variables.

        Reads the same env vars that lifecycle.py writes to .relay_env and
        translates them into ClaudeAgentOptions fields. Team agent flags
        (--agent-id, --agent-name, etc.) go through extra_args since the
        SDK doesn't expose them as first-class options.
        """
        agent_name = os.environ.get("AGENT_NAME", "")
        team_name = os.environ.get("TEAM_NAME", "")
        parent_session_id = os.environ.get("PARENT_SESSION_ID", "")
        model = os.environ.get("CLAUDE_MODEL", "")
        mcp_config = os.environ.get("MCP_CONFIG", "")

        # Team agent flags — not natively supported by SDK options.
        # Keys must NOT include "--" prefix — the SDK prepends it automatically.
        extra_args: dict[str, str | None] = {}
        if agent_name and team_name:
            extra_args["agent-id"] = f"{agent_name}@{team_name}"
            extra_args["agent-name"] = agent_name
            extra_args["team-name"] = team_name
            extra_args["agent-type"] = "general-purpose"
        if parent_session_id:
            extra_args["parent-session-id"] = parent_session_id

        perm = permission_mode if permission_mode else "bypassPermissions"

        return ClaudeAgentOptions(
            model=model or None,
            permission_mode=perm,
            resume=resume_session_id or None,
            include_partial_messages=True,
            cli_path="claude",
            cwd=os.getcwd(),
            # IS_SANDBOX=1 tells the Claude CLI this is a sandboxed container,
            # so it accepts bypassPermissions even when the user has sudo.
            # Without this, the CLI detects sudo capability and refuses to start.
            # See: https://github.com/anthropics/claude-code/issues/927
            #
            # DO NOT set CLAUDECODE=1 here — the CLI treats that as a nested
            # session marker and refuses to start ("cannot be launched inside
            # another Claude Code session"). The SDK sets its own entrypoint
            # env var (CLAUDE_CODE_ENTRYPOINT=sdk-py) internally.
            env={"IS_SANDBOX": "1"},
            extra_args=extra_args,
            mcp_servers=mcp_config if mcp_config else {},
            stderr=self._on_stderr,
        )

    def _on_stderr(self, line: str):
        """Capture CLI stderr for diagnostics.

        Lines are logged immediately AND accumulated so we can include
        the real stderr in the process_exit event (the SDK's ProcessError.stderr
        only gives a generic "Check stderr output for details" wrapper).
        """
        stripped = line.rstrip()
        if stripped:
            log.info("[claude-stderr] %s", stripped)
            self._stderr_lines.append(stripped)

    # ── Message serialization ──

    def _message_to_event(self, msg) -> dict | None:
        """Convert an SDK typed message to the raw JSON dict the backend expects.

        Thanks to the monkey-patch (see top of file), every parsed message
        carries msg._raw — the original dict from Claude's stdout. We forward
        that directly, preserving ALL fields (modelUsage, permission_denials,
        message.id, usage, etc.) without manual reconstruction.

        We still extract session_id for our own bookkeeping (restart/resume).

        UserMessage handling: Claude Code outputs two kinds of user messages:
          1. Text echoes of dashboard input (skip — we already store these)
          2. Tool results after executing a tool (forward — the frontend needs
             these to pair tool_use blocks with their outputs)
        """
        raw = getattr(msg, "_raw", None)
        if raw is None:
            # Monkey-patch didn't fire — this is a bug, not a normal case.
            # Log loudly so we notice and fix, rather than silently dropping.
            log.error(
                "Message missing _raw dict (monkey-patch failed?): type=%s",
                type(msg).__name__,
            )
            return None

        # Skip text-only user messages (echoes of dashboard input).
        # Forward user messages with tool_result content (tool execution outputs).
        if isinstance(msg, UserMessage):
            content = raw.get("message", {}).get("content", [])
            has_tool_result = isinstance(content, list) and any(
                isinstance(b, dict) and b.get("type") == "tool_result"
                for b in content
            )
            if not has_tool_result:
                return None

        # Track session_id from any message that carries it, so restart/clear
        # can resume the correct session.
        sid = raw.get("session_id", "")
        if sid:
            self.session_id = sid

        return raw

    # ── Event forwarding ──

    async def _send_event(self, event: dict):
        """Send an event to the backend via WS.

        If the send fails, attempt reconnect and retry once.
        If that also fails, log the error — no silent swallowing.
        Raises FatalWSClose if reconnect hits a non-retryable code.
        """
        sent = await self.ws.send(event)
        if sent:
            return

        log.warning("WS send failed, attempting reconnect")
        reconnected = await self.ws.reconnect()  # may raise FatalWSClose
        if reconnected:
            sent = await self.ws.send(event)
            if sent:
                return

        log.error("Event lost — WS send failed after reconnect: type=%s", event.get("type", "?"))

    async def _forward_messages(self):
        """Iterate SDK messages and forward each to the backend via WS.

        Runs until the SDK client disconnects, the subprocess exits, or
        the task is cancelled. ProcessError is caught to emit a synthetic
        process_exit event with the exit code and stderr.
        """
        msg_count = 0
        try:
            async for msg in self.client.receive_messages():
                msg_count += 1
                event = self._message_to_event(msg)
                if event:
                    await self._send_event(event)
            log.info("receive_messages iterator ended normally (forwarded %d messages)", msg_count)
        except ProcessError as e:
            log.warning("Claude exited: code=%s (after %d messages)", e.exit_code, msg_count)
            # Use accumulated stderr (from _on_stderr callback) over the
            # SDK's generic ProcessError.stderr which just says
            # "Check stderr output for details".
            real_stderr = "\n".join(self._stderr_lines) if self._stderr_lines else (e.stderr or "")
            await self._post_exit_event(e.exit_code or 1, real_stderr)
        except (asyncio.CancelledError, FatalWSClose):
            raise  # propagate — run loop handles these
        except Exception as e:
            log.error("Forward messages error: %s", e)
            await self._post_exit_event(1, str(e))

    # ── WS downstream: receive commands from backend ──

    async def _ws_downstream(self):
        """Listen for commands from the backend over WebSocket.

        Reconnects automatically on transient disconnect. Stops on fatal
        close codes (FatalWSClose) — retrying won't help if the backend
        rejected us for bad auth or missing agent.
        """
        while True:
            try:
                cmd = await self.ws.recv()
            except FatalWSClose:
                raise  # propagate to run loop

            if cmd is None:
                if not self.ws.connected:
                    log.warning("WS disconnected, attempting reconnect")
                    try:
                        if await self.ws.reconnect():
                            log.info("WS reconnected")
                    except FatalWSClose:
                        raise  # propagate to run loop
                continue

            await self._handle_command(cmd)

    async def _handle_command(self, cmd: dict):
        """Route a command from the backend to the appropriate SDK method.

        Command format is unchanged from the subprocess relay — only the
        routing target changes (SDK methods instead of process signals/stdin).
        """
        cmd_type = cmd.get("type", "")

        if cmd_type == "input":
            payload = cmd.get("payload")
            if payload and self.client:
                # Send the stream-json message via AsyncIterable so the SDK
                # writes the dict as-is to stdin (adding session_id if absent).
                async def _raw():
                    yield payload
                try:
                    await self.client.query(_raw())
                except Exception as e:
                    log.error("Query failed: %s", e)

        elif cmd_type == "signal":
            sig = cmd.get("signal", "")
            if not self.client:
                return
            if sig == "clear":
                log.info("Clear requested via WS")
                self.clear_requested = True
                await self.client.interrupt()
            elif sig == "restart":
                log.info("Restart requested via WS")
                self.restart_requested = True
                await self.client.interrupt()
            elif sig == "SIGINT":
                log.info("SIGINT requested via WS")
                await self.client.interrupt()

        elif cmd_type == "mode":
            mode = cmd.get("mode", "")
            if mode and self.client:
                log.info("Mode change via WS: %s", mode)
                self.next_permission_mode = mode
                self.restart_requested = True
                await self.client.interrupt()

    # ── Synthetic events ──

    async def _post_exit_event(self, exit_code: int, stderr: str):
        """Post synthetic process_exit event to the backend.

        Guarded by _exit_posted to prevent double emission — e.g. when
        ProcessError is caught in _forward_messages AND the run loop
        falls through to the normal exit path.
        """
        if self._exit_posted:
            return
        self._exit_posted = True
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

    # ── Signal handling ──

    def _on_signal(self, signum):
        """Handle SIGTERM/SIGINT by interrupting the SDK client.

        Both signals forward an interrupt to Claude (matching the old relay
        behavior). Claude wraps up gracefully, emits a ResultMessage, and
        the run loop decides whether to restart or exit.
        """
        log.info("Received %s, interrupting Claude", signal.Signals(signum).name)
        if self.client:
            asyncio.create_task(self.client.interrupt())

    # ── Main run loop ──

    async def run(self):
        """Entry point — manage SDK client lifecycle with restart/clear support.

        The loop structure mirrors the old subprocess relay:
        1. Connect to backend WS
        2. Create SDK client (spawns Claude subprocess internally)
        3. Run forward + downstream tasks concurrently
        4. On exit: check restart/clear flags, loop or break
        """
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self._on_signal, sig)

        resume_session_id = os.environ.get("RESUME_SESSION_ID", "")
        permission_mode = os.environ.get("PERMISSION_MODE", "")
        sdk_connect_failures = 0
        SDK_MAX_CONNECT_RETRIES = 3
        SDK_CONNECT_RETRY_DELAY_S = 5.0

        # Connect to backend — retry until connected, but bail on fatal codes
        try:
            connected = await self.ws.connect()
            while not connected:
                log.warning("WS not connected, retrying...")
                connected = await self.ws.reconnect()
        except FatalWSClose as exc:
            log.error("Backend rejected connection (code=%d): %s — not retrying", exc.code, exc.reason)
            return

        # Send relay_init diagnostic event through WS so backend has it
        # even if the container dies before we can inspect logs.
        init_diag = {
            "type": "system",
            "subtype": "relay_init",
            "agent_id": AGENT_ID,
            "env": {
                "CLAUDECODE": os.environ.get("CLAUDECODE", ""),
                "IS_SANDBOX": os.environ.get("IS_SANDBOX", ""),
                "CLAUDE_CODE_ENTRYPOINT": os.environ.get("CLAUDE_CODE_ENTRYPOINT", ""),
                "has_api_key": bool(ANTHROPIC_API_KEY),
            },
        }
        try:
            await self._send_event(init_diag)
        except FatalWSClose as exc:
            log.error("Backend rejected during init_diag (code=%d): %s", exc.code, exc.reason)
            return

        while True:
            options = self._build_options(resume_session_id, permission_mode)
            log.info("Starting SDK client (model=%s, resume=%s)", options.model, options.resume)

            try:
                self._stderr_lines.clear()
                log.info(
                    "Creating SDK client (cli_path=%s, cwd=%s, perm=%s, extra_args=%s)",
                    options.cli_path, options.cwd, options.permission_mode,
                    {k: v for k, v in (options.extra_args or {}).items()},
                )
                self.client = ClaudeSDKClient(options=options)
                log.info("SDK client created, calling connect()...")
                await self.client.connect()
                sdk_connect_failures = 0  # reset on success
            except CLINotFoundError:
                log.error("claude binary not found — cannot recover")
                await self._post_exit_event(127, "claude: command not found")
                break
            except ProcessError as e:
                real_stderr = "\n".join(self._stderr_lines) if self._stderr_lines else (e.stderr or str(e))
                log.error(
                    "SDK connect ProcessError: code=%s stderr=%s (captured %d stderr lines)",
                    e.exit_code, real_stderr, len(self._stderr_lines),
                )
                await self._post_exit_event(e.exit_code or 1, real_stderr)
                break
            except Exception as e:
                sdk_connect_failures += 1
                real_stderr = "\n".join(self._stderr_lines) if self._stderr_lines else str(e)
                log.error(
                    "SDK client connect failed (%d/%d): %s type=%s (captured %d stderr lines: %s)",
                    sdk_connect_failures, SDK_MAX_CONNECT_RETRIES,
                    e, type(e).__name__, len(self._stderr_lines), real_stderr[:500],
                )
                if sdk_connect_failures >= SDK_MAX_CONNECT_RETRIES:
                    log.error("SDK connect failed %d times, giving up", sdk_connect_failures)
                    await self._post_exit_event(1, real_stderr)
                    break
                delay = SDK_CONNECT_RETRY_DELAY_S * sdk_connect_failures
                log.info("Retrying SDK connect in %.1fs...", delay)
                await asyncio.sleep(delay)
                continue

            log.info("SDK client connected")

            # Two tasks: forward messages upstream, receive commands downstream
            forward_task = asyncio.create_task(self._forward_messages(), name="forward")
            downstream_task = asyncio.create_task(self._ws_downstream(), name="downstream")

            # Feed pending input from idle wait state. Must happen AFTER tasks
            # start so forward_task is already iterating receive_messages() and
            # will capture Claude's response.
            if self._pending_input:
                pending_payload = self._pending_input
                self._pending_input = None
                await self._handle_command({"type": "input", "payload": pending_payload})

            # Wait for the forward task to complete (Claude exits/disconnects).
            # The downstream task runs indefinitely until cancelled.
            done, pending = await asyncio.wait(
                [forward_task, downstream_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for t in pending:
                t.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

            # Check if any completed task died with a fatal WS close.
            # If so, stop the relay — retrying won't fix a permanent rejection.
            fatal = False
            for t in done:
                try:
                    exc = t.exception()
                except asyncio.CancelledError:
                    continue
                if isinstance(exc, FatalWSClose):
                    log.error(
                        "Backend rejected with fatal code=%d: %s — shutting down",
                        exc.code,
                        exc.reason,
                    )
                    fatal = True
                    break

            # Disconnect SDK client
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

            if fatal:
                break

            # Check restart/clear flags (set by _handle_command before interrupt)
            if self.clear_requested:
                self.clear_requested = False
                self.restart_requested = False
                self._exit_posted = False
                self._stderr_lines.clear()
                resume_session_id = ""
                self.session_id = ""
                log.info("Clear: respawning fresh (no resume)")
                continue

            if self.restart_requested:
                self.restart_requested = False
                self._exit_posted = False
                self._stderr_lines.clear()
                if self.session_id:
                    resume_session_id = self.session_id
                    log.info("Soft restart: resume %s", self.session_id)
                else:
                    log.info("Soft restart: no session_id, starting fresh")
                if self.next_permission_mode:
                    permission_mode = self.next_permission_mode
                    self.next_permission_mode = ""
                    log.info("Permission mode for next spawn: %s", permission_mode)
                self.session_id = ""
                continue

            # If process_exit was already posted (Claude crashed/errored in
            # _forward_messages), don't stay alive — agent is already ERROR/STOPPED.
            if self._exit_posted:
                break

            # Normal exit — Claude finished processing a turn. Stay alive and
            # wait for the next input from the backend. Team agents receive
            # multiple messages over their lifetime; the relay must persist
            # between turns. The agent is already IDLE (set by the result event
            # handler in stream.py).
            self._exit_posted = False
            self._stderr_lines.clear()
            if self.session_id:
                resume_session_id = self.session_id
            self.session_id = ""

            log.info("Claude finished turn, waiting for next input (resume=%s)", resume_session_id)

            idle_fatal = False
            while True:
                try:
                    cmd = await self.ws.recv()
                except FatalWSClose:
                    idle_fatal = True
                    break

                if cmd is None:
                    if not self.ws.connected:
                        log.warning("WS disconnected while idle, reconnecting")
                        try:
                            await self.ws.reconnect()
                        except FatalWSClose:
                            idle_fatal = True
                            break
                    continue

                cmd_type = cmd.get("type", "")
                log.info("Idle received command: type=%s", cmd_type)
                if cmd_type == "input":
                    self._pending_input = cmd.get("payload")
                    log.info("Idle: got input, will respawn SDK client")
                    break
                elif cmd_type == "signal":
                    sig = cmd.get("signal", "")
                    log.info("Idle: signal=%s", sig)
                    if sig == "clear":
                        resume_session_id = ""
                        break
                    elif sig == "restart":
                        break
                elif cmd_type == "mode":
                    mode = cmd.get("mode", "")
                    if mode:
                        permission_mode = mode
                        log.info("Idle: permission mode changed to %s", mode)
                        break

            if idle_fatal:
                break

            continue

        await self.ws.close()


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

    # Log env diagnostics at startup — these go to tmux pane AND
    # are visible in container logs before the container is cleaned up.
    diag_keys = ["AGENT_ID", "AGENT_NAME", "CLAUDECODE", "IS_SANDBOX",
                 "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
                 "ANTHROPIC_API_KEY", "CLAUDE_MODEL", "ABOX_CALLBACK_URL"]
    diag = {k: ("set" if k == "ANTHROPIC_API_KEY" and os.environ.get(k) else os.environ.get(k, ""))
            for k in diag_keys}
    log.info("abox-relay starting (agent=%s) env=%s", AGENT_ID, diag)

    relay = SDKRelay()
    try:
        asyncio.run(relay.run())
        log.info("Relay exiting cleanly")
        sys.exit(0)
    except Exception as e:
        log.error("Relay crashed: %s type=%s", e, type(e).__name__)
        sys.exit(1)


if __name__ == "__main__":
    main()
