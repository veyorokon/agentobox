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
import time
from collections import deque
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
#   .to_dict() method on message types), this patch can be replaced.
#   Check SDK changelog on upgrade.
#
#   Last checked: v0.1.44 (2026-03-01) — to_dict() exists only on
#   PermissionUpdate, NOT on message types (UserMessage, AssistantMessage,
#   ResultMessage, SystemMessage). Monkey-patch still required.
#   Pinned version: v0.1.39 in Dockerfile.debian.
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


# tech-debt: SDK monkey-patch — attaches _raw dict to parsed messages. Remove when SDK adds .to_dict() on message types.
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
    PermissionResultAllow,
    PermissionResultDeny,
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
            "agent_id": os.environ.get("AGENT_ID", ""),
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

# Mode mapping: backend sends our vocabulary, relay translates to SDK format.
# The backend never touches Claude Code wire format for live commands.
_MODE_MAP = {
    "auto": "bypassPermissions",
    "plan": "plan",
    "supervised": "default",
}

# WebSocket reconnect
WS_RECONNECT_DELAY_S = 1.0
WS_MAX_RECONNECT_DELAY_S = 30.0

# Close codes the backend sends that mean "stop retrying" — the problem is
# permanent and reconnecting won't help. Defined in consumers.py:
#   4001 = bad_token (auth failure)
#   4003 = forbidden
#   4004 = agent_not_found
WS_FATAL_CLOSE_CODES = {4001, 4003, 4004}


# Critical event types that must not be silently dropped.
# "system" includes process_exit subtype (agent lifecycle).
# "result" includes cost/usage data (session_cost_usd).
CRITICAL_EVENT_TYPES = {"result", "system"}


