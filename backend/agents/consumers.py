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

import socket

import structlog
from channels.generic.websocket import AsyncJsonWebsocketConsumer, AsyncWebsocketConsumer
from django.utils import timezone

from agents.errors import (
    ERR_CONSUMER_CALLBACK_FAILED,
    ERR_CONSUMER_EVENT_FAILED,
    ERR_CONSUMER_RELAY_UPDATE_FAILED,
    ERR_CONSUMER_VNC_CLOSE_FAILED,
    ERR_CONSUMER_VNC_SEND_FAILED,
    ERR_CONSUMER_VNC_UPSTREAM_CLOSED,
    ERR_CONSUMER_VNC_UPSTREAM_FAILED,
)

log = structlog.get_logger("abox.relay")
VNC_STARTUP_GRACE_S = 15


def _is_recently_deployed(agent) -> bool:
    deployed_at = getattr(agent, "deployed_at", None)
    if not deployed_at:
        return False
    return (timezone.now() - deployed_at).total_seconds() <= VNC_STARTUP_GRACE_S


def _is_transient_vnc_upstream_failure(agent, exc: Exception) -> bool:
    """Treat startup-time VNC misses as transient while the desktop is still coming up."""
    from agents.models import AgentStatus

    if isinstance(exc, socket.gaierror):
        return getattr(agent, "status", "") == AgentStatus.DEPLOYING or not getattr(agent, "relay_connected", False)

    if isinstance(exc, (ConnectionRefusedError, TimeoutError, OSError)):
        return (
            getattr(agent, "status", "") == AgentStatus.DEPLOYING
            or not getattr(agent, "relay_connected", False)
            or _is_recently_deployed(agent)
        )

    return False


