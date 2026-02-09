"""Broadcast agent updates and events to Channels groups for GraphQL subscriptions."""

import structlog
from channels.layers import get_channel_layer

from agents.models import Agent, Message

log = structlog.get_logger("agents.broadcast")


def _group_name(project_id: str, suffix: str) -> str:
    return f"project_{project_id}_{suffix}"


async def broadcast_agent_update(agent: Agent) -> None:
    """Push agent state change to the project's agent_updated subscription."""
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


async def broadcast_agent_event(
    agent: Agent, event_type: str, data: dict
) -> None:
    """Persist event to DB, then push to the project's new_event subscription."""
    from agents.models import AgentEvent

    event = await AgentEvent.objects.acreate(
        agent=agent, event_type=event_type, data=data
    )

    channel_layer = get_channel_layer()
    group = _group_name(str(agent.project_id), "events")
    await channel_layer.group_send(
        group,
        {
            "type": "agent.event",
            "event_id": event.id,
            "event_type": event_type,
            "data": data,
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "created_at": event.created_at.isoformat(),
        },
    )
    log.info(
        "broadcast_agent_event",
        group=group,
        event_type=event_type,
        agent_id=str(agent.id),
    )


async def broadcast_stream_message(agent: Agent, message: Message) -> None:
    """Push a new/updated stream Message to the project's message_received subscription.

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
