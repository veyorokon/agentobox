"""Broadcast agent updates and events to Channels groups for GraphQL subscriptions."""

import structlog
from channels.layers import get_channel_layer

from agents.models import Agent, AgentEvent

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


async def broadcast_agent_event(event: AgentEvent) -> None:
    """Push new event to the project's new_event subscription."""
    channel_layer = get_channel_layer()
    agent = await Agent.objects.aget(id=event.agent_id)
    group = _group_name(str(agent.project_id), "events")
    await channel_layer.group_send(
        group,
        {
            "type": "agent.event",
            "event_id": str(event.id),
        },
    )
    log.info(
        "broadcast_agent_event",
        group=group,
        event_id=str(event.id),
        event_type=event.event_type,
    )
