#!/usr/bin/env python3
"""
Shared utilities for agent relay processes.

Both the Claude Code relay (relay.py) and the OpenCode relay
(opencode-relay.py) use the same WebSocket transport to the Agentobox
backend, the same secret redaction, and the same reconnection logic.
This module contains only the shared pieces — agent-type-specific logic
lives in each relay's own file.

Classes:
    Redactor     — scrub known secrets from outbound event dicts
    FatalWSClose — non-retryable WS rejection from the backend
    WSTransport  — WebSocket connection with reconnect + auth header
"""

import asyncio
import json
import os
import time
from collections import deque
from urllib.parse import urlparse, urlunparse

import websockets
import websockets.exceptions

from abox_logging import setup as _setup_logging

# ---------------------------------------------------------------------------
# Configuration — read from provisioned .relay_env
# ---------------------------------------------------------------------------

AGENT_ID = os.environ.get("AGENT_ID", "")
CALLBACK_URL = os.environ.get("ABOX_CALLBACK_URL", "").rstrip("/")
RELAY_AUTH_TOKEN = os.environ.get("RELAY_AUTH_TOKEN", "")

# Volume root for this agent — mirrors backend's Volume.root path.
# Backend writes to VOLUME_ROOT/agents/{agent_id}/, container mounts the
# whole named volume at /vol/, so the agent-specific root is /vol/agents/{id}/.
VOL_ROOT = f"/vol/agents/{AGENT_ID}" if AGENT_ID else "/vol"

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
ERR_RELAY_BUFFER_OVERFLOW = "ERR-RELAY-BUFFER-OVERFLOW"


# ---------------------------------------------------------------------------
# Secret redaction
# ---------------------------------------------------------------------------


class Redactor:
    """Scrub known secret values from outbound event data.

    Loads secret values from /run/secrets/ and the relay env at boot.
    Applied to every event before WS send — prevents accidental credential
    exposure in dashboard output. UX safety net, not a security boundary.
    """

    def __init__(self, log=None):
        self._secrets: list[str] = []
        self._log = log or _setup_logging("abox-relay")

    def load(self):
        """Read secret values from /run/secrets/ files + env."""
        secrets_dir = "/run/secrets"
        if os.path.isdir(secrets_dir):
            for name in os.listdir(secrets_dir):
                path = os.path.join(secrets_dir, name)
                if os.path.isfile(path):
                    try:
                        with open(path) as f:
                            val = f.read().strip()
                        if len(val) >= 8:
                            self._secrets.append(val)
                    except PermissionError:
                        self._log.warning("relay.redactor_skip", extra={"path": path, "reason": "permission_denied"})
        # Also redact secrets from mounted env file if readable
        env_file = "/mnt/abox-state/secrets/env"
        if os.path.isfile(env_file):
            try:
                with open(env_file) as f:
                    env_lines = f.readlines()
                for line in env_lines:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        val = line.split("=", 1)[1].strip().strip("'\"")
                        if len(val) >= 8:
                            self._secrets.append(val)
            except PermissionError:
                self._log.warning("relay.redactor_skip", extra={"path": env_file, "reason": "permission_denied"})
        # Sort longest first so longer secrets are replaced before substrings
        self._secrets.sort(key=len, reverse=True)
        if self._secrets:
            self._log.info("relay.redactor_loaded", extra={"secrets": len(self._secrets)})

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
        the json.dumps->replace->json.loads pattern which breaks when secrets
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


# ---------------------------------------------------------------------------
# WebSocket transport
# ---------------------------------------------------------------------------


class FatalWSClose(Exception):
    """Backend rejected the connection with a non-retryable close code."""

    def __init__(self, code: int, reason: str = ""):
        self.code = code
        self.reason = reason
        super().__init__(f"Fatal WS close: code={code} reason={reason}")


