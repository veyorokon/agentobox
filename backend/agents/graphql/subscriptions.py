from typing import AsyncGenerator

import strawberry
import structlog
from strawberry import ID

from agents.graphql.types import AgentEventSubType, AgentType, MessageSubType, TimelineEntryType

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
    ) -> AsyncGenerator[AgentEventSubType, None]:
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
                yield AgentEventSubType(
                    id=message["event_id"],
                    event_type=message["event_type"],
                    data=message["data"],
                    agent_id=message["agent_id"],
                    agent_name=message["agent_name"],
                    created_at=message["created_at"],
                )

    @strawberry.subscription
    async def message_received(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[MessageSubType, None]:
        """
        Subscribe to new/updated stream Messages for a project.

        Pushes typed Message payloads (with content parts) when the
        backend processes assistant/user events from the relay.

        See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "messageReceived subscription"
        """
        from agents.models import Message

        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_messages"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("subscription_connected", type="message_received", group=group)

        async with ws.listen_to_channel("stream.message", groups=[group]) as cm:
            async for msg in cm:
                try:
                    message = await Message.objects.aget(id=msg["message_id"])
                    log.debug(
                        "subscription_message",
                        type="message_received",
                        message_id=msg["message_id"],
                        agent_id=msg["agent_id"],
                    )
                    yield MessageSubType(
                        id=message.id,
                        message_id=message.message_id,
                        agent_id=msg["agent_id"],
                        agent_name=msg["agent_name"],
                        role=message.role,
                        parts=message.parts,
                        session_id=message.session_id,
                        turn_number=message.turn_number,
                        created_at=message.created_at.isoformat(),
                    )
                except Message.DoesNotExist:
                    log.warning(
                        "message_not_found_for_subscription",
                        message_id=msg["message_id"],
                    )

    @strawberry.subscription
    async def timeline_stream(
        self, info: strawberry.Info, project_id: ID
    ) -> AsyncGenerator[TimelineEntryType, None]:
        """
        Unified timeline stream joining Messages and AgentEvents.

        Pushes TimelineEntry objects whenever a Message is saved/updated
        or an AgentEvent is created, interleaved in real time.
        """
        from datetime import datetime

        ws = info.context["ws"]
        channel_layer = ws.channel_layer
        group = f"project_{project_id}_timeline"

        await channel_layer.group_add(group, ws.channel_name)
        log.info("subscription_connected", type="timeline_stream", group=group)

        async with ws.listen_to_channel("timeline.entry", groups=[group]) as cm:
            async for msg in cm:
                created_at = msg.get("created_at", "")
                if isinstance(created_at, str) and created_at:
                    created_at = datetime.fromisoformat(created_at)
                elif not isinstance(created_at, datetime):
                    created_at = datetime.now()

                yield TimelineEntryType(
                    id=msg["source_id"],
                    entry_type=msg["entry_type"],
                    agent_id=msg["agent_id"],
                    agent_name=msg["agent_name"],
                    summary=msg.get("summary") or None,
                    data=msg.get("data", {}),
                    created_at=created_at,
                )
