#!/usr/bin/env python3
"""
abox-relay: In-container relay process for OpenCode HTTP/SSE integration.

Manages an OpenCode session via its REST API + SSE event stream and bridges
events to the Agentobox backend over WebSocket.

    WebSocket (ws://backend/ws/relay/<agent_id>/):
        auth:       Authorization header on WS upgrade (Bearer <relay_token>)
        upstream:   SSE events → filtered/normalized → ws.send(json)
        downstream: commands from backend (input, signal, mode) → REST calls

OpenCode runs as `opencode serve --port 4096 --hostname 127.0.0.1` (managed
by s6 svc-opencode or started inline). The relay connects via:
    - SSE: GET http://localhost:4096/event (downstream events)
    - REST: POST /session/:id/prompt, /session/:id/abort, etc. (upstream commands)

Synthetic events (not from OpenCode):
    process_exit: {type: "system", subtype: "process_exit", exit_code, stderr}
        Emitted when the SSE stream ends or the OpenCode process terminates.
"""

import asyncio
import json
import os
import signal
import sys
import time

import httpx

from abox_logging import setup as _setup_logging
from relay_common import (
    AGENT_ID,
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

OPENCODE_PORT = os.environ.get("OPENCODE_PORT", "4096")
OPENCODE_BASE = f"http://127.0.0.1:{OPENCODE_PORT}"

# Mode mapping: backend sends our vocabulary, relay translates to OpenCode format.
_MODE_MAP = {
    "auto": "allow",
    "supervised": "ask",
}

# SSE event types to forward to the backend. Other event types (file.watcher.updated,
# session.diff, etc.) are noise for the dashboard — drop them at the relay.
_FORWARD_TYPES = {
    "message.updated",
    "message.part.updated",
    "message.part.delta",
    "session.status",
    "session.idle",
    "session.created",
    "session.updated",
    "permission.asked",
    "permission.replied",
    "tool.started",
    "tool.completed",
}

# SSE connect retry
SSE_RECONNECT_DELAY_S = 2.0
SSE_MAX_RECONNECT_DELAY_S = 30.0


# ---------------------------------------------------------------------------
# SSE client
# ---------------------------------------------------------------------------


async def iter_sse(url: str, timeout: float = 0):
    """Yield parsed SSE events from an HTTP event stream.

    Each yielded value is a dict parsed from the SSE data field.
    Reconnects are handled by the caller — this generator yields
    until the connection drops or is cancelled.
    """
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout or None)) as client:
        async with client.stream("GET", url, headers={"Accept": "text/event-stream"}) as resp:
            resp.raise_for_status()
            buf = ""
            async for chunk in resp.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    raw_event, buf = buf.split("\n\n", 1)
                    data_lines = []
                    for line in raw_event.split("\n"):
                        if line.startswith("data: "):
                            data_lines.append(line[6:])
                        elif line.startswith("data:"):
                            data_lines.append(line[5:])
                    if data_lines:
                        payload = "\n".join(data_lines)
                        try:
                            yield json.loads(payload)
                        except json.JSONDecodeError:
                            log.warning("relay.sse_malformed", extra={"data": payload[:200]})


# ---------------------------------------------------------------------------
# OpenCode REST client
# ---------------------------------------------------------------------------


