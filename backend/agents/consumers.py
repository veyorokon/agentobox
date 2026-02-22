"""WebSocket consumer for the agent relay.

Replaces the HTTP POST /agents/<id>/stream endpoint + piggyback pattern.
The relay connects via WebSocket and we get a persistent bidirectional channel:

    upstream (relay → backend):  raw stream-json events, one per WS message
    downstream (backend → relay): commands (input, signal, mode change)

This is deliberately a dumb pipe on the transport layer. The relay sends
every line from Claude Code's stdout verbatim — no filtering, no batching,
no transformation. The backend stores every event as a StreamEvent row.
Intelligence lives in the read path (the frontend), not here.

Why no batching: the old relay batched events in 75ms windows to amortize
HTTP overhead. WebSockets have no per-message overhead worth batching for.
Events flow at wire speed.

Why no filtering: every event type Anthropic adds to stream-json is
automatically captured. Thinking, tool progress, rate limits, deltas —
all stored without code changes. The cost is ~1KB/row in Postgres, which
is negligible compared to the value of having complete agent telemetry.
"""

import structlog
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer

log = structlog.get_logger("agents.relay_ws")


class RelayConsumer(AsyncJsonWebsocketConsumer):
    """Bidirectional WebSocket channel between agent relay and backend.

    Auth: relay sends Authorization header on WS upgrade (Bearer <relay_token>).
    Same pattern as HTTP auth — token never appears in URLs or logs.

    Groups:
        relay_{agent_id} — backend pushes commands to this group,
        relay consumer receives them and forwards to the relay process.
    """

    async def connect(self):
        import hmac
        from agents.models import Agent

        self.agent_id = str(self.scope["url_route"]["kwargs"]["agent_id"])
        self.group_name = f"relay_{self.agent_id}"

        # Extract Bearer token from Authorization header.
        # scope["headers"] is a list of (name, value) byte tuples from the
        # HTTP upgrade request — standard pattern, no query string needed.
        token = ""
        for name, value in self.scope.get("headers", []):
            if name == b"authorization":
                auth_value = value.decode()
                if auth_value.startswith("Bearer "):
                    token = auth_value[7:]
                break

        try:
            self.agent = await Agent.objects.aget(id=self.agent_id)
        except Agent.DoesNotExist:
            log.warning("relay_ws_reject", reason="agent_not_found", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4004)
            return

        if not self.agent.relay_token or not token or not hmac.compare_digest(token, self.agent.relay_token):
            log.warning("relay_ws_reject", reason="bad_token", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Start the background reconciliation loop on first relay connect
        from agents.services.reconcile import ensure_running
        ensure_running()

        log.info("relay_ws_connected", agent_id=self.agent_id)

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)
        log.info("relay_ws_disconnected", agent_id=self.agent_id, code=code)

    async def receive_json(self, content):
        """Each message from relay = one raw stream-json event.

        No batching, no filtering — store verbatim, broadcast, side-effect.
        """
        from agents.services.stream import process_stream_event

        try:
            await process_stream_event(self.agent, content)
        except Exception:
            log.exception(
                "relay_ws_event_failed",
                agent_id=self.agent_id,
                event_type=content.get("type"),
            )

    # ── Downstream: backend → relay ──
    # These handlers receive group_send messages and forward to the WS client.

    async def relay_command(self, event):
        """Forward a command (input, signal, mode) to the relay."""
        await self.send_json(event["command"])