class WSTransport:
    """WebSocket connection to the backend relay endpoint.

    Handles connect, reconnect, send, and receive. No fallback —
    if WS is down, events are lost until reconnection succeeds.
    """

    def __init__(self, log=None):
        self.ws = None
        self._connected = False
        self._reconnect_delay = WS_RECONNECT_DELAY_S
        self._log = log or _setup_logging("abox-relay")
        self._send_seq = 0
        self._recv_seq = 0

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
            self._log.info("relay.ws_connected")
            return True
        except websockets.exceptions.InvalidStatus as exc:
            # HTTP-level rejection before upgrade completed (e.g. 403).
            code = exc.response.status_code if hasattr(exc, "response") else 0
            self._log.warning("relay.ws_rejected", extra={"status": code, "reason": str(exc)})
            self._connected = False
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalWSClose(code, str(exc)) from exc
            return False
        except websockets.exceptions.ConnectionClosed as exc:
            # Server accepted the upgrade then immediately sent a close frame
            # (this is how our consumer rejects: accept() then close(code=4001)).
            code = exc.rcvd.code if exc.rcvd else 0
            reason = exc.rcvd.reason if exc.rcvd else ""
            self._log.warning("relay.ws_closed_on_connect", extra={"code": code, "reason": reason})
            self._connected = False
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalWSClose(code, reason) from exc
            return False
        except Exception as exc:  # intentional: WS connect can fail for transient network reasons — caller retries via reconnect()
            self._log.warning("relay.ws_connect_failed", extra={"error": str(exc), "agent_id": AGENT_ID, "operation": "ws_connect"})
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
            wire = json.dumps(event)
            t0 = time.monotonic()
            await self.ws.send(wire)
            self._send_seq += 1
            self._log.debug("relay.ws_tx", extra={
                "seq": self._send_seq,
                "type": event.get("type", ""),
                "subtype": event.get("subtype", ""),
                "session_id": event.get("session_id", ""),
                "bytes": len(wire),
                "ms": round((time.monotonic() - t0) * 1000, 1),
            })
            return True
        except Exception as exc:  # intentional: WS send failure marks connection down — caller will reconnect and retry
            self._log.warning("relay.ws_send_error", extra={"error": str(exc), "type": type(exc).__name__, "agent_id": AGENT_ID, "operation": "ws_send"})
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
            self._log.warning("relay.ws_recv_closed", extra={"code": code, "reason": reason})
            self._connected = False
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalWSClose(code, reason) from exc
            return None
        except Exception:  # intentional: WS recv failure marks connection down — caller reconnects
            self._log.warning("relay.ws_recv_failed", extra={"agent_id": AGENT_ID, "operation": "ws_recv"})
            self._connected = False
            return None

        try:
            cmd = json.loads(data)
        except (json.JSONDecodeError, TypeError) as exc:
            self._log.warning("relay.ws_recv_malformed_json", extra={"error": str(exc)})
            return None

        self._recv_seq += 1
        self._log.debug("relay.ws_rx", extra={
            "seq": self._recv_seq,
            "type": cmd.get("type", ""),
            "bytes": len(data) if isinstance(data, (str, bytes)) else 0,
        })
        return cmd

    @property
    def connected(self) -> bool:
        return self._connected

    async def close(self):
        if self.ws:
            try:
                await self.ws.close()
            except Exception:  # intentional: WS close is best-effort cleanup — socket may already be dead
                pass
            self._connected = False


# ---------------------------------------------------------------------------
# Event sending with buffering
# ---------------------------------------------------------------------------


class EventSender:
    """Send events to backend via WSTransport with redaction and buffering.

    Encapsulates the redact → flush buffer → send → retry → buffer pattern
    that both relays need. Critical events (result, system) are buffered
    on send failure; non-critical events are dropped with a warning.
    """

    def __init__(self, ws: WSTransport, redactor: Redactor, log=None):
        self.ws = ws
        self._redactor = redactor
        self._event_buffer: deque[dict] = deque(maxlen=20)
        self._log = log or _setup_logging("abox-relay")
        self._send_seq = 0
        self._dropped_critical = 0

    async def send(self, event: dict):
        """Send an event to the backend via WS.

        If the send fails, attempt reconnect and retry once.
        If that also fails, buffer critical events for later delivery.
        Raises FatalWSClose if reconnect hits a non-retryable code.
        """
        # Redact secrets before any WS send
        event = self._redactor.redact_event(event)
        self._send_seq += 1
        event_type = event.get("type", "")

        # Flush any previously buffered events first
        await self.flush_buffer()

        sent = await self.ws.send(event)
        if sent:
            self._log.info("relay.event_sent", extra={
                "seq": self._send_seq, "type": event_type,
                "subtype": event.get("subtype", ""),
            })
            return

        self._log.warning("relay.ws_send_failed")
        reconnected = await self.ws.reconnect()  # may raise FatalWSClose
        if reconnected:
            await self.flush_buffer()
            sent = await self.ws.send(event)
            if sent:
                return

        # Buffer critical events instead of dropping
        event_type = event.get("type", "")
        if event_type in CRITICAL_EVENT_TYPES:
            overflowed = len(self._event_buffer) == self._event_buffer.maxlen
            self._event_buffer.append(event)
            if overflowed:
                self._dropped_critical += 1
                self._log.error("relay.event_buffer_overflow", extra={
                    "error_code": ERR_RELAY_BUFFER_OVERFLOW,
                    "type": event_type,
                    "buffer_size": len(self._event_buffer),
                    "dropped_critical": self._dropped_critical,
                })
            self._log.warning("relay.event_buffered", extra={"type": event_type, "buffer_size": len(self._event_buffer)})
        else:
            self._log.warning("relay.event_dropped", extra={"type": event_type})

    async def flush_buffer(self):
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
            self._log.info("relay.event_buffer_flushed", extra={"flushed": flushed, "remaining": len(self._event_buffer)})


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def validate_config():
    """Check required env vars. Crash early with clear message if missing."""
    if not AGENT_ID:
        raise SystemExit("FATAL: AGENT_ID not set")
    if not CALLBACK_URL:
        raise SystemExit("FATAL: ABOX_CALLBACK_URL not set")
