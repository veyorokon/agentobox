"""GraphQL subscriptions — three channels, three subscriptions.

    agent_changed      → project_{id}_agents     (Agent model state changes)
    feed_item_changed  → project_{id}_team_feed   (TeamFeedItem create/update)
    event_stream       → project_{id}_events      (StreamEvent log entries)
"""

from datetime import datetime
from typing import AsyncGenerator

import strawberry
import structlog
from strawberry import ID

from agents.graphql.auth import authorize_project
from agents.graphql.types import AgentType, TeamFeedItemType, TimelineEntryType, model_to_feed_item_type

log = structlog.get_logger("abox.graphql")


@strawberry.type
class AgentSubscription:
    @strawberry.subscription
    async def agent_changed(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[AgentType, None]:
        """Subscribe to agent status changes for a project."""
        from agents.models import Agent

        await authorize_project(info, project_id)
        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_agents"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("graphql.subscription_connected", type="agent_changed", group=group)

        async with ws.listen_to_channel("agent.update", groups=[group]) as cm:
            async for message in cm:
                agent = await Agent.objects.aget(id=message["agent_id"])
                yield agent  # type: ignore[misc]

    @strawberry.subscription
    async def feed_item_changed(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[TeamFeedItemType, None]:
        """Subscribe to TeamFeedItem creation and updates for a project."""
        from agents.models import TeamFeedItem

        await authorize_project(info, project_id)
        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_team_feed"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("graphql.subscription_connected", type="feed_item_changed", group=group)

        async with ws.listen_to_channel("team_feed.changed", groups=[group]) as cm:
            async for msg in cm:
                try:
                    item = await TeamFeedItem.objects.aget(id=msg["item_id"])
                    yield model_to_feed_item_type(item)
                except TeamFeedItem.DoesNotExist:
                    log.warning("graphql.feed_item_not_found", item_id=msg["item_id"])

    @strawberry.subscription
    async def event_stream(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[TimelineEntryType, None]:
        """Unified event stream from StreamEvent log.

        Replaces message_received + new_event + timeline_stream.
        Every StreamEvent broadcast (from broadcast_event) arrives here
        as a TimelineEntryType for the frontend to process.
        """
        await authorize_project(info, project_id)
        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_events"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("graphql.subscription_connected", type="event_stream", group=group)

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
