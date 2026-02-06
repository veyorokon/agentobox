from typing import AsyncGenerator

import strawberry
from strawberry import ID

from agents.graphql.types import AgentEventType, AgentType


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

        async with ws.listen_to_channel("agent.update", groups=[group]) as cm:
            async for message in cm:
                agent = await Agent.objects.select_related("goal").aget(
                    id=message["agent_id"]
                )
                yield agent  # type: ignore[misc]

    @strawberry.subscription
    async def new_event(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[AgentEventType, None]:
        """Subscribe to new agent events for a project."""
        from agents.models import AgentEvent

        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_events"

        await channel_layer.group_add(group, ws.channel_name)

        async with ws.listen_to_channel("agent.event", groups=[group]) as cm:
            async for message in cm:
                event = await AgentEvent.objects.aget(id=message["event_id"])
                yield event  # type: ignore[misc]
