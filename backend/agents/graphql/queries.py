import strawberry
from strawberry import ID

from agents.graphql.auth import authorize_agent, authorize_project
from agents.models import Agent
from agents.graphql.types import (
    AgentEventType,
    AgentType,
    FeedItemType,
    McpRegistryEntryType,
    ModelEntryType,
    ProjectSecretType,
    TimelineEntryType,
)

MAX_TIMELINE_FETCH = 500


@strawberry.type
class AgentQuery:
    @strawberry.field
    async def agents(self, project_id: ID, info: strawberry.types.Info) -> list[AgentType]:
        from agents.models import Agent

        await authorize_project(info, project_id)

        return [
            a async for a in Agent.objects.filter(
                project_id=project_id
            )
        ]

    @strawberry.field
    async def agent(self, agent_id: ID, info: strawberry.types.Info) -> AgentType | None:
        try:
            return await authorize_agent(info, agent_id)
        except Agent.DoesNotExist:
            return None

    @strawberry.field
    async def events(self, project_id: ID, info: strawberry.types.Info, limit: int = 100) -> list[AgentEventType]:
        from agents.models import AgentEvent

        await authorize_project(info, project_id)

        return [
            e async for e in AgentEvent.objects.filter(
                agent__project_id=project_id
            ).select_related("agent").order_by("-created_at")[:limit]
        ]

    @strawberry.field
    async def timeline(
        self, project_id: ID, info: strawberry.types.Info, limit: int = 200, offset: int = 0,
    ) -> list[TimelineEntryType]:
        """
        Unified timeline: Messages + AgentEvents for a project, sorted newest-first.

        Replaces the need to call per-agent message queries + separate events queries.
        """
        from agents.models import AgentEvent, Message

        await authorize_project(info, project_id)

        fetch_limit = min(limit + offset, MAX_TIMELINE_FETCH)

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
        self, agent_id: ID, info: strawberry.types.Info, limit: int = 200, offset: int = 0,
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
        from agents.models import AgentEvent, Message, SessionResult
        from agents.services.feed_transform import messages_to_feed

        agent = await authorize_agent(info, agent_id)
        fetch_limit = min(limit + offset, MAX_TIMELINE_FETCH)
        messages = [
            m async for m in Message.objects.filter(
                agent=agent,
            ).select_related("agent").order_by("created_at")[:fetch_limit]
        ]
        events = [
            e async for e in AgentEvent.objects.filter(
                agent=agent,
            ).select_related("agent").order_by("created_at")[:fetch_limit]
        ]
        session_results = [
            sr async for sr in SessionResult.objects.filter(
                agent=agent,
            ).order_by("created_at")[:fetch_limit]
        ]

        feed = messages_to_feed(messages, events, session_results)
        return feed[offset:offset + limit]

    @strawberry.field
    async def project_feed(
        self, project_id: ID, info: strawberry.types.Info, limit: int = 500, offset: int = 0,
    ) -> list[FeedItemType]:
        """Full activity feed for all agents in a project, oldest first."""
        from agents.models import AgentEvent, Message, SessionResult
        from agents.services.feed_transform import messages_to_feed

        await authorize_project(info, project_id)

        fetch_limit = min(limit + offset, MAX_TIMELINE_FETCH)
        messages = [
            m async for m in Message.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("created_at")[:fetch_limit]
        ]
        events = [
            e async for e in AgentEvent.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("created_at")[:fetch_limit]
        ]
        session_results = [
            sr async for sr in SessionResult.objects.filter(
                agent__project_id=project_id,
            ).order_by("created_at")[:fetch_limit]
        ]

        feed = messages_to_feed(messages, events, session_results)
        return feed[offset:offset + limit]

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
    async def project_secrets(self, project_id: ID, info: strawberry.types.Info) -> list[ProjectSecretType]:
        """List project secrets (key names and scoping only, never values)."""
        from agents.models import ProjectSecret

        await authorize_project(info, project_id)

        return [
            s async for s in ProjectSecret.objects.filter(
                project_id=project_id
            ).order_by("key")
        ]