class OpenCodeClient:
    """Thin HTTP client for OpenCode's REST API."""

    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base,
            timeout=httpx.Timeout(30.0),
        )
        self._session_id: str = ""

    async def close(self):
        await self._client.aclose()

    async def create_session(self) -> str:
        """Create a new OpenCode session. Returns session ID."""
        resp = await self._client.post("/session")
        resp.raise_for_status()
        data = resp.json()
        # Response is the session info with "id" field
        sid = data.get("id", "")
        self._session_id = sid
        log.info("relay.oc_session_created", extra={"session_id": sid})
        return sid

    @property
    def session_id(self) -> str:
        return self._session_id

    @session_id.setter
    def session_id(self, value: str):
        self._session_id = value

    async def send_prompt(self, session_id: str, content: str) -> None:
        """Send a prompt to an OpenCode session (async, fire-and-forget)."""
        resp = await self._client.post(
            f"/session/{session_id}/prompt_async",
            json={"parts": [{"type": "text", "text": content}]},
        )
        resp.raise_for_status()

    async def abort(self, session_id: str) -> bool:
        """Abort the current operation in a session."""
        try:
            resp = await self._client.post(f"/session/{session_id}/abort")
            resp.raise_for_status()
            return True
        except httpx.HTTPError as e:
            log.warning("relay.oc_abort_failed", extra={"error": str(e)})
            return False

    async def reply_permission(self, session_id: str, permission_id: str, response: str) -> bool:
        """Reply to a permission request (deprecated endpoint, still functional).

        response: "once" | "always" | "reject"
        """
        try:
            resp = await self._client.post(
                f"/session/{session_id}/permissions/{permission_id}",
                json={"response": response},
            )
            resp.raise_for_status()
            return True
        except httpx.HTTPError as e:
            log.warning("relay.oc_permission_failed", extra={"error": str(e), "id": permission_id})
            return False

    async def list_sessions(self) -> list[dict]:
        """List existing sessions."""
        try:
            resp = await self._client.get("/session")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            log.warning("relay.oc_list_sessions_failed", extra={"error": str(e)})
            return []


# ---------------------------------------------------------------------------
# Main relay
# ---------------------------------------------------------------------------


