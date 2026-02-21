import asyncio

import strawberry
from strawberry import ID

from agents.graphql.auth import authorize_agent, authorize_project
from agents.models import Agent
from agents.graphql.types import (
    AgentType,
    FeedItemType,
    McpRegistryEntryType,
    ModelEntryType,
    ProjectSecretType,
    TimelineEntryType,
)

MAX_TIMELINE_FETCH = 500


async def _collect_qs(qs):
    """Materialize an async Django queryset into a list."""
    return [obj async for obj in qs]


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
    async def timeline(
        self, project_id: ID, info: strawberry.types.Info, limit: int = 200, offset: int = 0,
    ) -> list[TimelineEntryType]:
        """Unified timeline from StreamEvent log, sorted newest-first.

        Single table source — no more merging Message + AgentEvent.
        """
        from agents.models import StreamEvent

        await authorize_project(info, project_id)

        fetch_limit = min(limit + offset, MAX_TIMELINE_FETCH)

        events = await _collect_qs(
            StreamEvent.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("-created_at")[:fetch_limit]
        )

        entries: list[TimelineEntryType] = []
        for e in events:
            entries.append(TimelineEntryType(
                id=f"evt_{e.id}",
                entry_type=e.event_type,
                agent_id=str(e.agent_id),
                agent_name=e.agent.name,
                summary=None,
                data=e.data,
                created_at=e.created_at,
            ))

        return entries[offset:offset + limit]

    @strawberry.field
    async def agent_feed(
        self, agent_id: ID, info: strawberry.types.Info, limit: int = 200, offset: int = 0,
    ) -> list[FeedItemType]:
        """Processed activity feed for a single agent.

        Reads from StreamEvent + SessionResult only (2 tables, was 3).
        """
        from agents.models import SessionResult, StreamEvent
        from agents.services.feed_transform import stream_events_to_feed

        agent = await authorize_agent(info, agent_id)
        fetch_limit = min(limit + offset, MAX_TIMELINE_FETCH)

        events, session_results = await asyncio.gather(
            _collect_qs(
                StreamEvent.objects.filter(
                    agent=agent,
                ).select_related("agent").order_by("created_at")[:fetch_limit]
            ),
            _collect_qs(
                SessionResult.objects.filter(
                    agent=agent,
                ).order_by("created_at")[:fetch_limit]
            ),
        )

        feed = stream_events_to_feed(events, session_results)
        return feed[offset:offset + limit]

    @strawberry.field
    async def project_feed(
        self, project_id: ID, info: strawberry.types.Info, limit: int = 500, offset: int = 0,
    ) -> list[FeedItemType]:
        """Full activity feed for all agents in a project, oldest first."""
        from agents.models import SessionResult, StreamEvent
        from agents.services.feed_transform import stream_events_to_feed

        await authorize_project(info, project_id)

        fetch_limit = min(limit + offset, MAX_TIMELINE_FETCH)

        events, session_results = await asyncio.gather(
            _collect_qs(
                StreamEvent.objects.filter(
                    agent__project_id=project_id,
                ).select_related("agent").order_by("created_at")[:fetch_limit]
            ),
            _collect_qs(
                SessionResult.objects.filter(
                    agent__project_id=project_id,
                ).order_by("created_at")[:fetch_limit]
            ),
        )

        feed = stream_events_to_feed(events, session_results)
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
        from agents.models import ProjectSecret

        await authorize_project(info, project_id)

        return [
            s async for s in ProjectSecret.objects.filter(
                project_id=project_id
            ).order_by("key")
        ]
