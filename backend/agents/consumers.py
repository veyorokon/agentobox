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

import structlog
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, AsyncWebsocketConsumer
from channels.layers import get_channel_layer
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
from agents.models import StreamEvent

log = structlog.get_logger("abox.relay")


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
        self.agent.relay_connected = True
        await self.agent.asave(update_fields=["relay_connected"])

        # Start the background reconciliation loop on first relay connect
        from agents.services.reconcile import ensure_running
        ensure_running()

        # Transition DEPLOYING → IDLE. No backfill needed — messages are
        # on the volume (inbox.jsonl) and the relay reads them on startup.
        # Theme is also on the volume (tokens.json), applied by init-volume.
        from agents.models import Agent, AgentStatus
        from agents.services.lifecycle import transition_agent_status
        if self.agent.status == AgentStatus.DEPLOYING:
            now = timezone.now()
            transition_agent_status(self.agent, AgentStatus.IDLE, reason="relay_connected")
            await Agent.objects.filter(id=self.agent_id).aupdate(
                status=AgentStatus.IDLE,
                deployed_at=now,
            )
            self.agent.deployed_at = now
            from agents.services.lifecycle import succeed_active_lifecycle_attempts
            await succeed_active_lifecycle_attempts(
                self.agent_id,
                step="relay_connected",
                metadata={"relay_connected_at": now.isoformat()},
            )
            from agents.services.broadcast import broadcast_agent_update
            await broadcast_agent_update(self.agent)

        log.info("relay.connected", agent_id=self.agent_id)

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

        # Track relay connection state. No delivery cursor needed —
        # inbox.pos on the volume handles delivery guarantees.
        try:
            from django.utils import timezone
            from agents.models import Agent

            await Agent.objects.filter(id=self.agent_id).aupdate(
                relay_connected=False,
                relay_disconnected_at=timezone.now(),
            )
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
                    await self.send_json({
                        "type": "callback_response",
                        "request_id": request_id,
                        "behavior": "deny",
                        "message": "Internal error processing callback",
                    })
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
            log.exception(
                "vnc.upstream_failed",
                agent_id=self.agent_id,
                url=vnc_ws_url,
                error_code=ERR_CONSUMER_VNC_UPSTREAM_FAILED,
                error_class=type(exc).__name__,
                operation="connect_vnc_upstream",
            )
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


