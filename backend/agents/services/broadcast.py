"""Broadcast agent updates and stream events to Channels groups.

Two broadcast functions, two channel groups. That's it.

    broadcast_agent_update(agent)  → project_{id}_agents  (Agent model state)
    broadcast_event(agent, event)  → project_{id}_events   (StreamEvent log entries)

The old system had 3 functions and 4 groups (agents, events, messages, timeline)
because Messages and AgentEvents were separate tables that needed separate
subscription paths. With StreamEvent as the single source, we need one event
channel group.

Status change detection still works via Agent.from_db() setting _original_status.
When a status change is detected, we create a StreamEvent for it (replacing the
old AgentEvent creation) and broadcast it.
"""

import structlog
from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer

from agents.models import Agent, StreamEvent

log = structlog.get_logger("agents.broadcast")


def _group_name(project_id: str, suffix: str) -> str:
    return f"project_{project_id}_{suffix}"


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
    """Push agent state change to the project's agent_updated subscription.

    Also detects status changes (via _original_status from Agent.from_db)
    and creates a StreamEvent + broadcasts when status differs.
    """
    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "agents")
    try:
        await channel_layer.group_send(
            group,
            {
                "type": "agent.update",
                "agent_id": str(agent.id),
            },
        )
    except Exception:
        log.exception("broadcast_agent_update_failed", group=group)

    # Detect status change and emit a status StreamEvent + feed item
    old_status = getattr(agent, "_original_status", None)
    if old_status is not None and old_status != agent.status:
        event = await _create_status_event(agent, old_status)
        await broadcast_event(agent, event)
        # Reset to prevent double-emission on subsequent broadcasts
        agent._original_status = agent.status

        # Create status feed item
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


async def broadcast_event(agent: Agent, stream_event: StreamEvent) -> None:
    """Push a StreamEvent to the project's event_stream subscription.

    This is the single event broadcast path. Replaces the old trifecta of
    broadcast_stream_message + broadcast_agent_event + _broadcast_timeline_entry.
    """
    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "events")
    created_at_str = (
        stream_event.created_at.isoformat() if stream_event.created_at else ""
    )
    try:
        await channel_layer.group_send(
            group,
            {
                "type": "stream.event",
                "event_id": stream_event.id,
                "event_type": stream_event.event_type,
                "message_id": stream_event.message_id,
                "data": stream_event.data,
                "agent_id": str(agent.id),
                "agent_name": agent.name,
                "session_id": stream_event.session_id,
                "created_at": created_at_str,
            },
        )
    except Exception:
        log.exception("broadcast_event_failed", group=group)