class _Redactor:
    """Scrub known secret values from outbound event data.

    Loads secret values from /run/secrets/ and the relay env at boot.
    Applied to every event before WS send — prevents accidental credential
    exposure in dashboard output. UX safety net, not a security boundary.
    """

    def __init__(self):
        self._secrets: list[str] = []

    def load(self):
        """Read secret values from /run/secrets/ files + env."""
        secrets_dir = "/run/secrets"
        if os.path.isdir(secrets_dir):
            for name in os.listdir(secrets_dir):
                path = os.path.join(secrets_dir, name)
                if os.path.isfile(path):
                    try:
                        val = open(path).read().strip()
                        if len(val) >= 8:
                            self._secrets.append(val)
                    except PermissionError:
                        log.warning("redactor.skip_secret path=%s reason=permission_denied", path)
        # Also redact secrets from mounted env file if readable
        env_file = "/mnt/abox-state/secrets/env"
        if os.path.isfile(env_file):
            try:
                for line in open(env_file):
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        val = line.split("=", 1)[1].strip().strip("'\"")
                        if len(val) >= 8:
                            self._secrets.append(val)
            except PermissionError:
                log.warning("redactor.skip_env_file path=%s reason=permission_denied", env_file)
        # Sort longest first so longer secrets are replaced before substrings
        self._secrets.sort(key=len, reverse=True)
        if self._secrets:
            log.info("Redactor loaded %d secret(s)", len(self._secrets))

    def redact(self, text: str) -> str:
        """Replace known secret values with [REDACTED]."""
        for secret in self._secrets:
            if secret in text:
                text = text.replace(secret, "[REDACTED]")
        return text

    def redact_event(self, event: dict) -> dict:
        """Deep-redact string values in an event dict.

        Walks the dict recursively and replaces secret substrings in every
        string value. Operates on Python objects, not JSON text — avoids
        the json.dumps→replace→json.loads pattern which breaks when secrets
        contain JSON syntax characters (quotes, backslashes).
        """
        if not self._secrets:
            return event
        return self._redact_obj(event)

    def _redact_obj(self, obj):
        """Recursively redact secrets from any JSON-compatible object."""
        if isinstance(obj, str):
            return self.redact(obj)
        if isinstance(obj, dict):
            return {k: self._redact_obj(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self._redact_obj(v) for v in obj]
        return obj


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
                max_size=16 * 2**20,  # 16MB — computer-use screenshots are 2-5MB base64
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
        self._pending_callbacks: dict[str, asyncio.Future] = {}  # request_id → Future
        self._event_buffer: deque[dict] = deque(maxlen=20)  # bounded ring buffer for critical events
        self.ws = WSTransport()
        self._redactor = _Redactor()
        self._redactor.load()

    @staticmethod
    def _build_sdk_env() -> dict[str, str]:
        """Build env dict for the SDK subprocess.

        Always sets IS_SANDBOX=1. When ANTHROPIC_BASE_URL is set (proxy mode),
        forwards it so the CC CLI sends API requests through the localhost
        proxy instead of directly to api.anthropic.com.
        """
        env: dict[str, str] = {"IS_SANDBOX": "1"}
        base_url = os.environ.get("ANTHROPIC_BASE_URL")
        if base_url:
            env["ANTHROPIC_BASE_URL"] = base_url
        return env

    def _build_options(self, resume_session_id: str = "", permission_mode: str = "") -> ClaudeAgentOptions:
        """Build SDK client options from relay environment variables.

        State facet reader — translates env vars (written by lifecycle.py
        at provision time) into ClaudeAgentOptions fields. This is the
        relay-side half of the state facet pattern:

            DB field → lifecycle.py writes .relay_env → relay reads env
            → ClaudeAgentOptions → SDK session

        Facets that support live update (permission_mode) are also passed
        as a parameter when the relay re-spawns mid-session. Provision-only
        facets (model, allowed_tools, mcp_servers) just read from env.

        Team agent flags go through extra_args since the SDK doesn't
        expose them as first-class options.
        """
        agent_name = os.environ.get("AGENT_NAME", "")
        team_name = os.environ.get("TEAM_NAME", "")
        parent_session_id = os.environ.get("PARENT_SESSION_ID", "")
        model = os.environ.get("CLAUDE_MODEL", "")
        mcp_config = os.environ.get("MCP_CONFIG", "")
        allowed_tools_raw = os.environ.get("ALLOWED_TOOLS", "")

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

        # Only register can_use_tool in supervised mode ("default").
        # In bypassPermissions the SDK never fires the callback — keep None.
        can_use_tool = self._make_can_use_tool_callback() if perm == "default" else None

        # Parse allowed_tools facet (JSON list from env, e.g. '["Read","Glob"]')
        allowed_tools: list[str] | None = None
        if allowed_tools_raw:
            try:
                allowed_tools = json.loads(allowed_tools_raw)
            except json.JSONDecodeError:
                log.warning("Invalid ALLOWED_TOOLS env: %s", allowed_tools_raw)

        return ClaudeAgentOptions(
            model=model or None,
            permission_mode=perm,
            allowed_tools=allowed_tools or None,
            resume=resume_session_id or None,
            include_partial_messages=True,
            cli_path="claude",
            cwd=os.getcwd(),
            can_use_tool=can_use_tool,
            # IS_SANDBOX=1 tells the Claude CLI this is a sandboxed container,
            # so it accepts bypassPermissions even when the user has sudo.
            # Without this, the CLI detects sudo capability and refuses to start.
            # See: https://github.com/anthropics/claude-code/issues/927
            #
            # DO NOT set CLAUDECODE=1 here — the CLI treats that as a nested
            # session marker and refuses to start ("cannot be launched inside
            # another Claude Code session"). The SDK sets its own entrypoint
            # env var (CLAUDE_CODE_ENTRYPOINT=sdk-py) internally.
            env=self._build_sdk_env(),
            extra_args=extra_args,
            mcp_servers=mcp_config if mcp_config else {},
            stderr=self._on_stderr,
        )

    # ── Generic callback bridge ──

    async def _request_callback(self, callback_type: str, payload: dict) -> dict:
        """Send callback request to backend, wait for response.

        Creates a Future, sends the request upstream via WS, and awaits
        the backend's callback_response which resolves the Future.
        """
        import uuid as _uuid
        request_id = _uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self._pending_callbacks[request_id] = future
        await self._send_event({
            "type": "callback",
            "callback_type": callback_type,
            "request_id": request_id,
            "payload": payload,
        })
        try:
            return await asyncio.wait_for(future, timeout=300)
        except asyncio.TimeoutError:
            log.warning("Callback timeout after 300s: request_id=%s type=%s",
                        request_id, callback_type)
            return {"behavior": "deny", "message": "Timed out waiting for user response"}
        finally:
            self._pending_callbacks.pop(request_id, None)

    def _make_can_use_tool_callback(self):
        """Build the can_use_tool callback for supervised mode.

        Thin wrapper translating SDK callback ↔ our generic bridge.
        """
        async def _can_use_tool(tool_name, tool_input, context):
            result = await self._request_callback("can_use_tool", {
                "tool_name": tool_name,
                "tool_input": tool_input,
            })
            if result.get("behavior") == "allow":
                return PermissionResultAllow(updated_input=result.get("updated_input"))
            return PermissionResultDeny(
                message=result.get("message", "Denied by user"),
            )
        return _can_use_tool

    def _resolve_callback_response(self, cmd: dict, context: str = "") -> None:
        """Resolve a pending callback Future from a backend response."""
        request_id = cmd.get("request_id", "")
        result = cmd.get("result", {})
        future = self._pending_callbacks.get(request_id)
        if future and not future.done():
            future.set_result(result)
        else:
            suffix = f" ({context})" if context else ""
            log.warning("Stale callback_response%s: request_id=%s", suffix, request_id)

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

    def _get_stderr(self, error: Exception | None = None) -> str:
        """Reconstruct stderr from accumulated lines or error fallback."""
        if self._stderr_lines:
            return "\n".join(self._stderr_lines)
        if error and hasattr(error, "stderr") and error.stderr:
            return error.stderr
        if error:
            return str(error)
        return ""

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
        If that also fails, buffer critical events for later delivery.
        Raises FatalWSClose if reconnect hits a non-retryable code.
        """
        # Redact secrets before any WS send
        event = self._redactor.redact_event(event)

        # Flush any previously buffered events first
        await self._flush_event_buffer()

        sent = await self.ws.send(event)
        if sent:
            return

        log.warning("WS send failed, attempting reconnect")
        reconnected = await self.ws.reconnect()  # may raise FatalWSClose
        if reconnected:
            await self._flush_event_buffer()
            sent = await self.ws.send(event)
            if sent:
                return

        # Buffer critical events instead of dropping
        event_type = event.get("type", "")
        if event_type in CRITICAL_EVENT_TYPES:
            self._event_buffer.append(event)
            log.warning(
                "Critical event buffered (WS unavailable): type=%s buffer_size=%d",
                event_type, len(self._event_buffer),
            )
        else:
            log.warning("Event dropped (WS unavailable, non-critical): type=%s", event_type)

    async def _flush_event_buffer(self):
        """Flush buffered critical events to the backend.

        Called on successful WS send opportunities. Events are sent FIFO.
        Failed flushes leave events in the buffer for the next attempt.
        """
        if not self._event_buffer or not self.ws.connected:
            return

        flushed = 0
        while self._event_buffer:
            event = self._event_buffer[0]  # peek
            sent = await self.ws.send(event)
            if not sent:
                break  # WS went down again — stop flushing
            self._event_buffer.popleft()
            flushed += 1

        if flushed:
            log.info("Flushed %d buffered events, %d remaining", flushed, len(self._event_buffer))

    async def _forward_messages(self):
        """Iterate SDK messages and forward each to the backend via WS.

        Runs until the SDK client disconnects, the subprocess exits, or
        the task is cancelled. ProcessError is caught to emit a synthetic
        process_exit event with the exit code and stderr.
        """
        msg_count = 0
        forwarded_count = 0
        t0 = time.monotonic()
        try:
            async for msg in self.client.receive_messages():
                msg_count += 1
                event = self._message_to_event(msg)
                if event:
                    forwarded_count += 1
                    await self._send_event(event)
            elapsed = time.monotonic() - t0
            log.info("Turn complete: %d messages received, %d forwarded, %.1fs elapsed", msg_count, forwarded_count, elapsed)
        except ProcessError as e:
            log.warning("Claude exited: code=%s (after %d messages)", e.exit_code, msg_count)
            # Use accumulated stderr (from _on_stderr callback) over the
            # SDK's generic ProcessError.stderr which just says
            # "Check stderr output for details".
            await self._post_exit_event(e.exit_code or 1, self._get_stderr(e))
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
                            await self._flush_event_buffer()
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
        log.info("Handling command: type=%s (client_active=%s)", cmd_type, self.client is not None)

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

        elif cmd_type == "callback_response":
            self._resolve_callback_response(cmd)

        elif cmd_type == "mode":
            # Backend sends our vocabulary (auto/plan/supervised),
            # relay translates to SDK format (bypassPermissions/plan/default)
            our_mode = cmd.get("mode", "")
            if our_mode:
                sdk_mode = _MODE_MAP.get(our_mode, "bypassPermissions")
                if self.client:
                    log.info("Mode change via WS: %s -> %s (applying immediately via SDK)", our_mode, sdk_mode)
                    try:
                        await self.client.set_permission_mode(sdk_mode)
                    except Exception as e:
                        log.error("set_permission_mode failed: %s", e)
                        self.next_permission_mode = sdk_mode
                else:
                    log.info("Mode change via WS: %s -> %s (no client, deferred to next spawn)", our_mode, sdk_mode)
                    self.next_permission_mode = sdk_mode

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
        # Read our vocabulary, translate to SDK format
        agent_mode = os.environ.get("AGENT_MODE", "auto")
        permission_mode = _MODE_MAP.get(agent_mode, "bypassPermissions")
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

        # Flush any events buffered from a previous connection attempt
        await self._flush_event_buffer()

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
                real_stderr = self._get_stderr(e)
                log.error(
                    "SDK connect ProcessError: code=%s stderr=%s (captured %d stderr lines)",
                    e.exit_code, real_stderr, len(self._stderr_lines),
                )
                await self._post_exit_event(e.exit_code or 1, real_stderr)
                break
            except Exception as e:
                sdk_connect_failures += 1
                real_stderr = self._get_stderr(e)
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

            log.info("SDK client connected (perm=%s, resume=%s)", permission_mode, resume_session_id or "fresh")

            # Two tasks: forward messages upstream, receive commands downstream
            forward_task = asyncio.create_task(self._forward_messages(), name="forward")
            downstream_task = asyncio.create_task(self._ws_downstream(), name="downstream")

            # Feed pending input from idle wait state. Must happen AFTER tasks
            # start so forward_task is already iterating receive_messages() and
            # will capture Claude's response.
            if self._pending_input:
                log.info("Draining pending input from idle wait")
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

            # Cancel any pending callback Futures — the SDK process that
            # would consume the response is gone.
            for fut in self._pending_callbacks.values():
                if not fut.done():
                    fut.cancel()
            self._pending_callbacks.clear()

            log.info("SDK client disconnected, evaluating exit path (fatal=%s, restart=%s, clear=%s, exit_posted=%s)",
                     fatal, self.restart_requested, self.clear_requested, self._exit_posted)

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

            # Apply deferred mode change (set during active session)
            if self.next_permission_mode:
                permission_mode = self.next_permission_mode
                self.next_permission_mode = ""
                log.info("Applying deferred mode change: %s", permission_mode)

            log.info("Claude finished turn, entering idle wait (resume=%s, mode=%s)", resume_session_id, permission_mode)

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
                            if await self.ws.reconnect():
                                await self._flush_event_buffer()
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
                elif cmd_type == "callback_response":
                    # Resolve pending callback Future (agent might be idle
                    # when user responds to a late permission prompt).
                    self._resolve_callback_response(cmd, "idle")
                    # Don't break — no need to respawn for a callback response.
                elif cmd_type == "mode":
                    our_mode = cmd.get("mode", "")
                    if our_mode:
                        permission_mode = _MODE_MAP.get(our_mode, "bypassPermissions")
                        log.info("Idle: mode %s -> %s (effective next spawn)", our_mode, permission_mode)
                        # Don't break — no need to respawn just for a mode change.
                        # The new mode takes effect when the next input arrives.

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
    diag_keys = ["AGENT_ID", "AGENT_NAME", "AGENT_MODE", "CLAUDECODE", "IS_SANDBOX",
                 "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
                 "ANTHROPIC_API_KEY", "CLAUDE_MODEL", "ABOX_CALLBACK_URL",
                 "ANTHROPIC_BASE_URL"]
    diag = {k: ("set" if k == "ANTHROPIC_API_KEY" and os.environ.get(k) else os.environ.get(k, ""))
            for k in diag_keys}
    log.info("abox-relay starting (agent=%s) env=%s", AGENT_ID, diag)

    base_url = os.environ.get("ANTHROPIC_BASE_URL", "")
    log.info("api_proxy active=%s base_url=%s", bool(base_url), base_url or "direct")

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
