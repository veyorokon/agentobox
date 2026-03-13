"""Broadcast agent updates via status events, feed items, and dashboard WebSocket.

    broadcast_agent_update(agent) — detects status changes, creates StreamEvents
    and feed items, and pushes full agent state to the dashboard WebSocket group.

Status change detection works via Agent.from_db() setting _original_status.
Dashboard WS push runs on every call (not just status changes) to cover
phase, attention, snapshot, and other state updates.
"""

import structlog
from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer

from agents.errors import ERR_BROADCAST_DASHBOARD_PUSH_FAILED
from agents.models import Agent, StreamEvent

log = structlog.get_logger("abox.broadcast")


def _create_status_event_sync(agent: Agent, old_status: str) -> StreamEvent:
    """Create a status-change StreamEvent using sync ORM.

    Must run via sync_to_async(thread_sensitive=False) so it gets its own
    thread instead of the request's CurrentThreadExecutor — which may already
    be torn down if this runs inside an asyncio.create_task() that outlives
    the original HTTP request (e.g. _provision_agent).
    """
    return StreamEvent.objects.create(
        agent=agent,
        session_id=agent.session_id or "",
        event_type="status",
        data={"from": old_status, "to": agent.status},
    )


_create_status_event = sync_to_async(_create_status_event_sync, thread_sensitive=False)


async def broadcast_agent_update(agent: Agent) -> None:
    """Detect status changes and create StreamEvents + feed items.

    Uses _original_status from Agent.from_db() to detect transitions.
    Dashboard picks up changes via polling.
    """
    old_status = getattr(agent, "_original_status", None)
    if old_status is not None and old_status != agent.status:
        log.info(
            "broadcast.agent_updated",
            agent_id=str(agent.id),
            agent_name=agent.name,
            from_status=old_status,
            to_status=agent.status,
        )
        event = await _create_status_event(agent, old_status)
        # Reset to prevent double-emission on subsequent broadcasts
        agent._original_status = agent.status

        # Create status feed item only for significant transitions.
        # Routine idle↔running cycling is noise — the agent card status
        # dot already signals that. Feed items are for things worth reading.
        _ROUTINE = {("running", "idle"), ("idle", "running")}
        if (old_status, agent.status) not in _ROUTINE:
            from agents.services.feed import create_feed_item
            await create_feed_item(
                project_id=str(agent.project_id),
                source_event=event,
                agent_record=agent,
                type="status",
                agent_name=agent.name,
                from_value=old_status,
                to_value=agent.status,
            )

    # Push agent state to dashboard WebSocket group (runs on every call,
    # not just status changes — phase, attention, snapshot updates too).
    try:
        from agents.serializers import serialize_agent
        channel_layer = get_channel_layer()
        payload = await serialize_agent(agent)
        payload["_t"] = "agent"
        await channel_layer.group_send(
            f"dashboard_{agent.project_id}",
            {"type": "dashboard.agent_update", "payload": payload},
        )
    except Exception as exc:  # intentional: dashboard push failure must not break agent lifecycle
        log.warning(
            "broadcast.dashboard_push_failed",
            agent_id=str(agent.id),
            error_code=ERR_BROADCAST_DASHBOARD_PUSH_FAILED,
            error_class=type(exc).__name__,
            operation="push_agent_to_dashboard",
            exc_info=True,
        )
