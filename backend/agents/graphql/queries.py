"""Feed queries — raw event log, flat list.

Returns all meaningful events (excludes stream_event deltas) for the feed.
No pagination, no cursors. The frontend handles display grouping.
"""

import strawberry
from strawberry import ID

from agents.graphql.auth import authorize_agent, authorize_project
from agents.models import Agent
from agents.graphql.types import (
    AgentType,
    McpRegistryEntryType,
    ModelEntryType,
    ProjectSecretType,
    TimelineEntryType,
)


async def _collect_qs(qs):
    """Materialize an async Django queryset into a list."""
    return [obj async for obj in qs]


def _events_to_entries(events) -> list[TimelineEntryType]:
    """Convert StreamEvent queryset rows to TimelineEntryType nodes."""
    return [
        TimelineEntryType(
            id=f"evt_{e.id}",
            entry_type=e.event_type,
            agent_id=str(e.agent_id),
            agent_name=e.agent.name,
            summary=None,
            data=e.data,
            created_at=e.created_at,
        )
        for e in events
    ]


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
    async def agent_feed(
        self,
        agent_id: ID,
        info: strawberry.types.Info,
    ) -> list[TimelineEntryType]:
        """All events for a single agent, excluding stream deltas."""
        from agents.models import StreamEvent

        agent = await authorize_agent(info, agent_id)

        events = await _collect_qs(
            StreamEvent.objects.filter(
                agent=agent,
            ).exclude(
                event_type="stream_event",
            ).select_related("agent").order_by("-created_at", "-id")
        )

        return _events_to_entries(events)

    @strawberry.field
    async def project_feed(
        self,
        project_id: ID,
        info: strawberry.types.Info,
    ) -> list[TimelineEntryType]:
        """All events for all agents in a project, excluding stream deltas."""
        from agents.models import StreamEvent

        await authorize_project(info, project_id)

        events = await _collect_qs(
            StreamEvent.objects.filter(
                agent__project_id=project_id,
            ).exclude(
                event_type="stream_event",
            ).select_related("agent").order_by("-created_at", "-id")
        )

        return _events_to_entries(events)

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
