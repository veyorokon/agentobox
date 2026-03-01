"""WebSocket consumers: agent relay and VNC proxy.

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

from datetime import timedelta

import structlog
from channels.generic.websocket import AsyncJsonWebsocketConsumer, AsyncWebsocketConsumer
from channels.layers import get_channel_layer

from agents.models import StreamEvent

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
        from agents.services.auth_relay import get_relay_agent

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
            self.agent = await get_relay_agent(token)
        except ValueError:
            reason = "bad_token" if token else "missing_token"
            log.warning("relay_ws_reject", reason=reason, agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        # Verify agent ID matches the URL
        if str(self.agent.id) != self.agent_id:
            log.warning("relay_ws_reject", reason="agent_id_mismatch", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Track relay connection state
        self.agent.relay_connected = True
        await self.agent.asave(update_fields=["relay_connected"])

        # Start the background reconciliation loop on first relay connect
        from agents.services.reconcile import ensure_running
        ensure_running()

        # Backfill pending user messages that arrived while the relay was
        # genuinely down (container freshly created). On transient WS reconnects
        # (backend restart, network blip) the relay stayed alive — Claude already
        # has these messages in context. Replaying them causes duplicate turns.
        from agents.models import AgentStatus
        if self.agent.status == AgentStatus.DEPLOYING:
            backfill_cutoff = self.agent.updated_at - timedelta(seconds=30)
            pending = StreamEvent.objects.filter(
                agent_id=self.agent_id,
                event_type="user",
                created_at__gte=backfill_cutoff,
            ).order_by("created_at")

            # Valid Anthropic content block types — anything prefixed with _ is
            # internal metadata (e.g. _broadcast) and must be stripped before
            # sending to Claude's stdin.
            _VALID_CONTENT_TYPES = {"text", "image", "tool_result", "tool_use"}

            async for event in pending:
                data = event.data
                msg = data.get("message", {})
                content = msg.get("content", "")
                # Only replay text user messages, not tool_result events
                if isinstance(content, str) and content.strip():
                    await self.send_json({
                        "type": "input",
                        "payload": {"type": "user", "message": {"role": "user", "content": content}},
                    })
                elif isinstance(content, list):
                    # Strip internal metadata blocks (type starting with _)
                    clean = [b for b in content if isinstance(b, dict) and b.get("type", "") in _VALID_CONTENT_TYPES]
                    # Check if it's a text-only content block list (not tool_result)
                    text_parts = [b for b in clean if b.get("type") == "text"]
                    if text_parts and not any(b.get("type") == "tool_result" for b in clean):
                        await self.send_json({
                            "type": "input",
                            "payload": {"type": "user", "message": {"role": "user", "content": clean}},
                        })

        log.info("relay_ws_connected", agent_id=self.agent_id)

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

        # Track relay connection state — use filter().aupdate() because
        # self.agent may be stale or the agent row may have been deleted.
        try:
            from agents.models import Agent
            await Agent.objects.filter(id=self.agent_id).aupdate(relay_connected=False)
        except Exception:  # intentional: agent row may be deleted — don't crash disconnect handler
            log.exception("relay_connected_update_failed", agent_id=self.agent_id)

        log.info("relay_ws_disconnected", agent_id=self.agent_id, code=code)

    async def receive_json(self, content):
        """Each message from relay = one raw stream-json event.

        Callback requests are routed to the callbacks service before
        reaching stream processing — they create feed items, not stream events.
        Everything else: store verbatim, broadcast, side-effect.
        """
        event_type = content.get("type", "")

        if event_type == "callback":
            from agents.services.callbacks import process_callback
            try:
                await process_callback(self.agent, content)
            except Exception:  # intentional: callback failure must not break relay WS — log and continue
                log.exception("callback_request_failed", agent_id=self.agent_id)
            return

        from agents.services.stream import process_stream_event

        try:
            await process_stream_event(self.agent, content)
        except Exception:  # intentional: one bad event must not kill the relay WS connection
            log.exception(
                "relay_ws_event_failed",
                agent_id=self.agent_id,
                event_type=event_type,
            )

    # ── Downstream: backend → relay ──
    # These handlers receive group_send messages and forward to the WS client.

    async def relay_command(self, event):
        """Forward a command (input, signal, mode) to the relay."""
        await self.send_json(event["command"])


class VncProxyConsumer(AsyncWebsocketConsumer):
    """Binary WebSocket proxy: browser ↔ backend ↔ websockify ↔ x11vnc.

    Auth: short-lived token from Redis cache (set by createVncToken mutation).
    Token is consumed on first use (single-use).

    Route: /ws/vnc/<agent_id>/?token=xxx
    """

    async def connect(self):
        import asyncio
        import websockets

        self.agent_id = str(self.scope["url_route"]["kwargs"]["agent_id"])
        self.upstream_ws = None
        self._relay_task = None

        # Extract token from query string
        query_string = self.scope.get("query_string", b"").decode()
        params = dict(p.split("=", 1) for p in query_string.split("&") if "=" in p)
        token = params.get("token", "")

        if not token:
            log.warning("vnc_proxy_reject", reason="no_token", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        # Validate and consume token from cache
        from django.core.cache import cache
        cache_key = f"vnc_token:{token}"
        cached_agent_id = cache.get(cache_key)

        if not cached_agent_id or str(cached_agent_id) != self.agent_id:
            log.warning("vnc_proxy_reject", reason="bad_token", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        # Consume the token (single-use)
        cache.delete(cache_key)

        # Look up agent's VNC URL
        from agents.models import Agent
        try:
            agent = await Agent.objects.aget(id=self.agent_id)
        except Agent.DoesNotExist:
            log.warning("vnc_proxy_reject", reason="agent_not_found", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4004)
            return

        if not agent.vnc_url:
            log.warning("vnc_proxy_reject", reason="no_vnc_url", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4002)
            return

        # Convert HTTP VNC URL to websockify WS URL
        # e.g. http://host:6080/vnc.html → ws://host:6080/websockify
        vnc_ws_url = agent.vnc_url.replace("http://", "ws://").replace("https://", "wss://")
        if "/vnc" in vnc_ws_url:
            vnc_ws_url = vnc_ws_url.split("/vnc")[0] + "/websockify"
        elif not vnc_ws_url.endswith("/websockify"):
            vnc_ws_url = vnc_ws_url.rstrip("/") + "/websockify"

        try:
            self.upstream_ws = await websockets.connect(
                vnc_ws_url,
                subprotocols=["binary"],
                max_size=2**20,
                open_timeout=10,
            )
        except Exception:  # intentional: upstream connect failure — reject client with 4003 instead of crashing
            log.exception("vnc_proxy_upstream_failed", agent_id=self.agent_id, url=vnc_ws_url)
            await self.accept()
            await self.close(code=4003)
            return

        await self.accept(subprotocol="binary")

        # Start relay task: upstream → downstream
        self._relay_task = asyncio.create_task(self._relay_upstream())
        log.info("vnc_proxy_connected", agent_id=self.agent_id)

    async def _relay_upstream(self):
        """Read frames from upstream websockify and send to browser."""
        try:
            async for message in self.upstream_ws:
                if isinstance(message, bytes):
                    await self.send(bytes_data=message)
                else:
                    await self.send(text_data=message)
        except Exception:  # intentional: upstream WS close/error ends relay loop — normal teardown path
            log.debug("vnc_proxy_upstream_closed", agent_id=self.agent_id)
        finally:
            await self.close()

    async def receive(self, text_data=None, bytes_data=None):
        """Forward browser frames to upstream websockify."""
        if self.upstream_ws:
            try:
                if bytes_data:
                    await self.upstream_ws.send(bytes_data)
                elif text_data:
                    await self.upstream_ws.send(text_data)
            except Exception:  # intentional: upstream send failure — close proxy cleanly
                log.debug("vnc_proxy_send_failed", agent_id=self.agent_id)
                await self.close()

    async def disconnect(self, code):
        if self._relay_task:
            self._relay_task.cancel()
        if self.upstream_ws:
            try:
                await self.upstream_ws.close()
            except Exception:  # intentional: upstream WS may already be closed during teardown
                log.debug("vnc_proxy_upstream_close_error", agent_id=self.agent_id, exc_info=True)
        log.info("vnc_proxy_disconnected", agent_id=self.agent_id, code=code)
