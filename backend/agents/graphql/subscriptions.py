from typing import AsyncGenerator

import strawberry
import structlog
from strawberry import ID

from agents.graphql.types import AgentEventType, AgentType

log = structlog.get_logger("agents.subscriptions")


@strawberry.type
class AgentSubscription:
    @strawberry.subscription
    async def agent_updated(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[AgentType, None]:
        """Subscribe to agent status changes for a project."""
        from agents.models import Agent

        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_agents"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("subscription_connected", type="agent_updated", group=group)

        async with ws.listen_to_channel("agent.update", groups=[group]) as cm:
            async for message in cm:
                agent = await Agent.objects.aget(id=message["agent_id"])
                log.debug(
                    "subscription_message",
                    type="agent_updated",
                    agent_id=message["agent_id"],
                )
                yield agent  # type: ignore[misc]

    @strawberry.subscription
    async def new_event(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[AgentEventType, None]:
        """Subscribe to new agent events for a project."""
        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_events"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("subscription_connected", type="new_event", group=group)

        async with ws.listen_to_channel("agent.event", groups=[group]) as cm:
            async for message in cm:
                log.debug(
                    "subscription_message",
                    type="new_event",
                    event_type=message["event_type"],
                    agent_id=message["agent_id"],
                )
                yield AgentEventType(
                    event_type=message["event_type"],
                    data=message["data"],
                    agent_id=message["agent_id"],
                    agent_name=message["agent_name"],
                )