def _should_mark_vnc_runtime_unavailable(agent, exc: Exception) -> bool:
    from agents.models import AgentStatus

    if _is_transient_vnc_upstream_failure(agent, exc):
        return False

    return (
        isinstance(exc, (socket.gaierror, ConnectionRefusedError, ConnectionResetError, TimeoutError, OSError))
        and getattr(agent, "status", "") in {AgentStatus.IDLE, AgentStatus.RUNNING, AgentStatus.WAITING}
        and bool(getattr(agent, "relay_connected", False))
        and bool(getattr(agent, "sandbox_id", ""))
    )


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
            log.warning("relay.rejected", reason=reason, agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        # Verify agent ID matches the URL
        if str(self.agent.id) != self.agent_id:
            log.warning("relay.rejected", reason="agent_id_mismatch", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Track relay connection state
        from agents.models import AgentStatus

        self.agent.relay_connected = True
        update_fields = ["relay_connected"]
        if self.agent.status == AgentStatus.DEPLOYING and not getattr(self.agent, "deployed_at", None):
            self.agent.deployed_at = timezone.now()
            update_fields.append("deployed_at")
        await self.agent.asave(update_fields=update_fields)

        # Start the background reconciliation loop on first relay connect
        from agents.services.reconcile import ensure_running
        ensure_running()

        from agents.services.broadcast import broadcast_agent_update
        await broadcast_agent_update(self.agent)

        log.info("relay.connected", agent_id=self.agent_id)

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

        # Track relay connection state. Message durability is handled by the
        # runtime-owned inbox cursor under _abox/.
        try:
            from django.utils import timezone
            from agents.models import Agent
            from agents.services.broadcast import broadcast_agent_update

            await Agent.objects.filter(id=self.agent_id).aupdate(
                relay_connected=False,
                relay_disconnected_at=timezone.now(),
            )
            agent = await Agent.objects.aget(id=self.agent_id)
            await broadcast_agent_update(agent)
        except Exception as exc:  # intentional: agent row may be deleted — don't crash disconnect handler
            log.warning(
                "relay.update_failed",
                agent_id=self.agent_id,
                error_code=ERR_CONSUMER_RELAY_UPDATE_FAILED,
                error_class=type(exc).__name__,
                operation="update_relay_state",
                exc_info=True,
            )

        disconnect_source = "server" if code and 4000 <= code <= 4999 else "client"
        log.info("relay.disconnected", agent_id=self.agent_id, code=code, source=disconnect_source)

    async def receive_json(self, content):
        """Handle canonical upstream runtime messages from the agent.

        The new runtime sends typed envelopes:
        - runtime_hello
        - runtime_status
        - task_update
        - execution_event
        - callback_request

        execution_event/raw_message carries the actual Claude stream-json event
        payload used by the existing backend read path. That path remains the
        source of truth for feed/session semantics, so we unwrap and forward
        those payloads into process_stream_event().
        """
        event_type = content.get("type", "")

        if event_type in {"callback", "callback_request"}:
            from agents.services.callbacks import process_callback
            try:
                await process_callback(self.agent, content)
            except Exception as exc:  # intentional: callback failure must not break relay WS — log and send deny
                log.exception(
                    "relay.callback_failed",
                    agent_id=self.agent_id,
                    error_code=ERR_CONSUMER_CALLBACK_FAILED,
                    error_class=type(exc).__name__,
                    operation="process_callback",
                )
                # Send deny response so the relay's Future resolves immediately
                # instead of hanging for the 300s timeout.
                request_id = content.get("request_id", "")
                if request_id:
                    from agents.services.relay_commands import CallbackBehavior, CallbackResponseCommand
                    cmd = CallbackResponseCommand(
                        request_id=request_id,
                        behavior=CallbackBehavior.DENY,
                        message="Internal error processing callback",
                    )
                    await self.send_json(cmd.to_wire())
            return

        if event_type == "runtime_hello":
            log.info(
                "relay.runtime_hello",
                agent_id=self.agent_id,
                mode=content.get("mode", ""),
                platform=content.get("platform", ""),
                profile=content.get("profile", ""),
                protocol_version=content.get("protocol_version", ""),
            )
            return

        if event_type == "runtime_status":
            payload = content.get("payload", {})
            if isinstance(payload, dict):
                from agents.models import Agent, AgentStatus
                from agents.services.broadcast import broadcast_agent_update
                from agents.services.lifecycle import succeed_active_lifecycle_attempts, transition_agent_status
                from agents.services.runtime_projection import runtime_status_meets_ready_boundary

                update_fields = {"runtime_status_projection": payload}
                ready_boundary = runtime_status_meets_ready_boundary(
                    payload,
                    relay_connected=bool(getattr(self.agent, "relay_connected", False)),
                )
                if ready_boundary and self.agent.status == "deploying":
                    transition_agent_status(self.agent, AgentStatus.IDLE, reason="runtime_ready")
                    update_fields["status"] = AgentStatus.IDLE
                    if not getattr(self.agent, "deployed_at", None):
                        now = timezone.now()
                        update_fields["deployed_at"] = now
                await Agent.objects.filter(id=self.agent_id).aupdate(**update_fields)
                if ready_boundary:
                    self.agent = await Agent.objects.aget(id=self.agent_id)
                else:
                    self.agent.runtime_status_projection = payload
                    if "deployed_at" in update_fields:
                        self.agent.deployed_at = update_fields["deployed_at"]
                if ready_boundary:
                    await succeed_active_lifecycle_attempts(
                        self.agent_id,
                        step="runtime_ready",
                        metadata={"startup_stage": payload.get("startup_stage", "")},
                    )
                await broadcast_agent_update(self.agent)
                log.info(
                    "relay.runtime_status",
                    agent_id=self.agent_id,
                    startup_stage=payload.get("startup_stage", ""),
                    runtime_state=payload.get("runtime_state", ""),
                )
            return

        if event_type == "task_update":
            task_id = content.get("task_id", "")
            task_state = content.get("state", "")
            task_data = {
                "task_id": task_id,
                "state": task_state,
            }
            input_text = content.get("input_text", "")
            output_text = content.get("output_text", "")
            error_text = content.get("error", "")
            if isinstance(input_text, str) and input_text:
                task_data["input_text"] = input_text
            if isinstance(output_text, str) and output_text:
                task_data["output_text"] = output_text
            if isinstance(error_text, str) and error_text:
                task_data["error"] = error_text
            log.info(
                "relay.task_update",
                agent_id=self.agent_id,
                task_id=task_id,
                state=task_state,
            )
            # Persist as StreamEvent so task failure evidence is durable
            # and appears in incident bundles via time-windowed event queries.
            try:
                from agents.models import StreamEvent
                await StreamEvent.objects.acreate(
                    agent_id=self.agent_id,
                    session_id=content.get("session_id", ""),
                    event_type="task_update",
                    data=task_data,
                    is_canonical=True,
                )
            except Exception as exc:  # intentional: persistence is secondary — don't crash relay
                log.warning(
                    "relay.task_update_persist_failed",
                    agent_id=self.agent_id,
                    error_class=type(exc).__name__,
                )
            # Update task_started_at when task begins running
            if task_state == "running":
                try:
                    from agents.models import Agent
                    await Agent.objects.filter(id=self.agent_id).aupdate(
                        task_started_at=timezone.now(),
                    )
                except Exception:
                    pass  # best-effort timestamp
            return

        if event_type == "execution_event":
            execution_type = content.get("event_type", "")
            payload = content.get("payload", {})
            if execution_type == "raw_message" and isinstance(payload, dict):
                if content.get("session_id") and "session_id" not in payload:
                    payload = {**payload, "session_id": content["session_id"]}
                from agents.services.stream import process_stream_event

                try:
                    await process_stream_event(self.agent, payload)
                except Exception as exc:  # intentional: one bad event must not kill the relay WS connection
                    log.exception(
                        "relay.event_failed",
                        agent_id=self.agent_id,
                        event_type=payload.get("type", execution_type),
                        error_code=ERR_CONSUMER_EVENT_FAILED,
                        error_class=type(exc).__name__,
                        operation="process_stream_event",
                    )
            # Update last_execution_event_at on all execution events, not just raw_message
            try:
                from agents.models import Agent
                await Agent.objects.filter(id=self.agent_id).aupdate(
                    last_execution_event_at=timezone.now(),
                )
            except Exception:
                pass  # best-effort timestamp
            return

        from agents.services.stream import process_stream_event

        try:
            await process_stream_event(self.agent, content)
        except Exception as exc:  # intentional: one bad event must not kill the relay WS connection
            log.exception(
                "relay.event_failed",
                agent_id=self.agent_id,
                event_type=event_type,
                error_code=ERR_CONSUMER_EVENT_FAILED,
                error_class=type(exc).__name__,
                operation="process_stream_event",
            )

    # ── Downstream: backend → relay ──
    # These handlers receive group_send messages and forward to the WS client.

    async def relay_command(self, event):
        """Forward a command (input, signal, mode) to the relay."""
        await self.send_json(event["command"])

    async def relay_shutdown(self, event):
        """Close the WS connection from server side (e.g. on kill_agent)."""
        await self.close(code=4010)


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
            log.warning("vnc.rejected", reason="no_token", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        # Validate and consume token from cache
        from django.core.cache import cache
        cache_key = f"vnc_token:{token}"
        cached_agent_id = await cache.aget(cache_key)

        if not cached_agent_id or str(cached_agent_id) != self.agent_id:
            log.warning("vnc.rejected", reason="bad_token", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4001)
            return

        # Token is NOT consumed here — the 60s TTL handles expiry.
        # Single-use tokens break React strict mode (dev double-invoke)
        # and multi-tab scenarios where both tabs fire createVncToken.
        self.token_hash = token[:8]

        # Look up agent's VNC URL
        from agents.models import Agent
        try:
            agent = await Agent.objects.aget(id=self.agent_id)
        except Agent.DoesNotExist:
            log.warning("vnc.rejected", reason="agent_not_found", agent_id=self.agent_id)
            await self.accept()
            await self.close(code=4004)
            return

        if not agent.vnc_url:
            log.warning("vnc.rejected", reason="no_vnc_url", agent_id=self.agent_id)
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

        log.info("vnc.connecting", agent_id=self.agent_id, token_hash=self.token_hash, url=vnc_ws_url)
        try:
            self.upstream_ws = await websockets.connect(
                vnc_ws_url,
                # 16 MB — VNC frames with high-res screenshots can exceed 1 MB.
                max_size=16 * 2**20,
                open_timeout=10,
            )
            log.info("vnc.upstream_ok", agent_id=self.agent_id, subprotocol=str(self.upstream_ws.subprotocol))
        except Exception as exc:  # intentional: upstream connect failure — reject client with 4003 instead of crashing
            log_payload = {
                "agent_id": self.agent_id,
                "url": vnc_ws_url,
                "error_code": ERR_CONSUMER_VNC_UPSTREAM_FAILED,
                "error_class": type(exc).__name__,
                "operation": "connect_vnc_upstream",
                "lifecycle_status": getattr(agent, "status", ""),
                "relay_connected": bool(getattr(agent, "relay_connected", False)),
            }
            if _is_transient_vnc_upstream_failure(agent, exc):
                log.warning("vnc.upstream_unready", **log_payload)
            else:
                log.exception("vnc.upstream_failed", **log_payload)

            if _should_mark_vnc_runtime_unavailable(agent, exc):
                from agents.services.broadcast import broadcast_agent_update
                from agents.services.utils import mark_agent_runtime_unavailable

                updated_agent = await mark_agent_runtime_unavailable(
                    self.agent_id,
                    reason="vnc_upstream_missing",
                    error_message="Desktop runtime is unavailable. Redeploy to restore preview.",
                )
                await broadcast_agent_update(updated_agent)
            await self.accept()
            await self.close(code=4003)
            return

        await self.accept()

        # Start relay task: upstream → downstream
        self._relay_task = asyncio.create_task(self._relay_upstream())
        log.info("vnc.connected", agent_id=self.agent_id, token_hash=self.token_hash)

    async def _relay_upstream(self):
        """Read frames from upstream websockify and send to browser."""
        try:
            async for message in self.upstream_ws:
                if isinstance(message, bytes):
                    await self.send(bytes_data=message)
                else:
                    await self.send(text_data=message)
        except Exception as exc:  # intentional: upstream WS close/error ends relay loop — normal teardown path
            log.debug(
                "vnc.upstream_closed",
                agent_id=self.agent_id,
                error_code=ERR_CONSUMER_VNC_UPSTREAM_CLOSED,
                error_class=type(exc).__name__,
                operation="relay_upstream_frames",
            )
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
            except Exception as exc:  # intentional: upstream send failure — close proxy cleanly
                log.debug(
                    "vnc.send_failed",
                    agent_id=self.agent_id,
                    error_code=ERR_CONSUMER_VNC_SEND_FAILED,
                    error_class=type(exc).__name__,
                    operation="send_to_vnc_upstream",
                )
                await self.close()

    async def disconnect(self, code):
        if self._relay_task:
            self._relay_task.cancel()
        if self.upstream_ws:
            try:
                await self.upstream_ws.close()
            except Exception as exc:  # intentional: upstream WS may already be closed during teardown
                log.debug(
                    "vnc.upstream_close_error",
                    agent_id=self.agent_id,
                    error_code=ERR_CONSUMER_VNC_CLOSE_FAILED,
                    error_class=type(exc).__name__,
                    operation="close_vnc_upstream",
                    exc_info=True,
                )
        disconnect_source = "server" if code and 4000 <= code <= 4999 else "client"
        log.info("vnc.disconnected", agent_id=self.agent_id, code=code, source=disconnect_source)


# ── Dashboard WebSocket ──────────────────────────────────────────────────

dashboard_log = structlog.get_logger("abox.dashboard")


class DashboardConsumer(AsyncJsonWebsocketConsumer):
    """Project-scoped WebSocket for real-time dashboard updates.

    Replaces polling with server-push. Auth flow:
    1. Client connects to ws/dashboard/<project_id>/
    2. First message must be {"type": "auth", "token": "<jwt>"}
    3. On success: joins group, sends snapshot, then streams incremental updates
    4. On failure: closes with code 4001

    Groups:
        dashboard_{project_id} — receives agent updates and feed items
        from broadcast.py and feed.py via channel layer group_send.
    """

    async def connect(self):
        self.project_id = str(self.scope["url_route"]["kwargs"]["project_id"])
        self.group_name = f"dashboard_{self.project_id}"
        self.authenticated = False
        await self.accept()

    async def receive_json(self, content):
        if not self.authenticated:
            if content.get("type") != "auth":
                await self.close(code=4001)
                return

            token = content.get("token", "")
            if not token:
                await self.close(code=4001)
                return

            from accounts.auth import adecode_token
            user = await adecode_token(token)
            if not user:
                dashboard_log.warning("dashboard.auth_failed", project_id=self.project_id, reason="bad_token")
                await self.close(code=4001)
                return

            # Check project ownership
            from projects.models import Project
            try:
                await Project.objects.aget(id=self.project_id, owner=user)
            except Project.DoesNotExist:
                dashboard_log.warning("dashboard.auth_failed", project_id=self.project_id, reason="not_owner")
                await self.close(code=4001)
                return

            self.authenticated = True

            # Join group BEFORE fetching snapshot — if an update fires
            # between join and snapshot, the client gets a duplicate (harmless).
            # The alternative (snapshot then join) risks a gap (harmful).
            await self.channel_layer.group_add(self.group_name, self.channel_name)

            await self._send_snapshot()
            dashboard_log.info("dashboard.connected", project_id=self.project_id)
            return

    async def _send_snapshot(self):
        """Send full project state: all agents + recent feed items."""
        from agents.models import Agent, TeamFeedItem
        from agents.serializers import serialize_agent, serialize_feed_item

        agents = [a async for a in Agent.objects.filter(project_id=self.project_id)]
        agent_dicts = []
        for a in agents:
            d = await serialize_agent(a)
            d["_t"] = "agent"
            agent_dicts.append(d)

        items = [
            item async for item in TeamFeedItem.objects.filter(
                project_id=self.project_id,
            ).order_by("created_at")[:500]
        ]
        feed_dicts = []
        for item in items:
            d = serialize_feed_item(item)
            d["_t"] = "feed"
            feed_dicts.append(d)

        await self.send_json({
            "_t": "snapshot",
            "agents": agent_dicts,
            "feed": feed_dicts,
        })

    # ── Group handlers: channel layer → WS client ──

    async def dashboard_agent_update(self, event):
        """Forward agent update payload to the connected dashboard client."""
        await self.send_json(event["payload"])

    async def dashboard_feed_item(self, event):
        """Forward feed item payload to the connected dashboard client."""
        await self.send_json(event["payload"])

    async def disconnect(self, code):
        if self.authenticated:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        dashboard_log.info("dashboard.disconnected", project_id=self.project_id, code=code)
