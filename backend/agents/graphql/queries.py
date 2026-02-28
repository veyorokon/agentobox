"""Queries: agents, feed, and metadata.

Two feed layers:
    teamFeed    → curated TeamFeedItems for the dashboard (materialized view)
    agentFeed   → raw StreamEvent log for agent detail view (event store)
    projectFeed → raw StreamEvent log for project-wide view (event store)
"""

import strawberry
from strawberry import ID

from agents.graphql.auth import authorize_agent, authorize_project
from agents.models import Agent
from agents.graphql.types import (
    AgentType,
    McpPackageType,
    McpRegistryEntryType,
    McpRegistrySearchResult,
    McpRegistryServerType,
    ModelEntryType,
    ProjectSecretType,
    SkillType,
    TeamFeedItemType,
    TimelineEntryType,
    model_to_feed_item_type,
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
    async def team_feed(
        self,
        project_id: ID,
        info: strawberry.types.Info,
    ) -> list[TeamFeedItemType]:
        """Curated feed items for the dashboard team feed."""
        from agents.models import TeamFeedItem

        await authorize_project(info, project_id)

        items = [
            item async for item in TeamFeedItem.objects.filter(
                project_id=project_id,
            ).order_by("created_at")[:500]
        ]

        return [model_to_feed_item_type(item) for item in items]

    @strawberry.field
    async def agent_feed(
        self,
        agent_id: ID,
        info: strawberry.types.Info,
        first: int = 100,
        after: str | None = None,
    ) -> list[TimelineEntryType]:
        """All events for a single agent, excluding stream deltas."""
        from agents.models import StreamEvent

        agent = await authorize_agent(info, agent_id)

        qs = StreamEvent.objects.filter(
            agent=agent,
        ).exclude(
            event_type="stream_event",
        ).select_related("agent").order_by("-created_at", "-id")

        if after:
            # Cursor is the StreamEvent ID — fetch events older than it
            try:
                cursor_id = int(after)
                qs = qs.filter(id__lt=cursor_id)
            except (ValueError, TypeError):
                pass

        events = await _collect_qs(qs[:first])
        return _events_to_entries(events)

    @strawberry.field
    async def project_feed(
        self,
        project_id: ID,
        info: strawberry.types.Info,
        limit: int = 200,
    ) -> list[TimelineEntryType]:
        """All events for all agents in a project, excluding stream deltas."""
        from agents.models import StreamEvent

        await authorize_project(info, project_id)

        events = await _collect_qs(
            StreamEvent.objects.filter(
                agent__project_id=project_id,
            ).exclude(
                event_type="stream_event",
            ).select_related("agent").order_by("-created_at", "-id")[:limit]
        )

        return _events_to_entries(events)

    @strawberry.field
    def available_models(self) -> list[ModelEntryType]:
        from agents.adapters import get_adapter

        adapter = get_adapter("claude-code")
        return [
            ModelEntryType(value=m["value"], label=m["label"])
            for m in adapter.available_models()
        ]

    @strawberry.field
    def mcp_registry(self) -> list[McpRegistryEntryType]:
        from agents.adapters import get_adapter

        adapter = get_adapter("claude-code")
        return [
            McpRegistryEntryType(name=e["name"], compat=e["compat"])
            for e in adapter.mcp_registry_entries()
        ]

    @strawberry.field
    async def search_mcp_registry(
        self,
        query: str = "",
        limit: int = 30,
        cursor: str | None = None,
    ) -> McpRegistrySearchResult:
        """Search the official MCP registry. Public endpoint, no auth required."""
        from agents.services.mcp_registry import search_registry

        limit = min(limit, 100)
        data = await search_registry(query, limit, cursor)
        servers = []
        for entry in data.get("servers", []):
            srv = entry.get("server", {})
            packages = [
                McpPackageType(
                    registry_type=pkg.get("registryType", ""),
                    identifier=pkg.get("identifier", ""),
                    transport_type=pkg.get("transport", {}).get("type", "stdio"),
                )
                for pkg in srv.get("packages", [])
            ]
            servers.append(McpRegistryServerType(
                name=srv.get("name", ""),
                description=srv.get("description", ""),
                version=srv.get("version", ""),
                website_url=srv.get("websiteUrl"),
                has_remote=bool(srv.get("remotes")),
                packages=packages,
            ))
        metadata = data.get("metadata", {})
        return McpRegistrySearchResult(
            servers=servers,
            next_cursor=metadata.get("nextCursor"),
        )

    @strawberry.field
    async def skills(
        self, project_id: ID, info: strawberry.types.Info,
    ) -> list[SkillType]:
        """All skills for a project."""
        from agents.models import Skill

        await authorize_project(info, project_id)
        return [s async for s in Skill.objects.filter(project_id=project_id)]

    @strawberry.field
    async def project_secrets(self, project_id: ID, info: strawberry.types.Info) -> list[ProjectSecretType]:
        from agents.models import ProjectSecret

        await authorize_project(info, project_id)

        return [
            s async for s in ProjectSecret.objects.filter(
                project_id=project_id
            ).order_by("key")
        ]
