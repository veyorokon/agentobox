"""Broadcast agent updates and events to Channels groups for GraphQL subscriptions."""

import structlog
from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer

from agents.models import Agent, Message

log = structlog.get_logger("agents.broadcast")


def _group_name(project_id: str, suffix: str) -> str:
    return f"project_{project_id}_{suffix}"


async def _broadcast_timeline_entry(
    agent: Agent,
    *,
    entry_type: str,
    source_id: str,
    summary: str = "",
    data: dict | None = None,
    created_at: str = "",
) -> None:
    """Push a TimelineEntry to the project's timeline_stream subscription."""
    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "timeline")
    await channel_layer.group_send(
        group,
        {
            "type": "timeline.entry",
            "entry_type": entry_type,
            "source_id": source_id,
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "summary": summary,
            "data": data or {},
            "created_at": created_at,
        },
    )


async def broadcast_agent_update(agent: Agent) -> None:
    """Push agent state change to the project's agent_updated subscription.

    Also detects status changes (via _original_status from Agent.from_db)
    and emits a status AgentEvent + timeline entry when the status differs.
    """
    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "agents")
    await channel_layer.group_send(
        group,
        {
            "type": "agent.update",
            "agent_id": str(agent.id),
        },
    )
    log.info(
        "broadcast_agent_update",
        group=group,
        agent_id=str(agent.id),
        status=agent.status,
    )

    # Detect status change and emit a status event
    old_status = getattr(agent, "_original_status", None)
    if old_status is not None and old_status != agent.status:
        summary = f"{agent.name} is now {agent.status}"
        data = {"from": old_status, "to": agent.status}
        await broadcast_agent_event(
            agent, "status", data, summary=summary,
        )
        # Reset to prevent double-emission on subsequent broadcasts
        agent._original_status = agent.status


def _create_agent_event(agent, event_type, data, summary):
    """Sync helper: create AgentEvent in DB."""
    from agents.models import AgentEvent

    return AgentEvent.objects.create(
        agent=agent, event_type=event_type, data=data, summary=summary,
    )


_create_event = sync_to_async(_create_agent_event, thread_sensitive=False)


async def broadcast_agent_event(
    agent: Agent, event_type: str, data: dict, *, summary: str = "",
) -> None:
    """Persist event to DB, then push to the project's new_event and timeline subscriptions."""
    event = await _create_event(agent, event_type, data, summary)

    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "events")
    created_at_str = event.created_at.isoformat()
    await channel_layer.group_send(
        group,
        {
            "type": "agent.event",
            "event_id": event.id,
            "event_type": event_type,
            "data": data,
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "created_at": created_at_str,
        },
    )
    log.info(
        "broadcast_agent_event",
        group=group,
        event_type=event_type,
        agent_id=str(agent.id),
    )

    # Also push to the unified timeline stream
    await _broadcast_timeline_entry(
        agent,
        entry_type=event_type,
        source_id=f"evt_{event.id}",
        summary=summary,
        data=data,
        created_at=created_at_str,
    )


async def broadcast_stream_message(agent: Agent, message: Message) -> None:
    """Push a new/updated stream Message to the project's message_received and timeline subscriptions.

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "messageReceived subscription"
    """
    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "messages")
    await channel_layer.group_send(
        group,
        {
            "type": "stream.message",
            "message_id": message.id,
            "agent_id": str(agent.id),
            "agent_name": agent.name,
        },
    )
    log.debug(
        "broadcast_stream_message",
        group=group,
        message_id=message.id,
        agent_id=str(agent.id),
        role=message.role,
    )

    # Also push to the unified timeline stream
    created_at_str = message.created_at.isoformat() if message.created_at else ""
    await _broadcast_timeline_entry(
        agent,
        entry_type="message",
        source_id=f"msg_{message.id}",
        data={
            "role": message.role,
            "parts": message.parts,
            "message_id": message.message_id,
            "turn_number": message.turn_number,
            "session_id": message.session_id,
        },
        created_at=created_at_str,
    )