class SSERelay:
    """Main relay process for OpenCode.

    Manages SSE subscription to the OpenCode server, forwards events to
    the backend via WebSocket, and routes backend commands to REST calls.
    """

    def __init__(self):
        self.oc = OpenCodeClient(OPENCODE_BASE)
        self.session_id: str = ""
        self._exit_posted = False
        self._pending_callbacks: dict[str, asyncio.Future] = {}
        self.ws = WSTransport(log=log)
        self._redactor = Redactor(log=log)
        self._redactor.load()
        self._sender = EventSender(self.ws, self._redactor, log=log)
        self._pending_permissions: dict[str, str] = {}  # perm_id -> perm_id

    # ── SSE event forwarding ──

    async def _forward_sse(self):
        """Subscribe to OpenCode SSE with reconnection.

        Runs forever — only exits via CancelledError (task cancellation on shutdown).
        On stream end or error, reconnects with exponential backoff.

        Forwards raw OC events to the backend. CC event synthesis (assistant,
        result, user) is handled by the adapter's normalize() in stream.py.
        The relay only tracks permission IDs for callback resolution.
        """
        sse_url = f"{OPENCODE_BASE}/event"
        delay = SSE_RECONNECT_DELAY_S

        while True:
            event_count = 0
            forwarded_count = 0
            t0 = time.monotonic()

            try:
                async for event in iter_sse(sse_url):
                    delay = SSE_RECONNECT_DELAY_S  # reset on successful event
                    event_count += 1
                    event_type = event.get("type", "")

                    # Track session ID from events
                    props = event.get("properties", {})
                    if isinstance(props, dict):
                        sid = props.get("sessionID", "")
                        if not sid:
                            info = props.get("info", {})
                            if isinstance(info, dict):
                                sid = info.get("id", "") if info.get("id", "").startswith("ses_") else ""
                        if sid:
                            self.session_id = sid
                            self.oc.session_id = sid

                    # Filter: only forward relevant event types
                    if event_type not in _FORWARD_TYPES:
                        continue

                    forwarded_count += 1
                    # Forward raw OC event — backend adapter.normalize() handles CC synthesis
                    await self._sender.send(event)

                    # Track permission IDs locally for callback resolution via REST
                    if event_type == "permission.asked":
                        perm_id = props.get("id", "")
                        if perm_id:
                            self._pending_permissions[perm_id] = perm_id
                            log.info("relay.permission_tracked", extra={"id": perm_id})

                # Stream ended cleanly — reconnect after delay
                elapsed = time.monotonic() - t0
                log.info("relay.sse_stream_ended", extra={
                    "received": event_count, "forwarded": forwarded_count,
                    "elapsed": round(elapsed, 1), "reconnect_delay": delay,
                })

            except httpx.HTTPError as e:
                log.warning("relay.sse_error", extra={"error": str(e), "reconnect_delay": delay})
            except asyncio.CancelledError:
                return  # clean shutdown
            except Exception as e:
                log.error("relay.sse_unexpected", extra={"error": str(e), "type": type(e).__name__})

            await asyncio.sleep(delay)
            delay = min(delay * 2, SSE_MAX_RECONNECT_DELAY_S)

    # ── WS downstream: receive commands from backend ──

    async def _ws_downstream(self):
        """Listen for commands from the backend over WebSocket."""
        while True:
            try:
                cmd = await self.ws.recv()
            except FatalWSClose:
                raise

            if cmd is None:
                if not self.ws.connected:
                    log.warning("relay.ws_disconnected")
                    try:
                        if await self.ws.reconnect():
                            log.info("relay.ws_reconnected")
                            await self._sender.flush_buffer()
                    except FatalWSClose:
                        raise
                continue

            await self._handle_command(cmd)

    async def _handle_command(self, cmd: dict):
        """Route a command from the backend to the appropriate REST call."""
        cmd_type = cmd.get("type", "")
        log.info("relay.command_received", extra={"type": cmd_type})

        if cmd_type == "input":
            payload = cmd.get("payload")
            if payload and self.session_id:
                # payload can be a string or dict with content
                content = payload if isinstance(payload, str) else payload.get("content", str(payload))
                try:
                    await self.oc.send_prompt(self.session_id, content)
                except httpx.HTTPError as e:
                    log.error("relay.oc_prompt_failed", extra={"error": str(e)})
            elif payload and not self.session_id:
                # No session yet — create one first
                try:
                    await self.oc.create_session()
                    self.session_id = self.oc.session_id
                    content = payload if isinstance(payload, str) else payload.get("content", str(payload))
                    await self.oc.send_prompt(self.session_id, content)
                except httpx.HTTPError as e:
                    log.error("relay.oc_session_create_failed", extra={"error": str(e)})

        elif cmd_type == "signal":
            sig = cmd.get("signal", "")
            if sig in ("SIGINT", "clear", "restart") and self.session_id:
                log.info("relay.oc_abort", extra={"signal": sig})
                await self.oc.abort(self.session_id)

        elif cmd_type == "callback_response":
            self._resolve_callback_response(cmd)

        elif cmd_type == "mode":
            our_mode = cmd.get("mode", "")
            if our_mode:
                oc_mode = _MODE_MAP.get(our_mode, "allow")
                log.info("relay.mode_changed", extra={"from": our_mode, "to": oc_mode})
                # OpenCode doesn't have a live mode-change API — mode is set
                # in opencode.json at provision time. Log for awareness.

    def _resolve_callback_response(self, cmd: dict) -> None:
        """Resolve a permission callback from the backend.

        The backend sends callback_response when a user approves/denies a
        permission request in the dashboard. We translate this to an
        OpenCode permission reply via REST.
        """
        result = cmd.get("result", {})
        behavior = result.get("behavior", "deny")
        callback_id = cmd.get("callback_id", "")

        # Map backend behavior to OpenCode PermissionNext.Reply values.
        # OC accepts: "once" (approve this), "always" (approve pattern), "reject" (deny).
        if behavior == "allow":
            oc_response = "once"
        elif behavior == "alwaysAllow":
            oc_response = "always"
        else:
            oc_response = "reject"

        # Find matching permission
        permission_id = self._pending_permissions.pop(callback_id, "")
        if not permission_id:
            # Fallback: try using callback_id directly as permission_id
            permission_id = callback_id

        if not permission_id:
            log.warning("relay.callback_no_permission_id", extra={"callback_id": callback_id})
            return

        asyncio.create_task(self._send_permission_reply(permission_id, oc_response))

    async def _send_permission_reply(self, permission_id: str, response: str):
        """Send permission reply to OpenCode via REST."""
        if self.session_id:
            success = await self.oc.reply_permission(self.session_id, permission_id, response)
            if success:
                log.info("relay.permission_replied", extra={"id": permission_id, "response": response})

    # ── Synthetic events ──

    async def _post_exit_event(self, exit_code: int, stderr: str):
        """Post synthetic process_exit event to the backend."""
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
        """Handle SIGTERM/SIGINT by aborting the current session."""
        log.info("relay.signal_received", extra={"signal": signal.Signals(signum).name})
        if self.session_id:
            asyncio.create_task(self.oc.abort(self.session_id))

    # ── Main run loop ──

    async def run(self):
        """Entry point — manage SSE subscription lifecycle.

        1. Connect to backend WS
        2. Wait for OpenCode server to be ready
        3. Subscribe to SSE (with reconnection) + listen for WS commands concurrently
        4. Exit only on fatal WS close or process signal
        """
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self._on_signal, sig)

        # Connect to backend WS
        try:
            connected = await self.ws.connect()
            while not connected:
                log.warning("relay.ws_not_connected")
                connected = await self.ws.reconnect()
        except FatalWSClose as exc:
            log.error("relay.ws_rejected_fatal", extra={"code": exc.code, "reason": exc.reason})
            return

        await self._sender.flush_buffer()

        # Send relay_init diagnostic
        init_diag = {
            "type": "system",
            "subtype": "relay_init",
            "agent_id": AGENT_ID,
            "env": {
                "OPENCODE_PORT": OPENCODE_PORT,
                "OPENCODE_BASE": OPENCODE_BASE,
                "AGENT_TYPE": "opencode",
            },
        }
        try:
            await self._sender.send(init_diag)
        except FatalWSClose as exc:
            log.error("relay.ws_rejected_init", extra={"code": exc.code, "reason": exc.reason})
            return

        # Wait for OpenCode server to be ready
        await self._wait_for_opencode()

        # Try to find or create a session
        sessions = await self.oc.list_sessions()
        if sessions:
            # Use the most recent session
            self.session_id = sessions[-1].get("id", "")
            self.oc.session_id = self.session_id
            log.info("relay.oc_session_resumed", extra={"session_id": self.session_id})
        else:
            try:
                await self.oc.create_session()
                self.session_id = self.oc.session_id
            except httpx.HTTPError as e:
                log.warning("relay.oc_session_create_failed", extra={"error": str(e)})

        # Run SSE + WS downstream concurrently.
        # _forward_sse() reconnects forever; _ws_downstream() loops forever.
        # Only exits on fatal WS close or process signal.
        sse_task = asyncio.create_task(self._forward_sse(), name="sse")
        downstream_task = asyncio.create_task(self._ws_downstream(), name="downstream")

        try:
            done, pending = await asyncio.wait(
                [sse_task, downstream_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
        except asyncio.CancelledError:
            done, pending = set(), {sse_task, downstream_task}

        # Check for fatal WS close
        for t in done:
            try:
                exc = t.exception()
            except asyncio.CancelledError:
                continue
            if isinstance(exc, FatalWSClose):
                log.error("relay.ws_fatal_rejection", extra={"code": exc.code, "reason": exc.reason})

        for t in [sse_task, downstream_task]:
            if not t.done():
                t.cancel()
        await asyncio.gather(sse_task, downstream_task, return_exceptions=True)

        # Post exit event on shutdown
        if not self._exit_posted:
            await self._post_exit_event(0, "relay shutdown")

        await self.oc.close()
        await self.ws.close()

    async def _wait_for_opencode(self, max_wait: float = 120.0):
        """Poll until OpenCode's HTTP server is reachable."""
        t0 = time.monotonic()
        delay = 1.0
        while time.monotonic() - t0 < max_wait:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                    resp = await client.get(f"{OPENCODE_BASE}/global/health")
                    if resp.status_code < 500:
                        log.info("relay.oc_server_ready", extra={"elapsed": round(time.monotonic() - t0, 1)})
                        return
            except (httpx.ConnectError, httpx.ConnectTimeout):
                pass
            except Exception as e:
                log.warning("relay.oc_poll_error", extra={"error": str(e)})
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 10.0)
        log.error("relay.oc_server_timeout", extra={"waited": max_wait})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    validate_config()

    diag_keys = ["AGENT_ID", "AGENT_NAME", "AGENT_MODE", "OPENCODE_PORT",
                 "OPENCODE_MODEL", "ABOX_CALLBACK_URL"]
    diag = {k: os.environ.get(k, "") for k in diag_keys}
    log.info("relay.starting", extra={"agent": AGENT_ID, "env": diag})

    relay = SSERelay()
    try:
        asyncio.run(relay.run())
        log.info("relay.stopped")
        sys.exit(0)
    except Exception as e:
        log.error("relay.crashed", extra={"error": str(e), "type": type(e).__name__})
        sys.exit(1)


if __name__ == "__main__":
    main()
