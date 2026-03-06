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
import os
import signal
import sys
import time

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

from abox_logging import setup as _setup_logging  # noqa: E402
from relay_common import (  # noqa: E402
    AGENT_ID,
    CALLBACK_URL,
    EventSender,
    FatalWSClose,
    Redactor,
    WSTransport,
    validate_config,
)

log = _setup_logging("abox-relay")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Mode mapping: backend sends our vocabulary, relay translates to SDK format.
# The backend never touches Claude Code wire format for live commands.
_MODE_MAP = {
    "auto": "bypassPermissions",
    "plan": "plan",
    "supervised": "default",
}


def _translate_mode(our_mode: str) -> str:
    """Translate backend vocabulary to SDK permission format."""
    return _MODE_MAP.get(our_mode, "bypassPermissions")


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
        self.permission_mode: str = "bypassPermissions"  # live mode, read by can_use_tool callback
        self._exit_posted = False  # guards against double process_exit events
        self._stderr_lines: list[str] = []  # accumulated CLI stderr for exit event
        self._pending_input: dict | None = None  # buffered input from idle wait
        self._pending_callbacks: dict[str, asyncio.Future] = {}  # request_id → Future
        self.ws = WSTransport(log=log)
        self._redactor = Redactor(log=log)
        self._redactor.load()
        self._sender = EventSender(self.ws, self._redactor, log=log)

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

        # Always register can_use_tool so mid-session mode changes work.
        # The callback checks the live permission mode — auto returns allow
        # immediately, supervised routes through the backend approval flow.
        can_use_tool = self._make_can_use_tool_callback()

        # Parse allowed_tools facet (JSON list from env, e.g. '["Read","Glob"]')
        allowed_tools: list[str] | None = None
        if allowed_tools_raw:
            try:
                allowed_tools = json.loads(allowed_tools_raw)
            except json.JSONDecodeError:
                log.warning("relay.config_invalid_allowed_tools", extra={"raw": allowed_tools_raw})

        return ClaudeAgentOptions(
            model=model or None,
            permission_mode=perm,
            allowed_tools=allowed_tools or None,
            resume=resume_session_id or None,
            include_partial_messages=True,
            cli_path="claude",
            cwd=os.getcwd(),
            can_use_tool=can_use_tool,
            # Load user-level settings so hooks from ~/.claude/settings.json
            # are active. The SDK defaults setting_sources=None which the
            # transport layer converts to --setting-sources "" (empty),
            # causing CC to load ZERO settings — breaking all user hooks.
            setting_sources=["user"],
            # 16MB buffer — computer-use screenshots are 2-5MB base64.
            # SDK default is 1MB which truncates large tool results.
            max_buffer_size=16 * 2**20,
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
        await self._sender.send({
            "type": "callback",
            "callback_type": callback_type,
            "request_id": request_id,
            "payload": payload,
        })
        try:
            return await asyncio.wait_for(future, timeout=300)
        except asyncio.TimeoutError:
            log.warning("relay.callback_timeout", extra={"request_id": request_id, "type": callback_type})
            return {"behavior": "deny", "message": "Timed out waiting for user response"}
        finally:
            self._pending_callbacks.pop(request_id, None)

    def _make_can_use_tool_callback(self):
        """Build the can_use_tool callback that respects live mode changes.

        Always registered so mid-session mode switches take effect immediately.
        In auto mode, returns allow without prompting. In supervised mode,
        routes through the backend approval flow.
        """
        async def _can_use_tool(tool_name, tool_input, context):
            if self.permission_mode == "bypassPermissions":
                return PermissionResultAllow()
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
            log.warning("relay.callback_stale", extra={"request_id": request_id, "context": context or ""})

    def _on_stderr(self, line: str):
        """Capture CLI stderr for diagnostics.

        Lines are logged immediately AND accumulated so we can include
        the real stderr in the process_exit event (the SDK's ProcessError.stderr
        only gives a generic "Check stderr output for details" wrapper).
        """
        stripped = line.rstrip()
        if stripped:
            log.info("relay.claude_stderr", extra={"line": stripped})
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
            log.error("relay.message_missing_raw", extra={"type": type(msg).__name__})
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
                    await self._sender.send(event)
            elapsed = time.monotonic() - t0
            log.info("relay.turn_complete", extra={"received": msg_count, "forwarded": forwarded_count, "elapsed": round(elapsed, 1)})
        except ProcessError as e:
            log.warning("relay.claude_exited", extra={"code": e.exit_code, "messages": msg_count})
            # Use accumulated stderr (from _on_stderr callback) over the
            # SDK's generic ProcessError.stderr which just says
            # "Check stderr output for details".
            await self._post_exit_event(e.exit_code or 1, self._get_stderr(e))
        except (asyncio.CancelledError, FatalWSClose):
            raise  # propagate — run loop handles these
        except Exception as e:
            log.error("relay.forward_error", extra={"error": str(e)})
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
                    log.warning("relay.ws_disconnected")
                    try:
                        if await self.ws.reconnect():
                            log.info("relay.ws_reconnected")
                            await self._sender.flush_buffer()
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
        log.info("relay.command_received", extra={"type": cmd_type, "client_active": self.client is not None})

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
                    log.error("relay.command_query_failed", extra={"error": str(e)})

        elif cmd_type == "signal":
            sig = cmd.get("signal", "")
            if not self.client:
                return
            if sig == "clear":
                log.info("relay.command_clear")
                self.clear_requested = True
                await self.client.interrupt()
            elif sig == "restart":
                log.info("relay.command_restart")
                self.restart_requested = True
                await self.client.interrupt()
            elif sig == "SIGINT":
                log.info("relay.command_sigint")
                await self.client.interrupt()

        elif cmd_type == "callback_response":
            self._resolve_callback_response(cmd)

        elif cmd_type == "theme":
            tokens = cmd.get("tokens", {})
            if tokens:
                await self._apply_theme(tokens)

        elif cmd_type == "mode":
            # Backend sends our vocabulary (auto/plan/supervised),
            # relay translates to SDK format (bypassPermissions/plan/default)
            our_mode = cmd.get("mode", "")
            if our_mode:
                sdk_mode = _translate_mode(our_mode)
                self.permission_mode = sdk_mode  # live update — callback reads this
                if self.client:
                    log.info("relay.mode_changed", extra={"from": our_mode, "to": sdk_mode, "applied": "immediate"})
                    try:
                        await self.client.set_permission_mode(sdk_mode)
                    except Exception as e:
                        log.error("relay.mode_change_failed", extra={"error": str(e)})
                        self.next_permission_mode = sdk_mode
                else:
                    log.info("relay.mode_changed", extra={"from": our_mode, "to": sdk_mode, "applied": "deferred"})
                    self.next_permission_mode = sdk_mode

    # ── Theme application ──

    async def _apply_theme(self, tokens: dict):
        """Write theme files and apply to AwesomeWM + Firefox.

        Three outputs:
        1. /tmp/abox-theme.lua — AwesomeWM reads on boot, we live-reload via awesome-client
        2. /tmp/abox-theme.css — Textfox @imports this for Firefox chrome colors
        3. /tmp/abox-theme.json — reference copy (debugging, future use)

        Firefox requires restart to re-read userChrome.css @imports.
        AwesomeWM can live-reload via awesome-client Lua eval.
        """
        import json as _json
        import subprocess
        from pathlib import Path

        # 1. AwesomeWM lua table
        entries = ", ".join(f'["{k}"] = "{v}"' for k, v in sorted(tokens.items()))
        Path("/tmp/abox-theme.lua").write_text(f"return {{ {entries} }}\n")

        # 2. CSS overrides for Textfox (userChrome.css @imports this)
        surface = tokens.get("surface", "#1e1e1e")
        surface_raised = tokens.get("surface-raised", surface)
        surface_sunken = tokens.get("surface-sunken", surface)
        text_default = tokens.get("text-default", "#d4d4d4")
        text_muted = tokens.get("text-muted", "#888888")
        accent = tokens.get("accent", "#5a5a5a")
        border = tokens.get("border-default", surface_raised)
        border_subtle = tokens.get("border-subtle", surface_raised)

        css = (
            "/* Generated by relay.py — do not edit manually */\n"
            ":root {\n"
            f"  --lwt-accent-color: {surface} !important;\n"
            f"  --lwt-text-color: {text_default} !important;\n"
            f"  --lwt-tab-line-color: {accent} !important;\n"
            f"  --toolbar-bgcolor: {surface} !important;\n"
            f"  --toolbar-color: {text_muted} !important;\n"
            f"  --toolbar-field-background-color: {surface} !important;\n"
            f"  --toolbar-field-color: {text_default} !important;\n"
            f"  --toolbar-field-border-color: {border_subtle} !important;\n"
            f"  --toolbar-field-focus-background-color: {surface} !important;\n"
            f"  --toolbar-field-focus-color: {text_default} !important;\n"
            f"  --arrowpanel-background: {surface} !important;\n"
            f"  --arrowpanel-color: {text_default} !important;\n"
            f"  --arrowpanel-border-color: {border} !important;\n"
            f"  --sidebar-background-color: {surface} !important;\n"
            f"  --sidebar-text-color: {text_muted} !important;\n"
            f"  --sidebar-border-color: {border_subtle} !important;\n"
            f"  --newtab-background-color: {surface} !important;\n"
            f"  --newtab-text-primary-color: {text_default} !important;\n"
            f"  --tf-bg: {surface} !important;\n"
            f"  --tf-border: {border} !important;\n"
            f"  --tf-accent: {accent} !important;\n"
            "}\n"
        )
        Path("/tmp/abox-theme.css").write_text(css)

        # 3. JSON reference
        Path("/tmp/abox-theme.json").write_text(_json.dumps(tokens, indent=2) + "\n")

        log.info("relay.theme_files_written", extra={"token_count": len(tokens)})

        # Live-reload AwesomeWM (wallpaper + dock bar)
        dbus_addr = ""
        try:
            dbus_env = Path("/run/dbus-session").read_text().strip()
            for line in dbus_env.split("\n"):
                if line.startswith("DBUS_SESSION_BUS_ADDRESS="):
                    dbus_addr = line.split("=", 1)[1]
        except FileNotFoundError:
            pass

        if dbus_addr:
            lua_reload = (
                f'local gears = require("gears"); '
                f'local beautiful = require("beautiful"); '
                f'beautiful.wallpaper = "{surface}"; '
                f'beautiful.bg_normal = "{surface}"; '
                f'for s in screen do gears.wallpaper.set("{surface}") end; '
                f'for s in screen do '
                f'  if s.dock then s.dock.bg = "{surface}" end '
                f'end'
            )
            try:
                env = {**os.environ, "DISPLAY": ":0", "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
                subprocess.run(
                    ["awesome-client", lua_reload],
                    env=env, timeout=5, capture_output=True,
                )
                log.info("relay.theme_awesome_reloaded")
            except Exception as e:
                log.warning("relay.theme_awesome_reload_failed", extra={"error": str(e)})

        # Restart Firefox so it re-reads userChrome.css @import.
        # s6 auto-restarts the service after pkill.
        try:
            subprocess.run(["pkill", "firefox-esr"], timeout=5, capture_output=True)
            log.info("relay.theme_firefox_restarted")
        except Exception as e:
            log.warning("relay.theme_firefox_restart_failed", extra={"error": str(e)})

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
        log.info("relay.process_exit", extra={"code": exit_code})
        await self._sender.send(event)

    # ── Signal handling ──

    def _on_signal(self, signum):
        """Handle SIGTERM/SIGINT by interrupting the SDK client.

        Both signals forward an interrupt to Claude (matching the old relay
        behavior). Claude wraps up gracefully, emits a ResultMessage, and
        the run loop decides whether to restart or exit.
        """
        log.info("relay.signal_received", extra={"signal": signal.Signals(signum).name})
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
        permission_mode = _translate_mode(agent_mode)
        self.permission_mode = permission_mode
        sdk_connect_failures = 0
        SDK_MAX_CONNECT_RETRIES = 3
        SDK_CONNECT_RETRY_DELAY_S = 5.0

        # Connect to backend — retry until connected, but bail on fatal codes
        try:
            connected = await self.ws.connect()
            while not connected:
                log.warning("relay.ws_not_connected")
                connected = await self.ws.reconnect()
        except FatalWSClose as exc:
            log.error("relay.ws_rejected_fatal", extra={"code": exc.code, "reason": exc.reason})
            return

        # Flush any events buffered from a previous connection attempt
        await self._sender.flush_buffer()

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
                "setting_sources": ["user"],
            },
        }
        try:
            await self._sender.send(init_diag)
        except FatalWSClose as exc:
            log.error("relay.ws_rejected_init", extra={"code": exc.code, "reason": exc.reason})
            return

        while True:
            options = self._build_options(resume_session_id, permission_mode)
            log.info("relay.sdk_starting", extra={"model": options.model, "resume": options.resume})

            try:
                self._stderr_lines.clear()
                log.info("relay.sdk_creating", extra={
                    "cli_path": options.cli_path, "cwd": options.cwd,
                    "perm": options.permission_mode,
                    "setting_sources": list(options.setting_sources or []),
                    "extra_args": {k: v for k, v in (options.extra_args or {}).items()},
                })
                self.client = ClaudeSDKClient(options=options)
                log.info("relay.sdk_created")
                await self.client.connect()
                sdk_connect_failures = 0  # reset on success
            except CLINotFoundError:
                log.error("relay.sdk_cli_not_found")
                await self._post_exit_event(127, "claude: command not found")
                break
            except ProcessError as e:
                real_stderr = self._get_stderr(e)
                log.error("relay.sdk_process_error", extra={
                    "code": e.exit_code, "stderr": real_stderr,
                    "captured_lines": len(self._stderr_lines),
                    "was_resume": bool(resume_session_id),
                })
                # If we were resuming and the process failed, the session may
                # be poisoned (e.g. API error HTML embedded in conversation
                # history). Fall back to a fresh session instead of dying.
                if resume_session_id:
                    log.warning("relay.resume_failed_fallback", extra={
                        "poisoned_session": resume_session_id,
                    })
                    resume_session_id = ""
                    self.session_id = ""
                    self._stderr_lines.clear()
                    continue
                await self._post_exit_event(e.exit_code or 1, real_stderr)
                break
            except Exception as e:
                sdk_connect_failures += 1
                real_stderr = self._get_stderr(e)
                log.error("relay.sdk_connect_failed", extra={
                    "attempt": sdk_connect_failures, "max_attempts": SDK_MAX_CONNECT_RETRIES,
                    "error": str(e), "type": type(e).__name__,
                    "captured_lines": len(self._stderr_lines), "stderr": real_stderr[:500],
                })
                if sdk_connect_failures >= SDK_MAX_CONNECT_RETRIES:
                    log.error("relay.sdk_connect_exhausted", extra={"attempts": sdk_connect_failures})
                    await self._post_exit_event(1, real_stderr)
                    break
                delay = SDK_CONNECT_RETRY_DELAY_S * sdk_connect_failures
                log.info("relay.sdk_connect_retry", extra={"delay": round(delay, 1)})
                await asyncio.sleep(delay)
                continue

            log.info("relay.sdk_connected", extra={"perm": permission_mode, "resume": resume_session_id or "fresh"})

            # Two tasks: forward messages upstream, receive commands downstream
            forward_task = asyncio.create_task(self._forward_messages(), name="forward")
            downstream_task = asyncio.create_task(self._ws_downstream(), name="downstream")

            # Feed pending input from idle wait state. Must happen AFTER tasks
            # start so forward_task is already iterating receive_messages() and
            # will capture Claude's response.
            if self._pending_input:
                log.info("relay.idle_drain_pending")
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
                    log.error("relay.ws_fatal_rejection", extra={"code": exc.code, "reason": exc.reason})
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

            log.info("relay.sdk_disconnected", extra={
                "fatal": fatal, "restart": self.restart_requested,
                "clear": self.clear_requested, "exit_posted": self._exit_posted,
            })

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
                log.info("relay.sdk_clear_respawn")
                continue

            if self.restart_requested:
                self.restart_requested = False
                self._exit_posted = False
                self._stderr_lines.clear()
                if self.session_id:
                    resume_session_id = self.session_id
                    log.info("relay.sdk_soft_restart", extra={"resume": self.session_id})
                else:
                    log.info("relay.sdk_soft_restart_fresh")
                if self.next_permission_mode:
                    permission_mode = self.next_permission_mode
                    self.permission_mode = permission_mode
                    self.next_permission_mode = ""
                    log.info("relay.mode_queued", extra={"mode": permission_mode})
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
                self.permission_mode = permission_mode
                self.next_permission_mode = ""
                log.info("relay.mode_applied", extra={"mode": permission_mode})

            log.info("relay.idle_waiting", extra={"resume": resume_session_id, "mode": permission_mode})

            idle_fatal = False
            while True:
                try:
                    cmd = await self.ws.recv()
                except FatalWSClose:
                    idle_fatal = True
                    break

                if cmd is None:
                    if not self.ws.connected:
                        log.warning("relay.idle_ws_disconnected")
                        try:
                            if await self.ws.reconnect():
                                await self._sender.flush_buffer()
                        except FatalWSClose:
                            idle_fatal = True
                            break
                    continue

                cmd_type = cmd.get("type", "")
                log.info("relay.idle_command", extra={"type": cmd_type})
                if cmd_type == "input":
                    self._pending_input = cmd.get("payload")
                    log.info("relay.idle_input_received")
                    break
                elif cmd_type == "signal":
                    sig = cmd.get("signal", "")
                    log.info("relay.idle_signal", extra={"signal": sig})
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
                elif cmd_type == "theme":
                    # Theme can arrive while idle — write files immediately.
                    await self._handle_command(cmd)
                    # Don't break — no need to respawn for a theme push.
                elif cmd_type == "mode":
                    our_mode = cmd.get("mode", "")
                    if our_mode:
                        permission_mode = _translate_mode(our_mode)
                        self.permission_mode = permission_mode
                        log.info("relay.idle_mode_changed", extra={"from": our_mode, "to": permission_mode})
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
    validate_config()

    # Log env diagnostics at startup — these go to tmux pane AND
    # are visible in container logs before the container is cleaned up.
    diag_keys = ["AGENT_ID", "AGENT_NAME", "AGENT_MODE", "CLAUDECODE", "IS_SANDBOX",
                 "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
                 "ANTHROPIC_API_KEY", "CLAUDE_MODEL", "ABOX_CALLBACK_URL",
                 "ANTHROPIC_BASE_URL"]
    diag = {k: ("set" if k == "ANTHROPIC_API_KEY" and os.environ.get(k) else os.environ.get(k, ""))
            for k in diag_keys}
    log.info("relay.starting", extra={"agent": AGENT_ID, "env": diag})

    base_url = os.environ.get("ANTHROPIC_BASE_URL", "")
    log.info("relay.proxy_status", extra={"active": bool(base_url), "base_url": base_url or "direct"})

    relay = SDKRelay()
    try:
        asyncio.run(relay.run())
        log.info("relay.stopped")
        sys.exit(0)
    except Exception as e:
        log.error("relay.crashed", extra={"error": str(e), "type": type(e).__name__})
        sys.exit(1)


if __name__ == "__main__":
    main()