async def _serialize_agent_for_ws(agent) -> dict:
    """Serialize an Agent model instance to match AgentType GraphQL shape.

    Includes __typename for Apollo cache normalization and _t for WS
    message type discrimination. Field names are camelCase to match
    Strawberry's auto-conversion.
    """
    from agents.adapters import get_adapter
    from agents.models import AgentLifecycleAttempt, AgentTask

    adapter = get_adapter(agent.agent_type)

    # Task progress (sync ORM → thread)
    def _count_tasks():
        qs = AgentTask.objects.filter(agent_id=agent.id)
        total = qs.count()
        if not total:
            return None
        done = qs.filter(status="completed").count()
        return {"__typename": "TaskProgressType", "done": done, "total": total}

    task_progress = await sync_to_async(_count_tasks, thread_sensitive=False)()

    # Task list (sync ORM → thread)
    def _fetch_tasks():
        return list(
            AgentTask.objects.filter(agent_id=agent.id)
            .exclude(status="deleted")
            .order_by("created_at")
            .values(
                "task_id", "title", "description", "status",
                "assignee", "active_form", "blocked_by", "created_at", "updated_at",
            )
        )

    tasks_raw = await sync_to_async(_fetch_tasks, thread_sensitive=False)()
    tasks = [
        {
            "__typename": "AgentTaskType",
            "taskId": t["task_id"],
            "title": t["title"],
            "description": t["description"],
            "status": t["status"],
            "assignee": t["assignee"],
            "activeForm": t["active_form"],
            "blockedBy": t["blocked_by"],
            "createdAt": t["created_at"].isoformat(),
            "updatedAt": t["updated_at"].isoformat(),
        }
        for t in tasks_raw
    ]

    # Lifecycle attempts (last 10, descending)
    def _fetch_lifecycle_attempts():
        return list(
            AgentLifecycleAttempt.objects.filter(agent_id=agent.id)
            .order_by("-started_at")[:10]
            .values(
                "id", "kind", "status", "step", "attempt_no",
                "correlation_id", "error_code", "error_detail",
                "started_at", "finished_at",
            )
        )

    attempts_raw = await sync_to_async(_fetch_lifecycle_attempts, thread_sensitive=False)()
    lifecycle_attempts = [
        {
            "__typename": "LifecycleAttemptType",
            "id": str(a["id"]),
            "kind": a["kind"],
            "status": a["status"],
            "step": a["step"],
            "attemptNo": a["attempt_no"],
            "correlationId": a["correlation_id"],
            "errorCode": a["error_code"],
            "errorDetail": a["error_detail"],
            "startedAt": a["started_at"].isoformat() if a["started_at"] else None,
            "finishedAt": a["finished_at"].isoformat() if a["finished_at"] else None,
        }
        for a in attempts_raw
    ]

    # MCP servers: dict → list of keys
    mcp = agent.mcp_servers
    if isinstance(mcp, dict):
        mcp_list = list(mcp.keys())
    elif isinstance(mcp, list):
        mcp_list = mcp
    else:
        mcp_list = []

    return {
        "__typename": "AgentType",
        "_t": "agent",
        "id": str(agent.id),
        "name": agent.name,
        "model": agent.model,
        "role": agent.role,
        "instructions": agent.instructions,
        "runtime": agent.runtime,
        "phase": agent.phase,
        "tags": agent.tags,
        "mode": agent.mode,
        "attentionLevel": agent.attention_level,
        "relayConnected": agent.relay_connected,
        "task": agent.task,
        "errorMessage": agent.error_message or "",
        "lifecycleStatus": agent.status,
        "lastOutput": adapter.last_output(agent.latest_snapshot),
        "liveAction": adapter.live_action(agent.latest_snapshot) or None,
        "cost": float(agent.session_cost_usd),
        "duration": adapter.duration(agent.latest_snapshot),
        "turns": adapter.turns(agent.latest_snapshot),
        "allowedTools": agent.allowed_tools if isinstance(agent.allowed_tools, list) else [],
        "workspacePath": agent.workspace_path,
        "mcpServers": mcp_list,
        "triggers": agent.triggers if isinstance(agent.triggers, list) else [],
        "computeSeconds": agent.compute_seconds or 0,
        "taskProgress": task_progress,
        "tasks": tasks,
        "lifecycleAttempts": lifecycle_attempts,
    }


def _serialize_feed_item_for_ws(item) -> dict:
    """Serialize a TeamFeedItem model instance to match TeamFeedItemType GraphQL shape."""
    questions = None
    if item.questions:
        questions = [
            {"__typename": "FeedQuestionType", "text": q.get("text", ""), "options": q.get("options", [])}
            for q in item.questions
        ]

    return {
        "__typename": "TeamFeedItemType",
        "_t": "feed",
        "id": str(item.id),
        "type": item.type,
        "agent": item.agent_name or None,
        "agentId": str(item.agent_record_id) if item.agent_record_id else None,
        "text": item.text or None,
        "command": item.command or None,
        "risk": item.risk or None,
        "permStatus": item.perm_status or None,
        "title": item.title or None,
        "plan": item.plan or None,
        "planStatus": item.plan_status or None,
        "summary": item.summary or None,
        "cost": float(item.cost) if item.cost is not None else None,
        "turns": item.turns,
        "duration": item.duration or None,
        "isError": item.is_error,
        "target": item.target or None,
        "question": item.question or None,
        "options": item.options if item.options else None,
        "questions": questions,
        "from": item.from_value or None,
        "to": item.to_value or None,
    }


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

        agents = [a async for a in Agent.objects.filter(project_id=self.project_id)]
        agent_dicts = [await _serialize_agent_for_ws(a) for a in agents]

        items = [
            item async for item in TeamFeedItem.objects.filter(
                project_id=self.project_id,
            ).order_by("created_at")[:500]
        ]
        feed_dicts = [_serialize_feed_item_for_ws(item) for item in items]

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
