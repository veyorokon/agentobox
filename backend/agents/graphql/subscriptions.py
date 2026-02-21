"""GraphQL subscriptions — two channels, two subscriptions.

    agent_updated  → project_{id}_agents  (Agent model state changes)
    event_stream   → project_{id}_events  (StreamEvent log entries)

Down from 4 subscriptions and 4 channel groups. The event_stream subscription
replaces message_received + new_event + timeline_stream because they all
came from the same underlying data (just split across two tables before).
"""

from datetime import datetime
from typing import AsyncGenerator

import strawberry
import structlog
from strawberry import ID

from agents.graphql.types import AgentType, TimelineEntryType

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
                yield agent  # type: ignore[misc]

    @strawberry.subscription
    async def event_stream(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[TimelineEntryType, None]:
        """Unified event stream from StreamEvent log.

        Replaces message_received + new_event + timeline_stream.
        Every StreamEvent broadcast (from broadcast_event) arrives here
        as a TimelineEntryType for the frontend to process.
        """
        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_events"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("subscription_connected", type="event_stream", group=group)

        async with ws.listen_to_channel("stream.event", groups=[group]) as cm:
            async for msg in cm:
                created_at = msg.get("created_at", "")
                if isinstance(created_at, str) and created_at:
                    created_at = datetime.fromisoformat(created_at)
                elif not isinstance(created_at, datetime):
                    created_at = datetime.now()

                yield TimelineEntryType(
                    id=f"evt_{msg['event_id']}",
                    entry_type=msg["event_type"],
                    agent_id=msg["agent_id"],
                    agent_name=msg["agent_name"],
                    summary=None,
                    data=msg.get("data", {}),
                    created_at=created_at,
                )
