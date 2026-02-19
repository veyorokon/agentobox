from datetime import timedelta

import strawberry
from django.utils import timezone
from strawberry import ID

from agents.graphql.types import (
    AgentEventType,
    AgentType,
    FeedConnectionType,
    FeedItemType,
    McpRegistryEntryType,
    ModelEntryType,
    ProjectSecretType,
    TimelineEntryType,
)

# Agents with no heartbeat for this long are marked as error
STALE_HEARTBEAT_SECONDS = 30


@strawberry.type
class AgentQuery:
    @strawberry.field
    async def agents(self, project_id: ID) -> list[AgentType]:
        from agents.models import Agent, AgentStatus

        # Lazy reap: mark agents with stale heartbeats as error
        stale = timezone.now() - timedelta(seconds=STALE_HEARTBEAT_SECONDS)
        await Agent.objects.filter(
            project_id=project_id,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
            last_heartbeat_at__lt=stale,
        ).aupdate(status=AgentStatus.ERROR)

        return [
            a async for a in Agent.objects.filter(
                project_id=project_id
            )
        ]

    @strawberry.field
    async def agent(self, agent_id: ID) -> AgentType | None:
        from agents.models import Agent

        try:
            return await Agent.objects.aget(id=agent_id)
        except Agent.DoesNotExist:
            return None

    @strawberry.field
    async def events(self, project_id: ID, limit: int = 100) -> list[AgentEventType]:
        from agents.models import AgentEvent

        return [
            e async for e in AgentEvent.objects.filter(
                agent__project_id=project_id
            ).select_related("agent").order_by("-created_at")[:limit]
        ]

    @strawberry.field
    async def timeline(
        self, project_id: ID, limit: int = 200, offset: int = 0,
    ) -> list[TimelineEntryType]:
        """
        Unified timeline: Messages + AgentEvents for a project, sorted newest-first.

        Replaces the need to call per-agent message queries + separate events queries.
        """
        from agents.models import AgentEvent, Message

        fetch_limit = limit + offset

        messages = [
            m async for m in Message.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("-created_at")[:fetch_limit]
        ]

        events = [
            e async for e in AgentEvent.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("-created_at")[:fetch_limit]
        ]

        entries: list[TimelineEntryType] = []
        for m in messages:
            entries.append(TimelineEntryType(
                id=f"msg_{m.id}",
                entry_type="message",
                agent_id=str(m.agent_id),
                agent_name=m.agent.name,
                summary=None,
                data={
                    "role": m.role,
                    "parts": m.parts,
                    "message_id": m.message_id,
                    "turn_number": m.turn_number,
                    "session_id": m.session_id,
                },
                created_at=m.created_at,
            ))
        for e in events:
            entries.append(TimelineEntryType(
                id=f"evt_{e.id}",
                entry_type=e.event_type,
                agent_id=str(e.agent_id),
                agent_name=e.agent.name,
                summary=e.summary or None,
                data=e.data,
                created_at=e.created_at,
            ))

        entries.sort(key=lambda x: x.created_at, reverse=True)
        return entries[offset:offset + limit]

    @strawberry.field
    async def agent_feed(
        self, agent_id: ID, limit: int = 200, offset: int = 0,
    ) -> list[FeedItemType]:
        """
        Processed activity feed for a single agent.

        Transforms raw Messages + AgentEvents into typed FeedItemType items
        matching the v2 dashboard's feed shape. Unlike the raw `timeline` query
        (which returns unprocessed Messages/Events), this classifies each item
        by kind (agent-text, activity, question, plan, etc.), parses tool
        inputs/results into structured fields, and injects point-in-time
        cumulative cost from the SessionResult timeline.

        Cost model: cumulative_cost_usd on each item is the agent's running
        total at that point in time, derived from per-turn SessionResult rows.
        For aggregate project cost, sum across agents on the frontend.
        """
        from agents.models import Agent, AgentEvent, Message, SessionResult
        from agents.services.feed_transform import messages_to_feed

        agent = await Agent.objects.aget(id=agent_id)
        messages = [
            m async for m in Message.objects.filter(
                agent=agent,
            ).select_related("agent").order_by("created_at")
        ]
        events = [
            e async for e in AgentEvent.objects.filter(
                agent=agent,
            ).select_related("agent").order_by("created_at")
        ]
        session_results = [
            sr async for sr in SessionResult.objects.filter(
                agent=agent,
            ).order_by("created_at")
        ]

        feed = messages_to_feed(messages, events, session_results)
        return feed[offset:offset + limit]

    @strawberry.field
    async def project_feed(
        self, project_id: ID, limit: int = 50, before: str | None = None,
    ) -> FeedConnectionType:
        """
        Cursor-paginated activity feed for all agents in a project.

        Returns the newest `limit` items. Pass `before` (ISO timestamp of
        the oldest item you already have) to load older items for reverse-
        chronological pagination.
        """
        from datetime import datetime as dt
        from datetime import timezone as tz

        from agents.models import AgentEvent, Message, SessionResult
        from agents.services.feed_transform import messages_to_feed

        # Parse cursor
        before_dt = None
        if before:
            before_dt = dt.fromisoformat(before)
            if before_dt.tzinfo is None:
                before_dt = before_dt.replace(tzinfo=tz.utc)

        # Buffer: fetch more raw records than limit to account for the
        # N:M ratio of messages → feed items (one message may produce
        # multiple feed items, or zero for tool_result-only messages).
        fetch_limit = limit * 4

        msg_qs = Message.objects.filter(
            agent__project_id=project_id,
        ).select_related("agent")
        evt_qs = AgentEvent.objects.filter(
            agent__project_id=project_id,
        ).select_related("agent")
        sr_qs = SessionResult.objects.filter(
            agent__project_id=project_id,
        )

        if before_dt:
            msg_qs = msg_qs.filter(created_at__lt=before_dt)
            evt_qs = evt_qs.filter(created_at__lt=before_dt)
            sr_qs = sr_qs.filter(created_at__lt=before_dt)

        # Fetch newest records (desc), then reverse for oldest-first transform
        messages = [m async for m in msg_qs.order_by("-created_at")[:fetch_limit]]
        messages.reverse()
        events = [e async for e in evt_qs.order_by("-created_at")[:fetch_limit]]
        events.reverse()
        session_results = [sr async for sr in sr_qs.order_by("created_at")]

        feed = messages_to_feed(messages, events, session_results)

        # Take the last `limit` items (newest in the transformed set)
        has_more = len(feed) > limit
        page = feed[-limit:] if has_more else feed
        end_cursor = page[0].timestamp.isoformat() if page else None

        return FeedConnectionType(
            items=page,
            has_more=has_more,
            end_cursor=end_cursor,
        )

    @strawberry.field
    def available_models(self) -> list[ModelEntryType]:
        from agents.services.provision import MODELS_REGISTRY

        return [
            ModelEntryType(value=m["value"], label=m["label"])
            for m in MODELS_REGISTRY
        ]

    @strawberry.field
    def mcp_registry(self) -> list[McpRegistryEntryType]:
        from agents.services.provision import MCP_REGISTRY

        return [
            McpRegistryEntryType(name=name, compat=entry.get("compat", []))
            for name, entry in MCP_REGISTRY.items()
        ]

    @strawberry.field
    async def project_secrets(self, project_id: ID) -> list[ProjectSecretType]:
        """List project secrets (key names and scoping only, never values)."""
        from agents.models import ProjectSecret

        return [
            s async for s in ProjectSecret.objects.filter(
                project_id=project_id
            ).order_by("key")
        ]
