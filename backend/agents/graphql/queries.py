"""Queries: agents, feed, and metadata.

Two feed layers:
    teamFeed    → curated TeamFeedItems for the dashboard (materialized view)
    agentFeed   → raw StreamEvent log for agent detail view (event store)
    projectFeed → raw StreamEvent log for project-wide view (event store)
"""

import strawberry
from asgiref.sync import sync_to_async
from strawberry import ID

from agents.graphql.auth import authorize_agent, authorize_project
from agents.models import Agent
from agents.graphql.types import (
    AccountSecretType,
    AgentType,
    IncidentCaptureType,
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


@strawberry.type
class ProviderStatusType:
    slug: str
    name: str
    key_name: str
    configured: bool


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

        qs = StreamEvent.canonical.filter(
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
        # Reverse: query fetches most recent N in descending order,
        # but feed displays chronologically (oldest first, newest at bottom)
        # so the subscription can append live events at the end.
        events.reverse()
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
        events.reverse()
        return _events_to_entries(events)

    @strawberry.field
    def available_models(self) -> list[ModelEntryType]:
        from agents.adapters import get_adapter

        adapter = get_adapter("claude-code")
        return [
            ModelEntryType(
                value=m["value"],
                label=m["label"],
                provider=m["value"].split("/", 1)[0] if "/" in m["value"] else "anthropic",
            )
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
        """Search official MCP registry + bundled servers.

        Uses separator-normalized matching so "computer use" matches
        "computer-use". Bundled matches appear first.
        """
        import re
        from agents.adapters import get_adapter
        from agents.services.mcp_registry import search_registry

        limit = min(limit, 100)

        # Normalize: collapse spaces/dashes/underscores for comparison
        def _normalize(s: str) -> str:
            return re.sub(r"[-_\s]+", "", s).lower()

        # Search bundled servers with normalized matching
        bundled: list[McpRegistryServerType] = []
        if query:
            q_norm = _normalize(query)
            adapter = get_adapter("claude-code")
            for entry in adapter.mcp_registry_entries():
                if q_norm in _normalize(entry["name"]):
                    bundled.append(McpRegistryServerType(
                        name=entry["name"],
                        description="Bundled — pre-installed in agent image",
                        version="",
                        website_url=None,
                        has_remote=False,
                        packages=[McpPackageType(registry_type="bundled", identifier=entry["name"], transport_type="stdio")],
                    ))
        bundled_names = {s.name for s in bundled}

        # Search remote registry
        data = await search_registry(query, limit, cursor)
        remote: list[McpRegistryServerType] = []
        for entry in data.get("servers", []):
            srv = entry.get("server", {})
            name = srv.get("name", "")
            if name in bundled_names:
                continue
            packages = [
                McpPackageType(
                    registry_type=pkg.get("registryType", ""),
                    identifier=pkg.get("identifier", ""),
                    transport_type=pkg.get("transport", {}).get("type", "stdio"),
                )
                for pkg in srv.get("packages", [])
            ]
            remote.append(McpRegistryServerType(
                name=name,
                description=srv.get("description", ""),
                version=srv.get("version", ""),
                website_url=srv.get("websiteUrl"),
                has_remote=bool(srv.get("remotes")),
                packages=packages,
            ))

        metadata = data.get("metadata", {})
        return McpRegistrySearchResult(
            servers=bundled + remote,
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
    async def account_secrets(self, info: strawberry.types.Info) -> list[AccountSecretType]:
        """Account-level secrets for the authenticated user."""
        from agents.models import AccountSecret

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        return [s async for s in AccountSecret.objects.filter(user=user).order_by("key")]

    @strawberry.field
    async def project_secrets(self, project_id: ID, info: strawberry.types.Info) -> list[ProjectSecretType]:
        from agents.models import ProjectSecret

        await authorize_project(info, project_id)

        return [
            s async for s in ProjectSecret.objects.filter(
                project_id=project_id
            ).order_by("key")
        ]

    @strawberry.field
    async def provider_status(self, project_id: ID, info: strawberry.types.Info) -> list[ProviderStatusType]:
        """Check which provider API keys are configured for a project.

        A provider is "configured" if its key exists at project level OR account level.
        """
        from agents.adapters.claude_code.registries import PROVIDER_CONFIGS, PROVIDER_SECRET_KEYS
        from agents.models import AccountSecret, ProjectSecret

        user = info.context["request"].user
        await authorize_project(info, project_id)

        # Fetch secret key names at both levels
        project_keys = await sync_to_async(
            lambda: set(
                ProjectSecret.objects.filter(project_id=project_id).values_list("key", flat=True)
            ),
            thread_sensitive=False,
        )()
        account_keys = await sync_to_async(
            lambda: set(
                AccountSecret.objects.filter(user=user).values_list("key", flat=True)
            ),
            thread_sensitive=False,
        )()
        effective_keys = project_keys | account_keys

        # Human-readable names for each provider slug
        provider_names = {
            "anthropic": "Anthropic",
            "glm": "GLM (Z.ai)",
            "kimi": "Kimi (Moonshot)",
            "minimax": "MiniMax",
            "qwen": "Qwen (Alibaba)",
            "openrouter": "OpenRouter",
        }

        result = []
        for slug in PROVIDER_CONFIGS:
            key_name = PROVIDER_SECRET_KEYS.get(slug, "")
            result.append(ProviderStatusType(
                slug=slug,
                name=provider_names.get(slug, slug),
                key_name=key_name,
                configured=key_name in effective_keys,
            ))
        return result

    @strawberry.field
    async def agent_incidents(
        self, agent_id: ID, info: strawberry.types.Info, limit: int = 20,
    ) -> list[IncidentCaptureType]:
        """Recent incidents for one agent, newest first."""
        from agents.models import IncidentCapture

        agent = await authorize_agent(info, agent_id)
        limit = min(limit, 50)

        return [
            IncidentCaptureType(
                id=strawberry.ID(str(inc.id)),
                agent_id=strawberry.ID(str(inc.agent_id)),
                project_id=strawberry.ID(str(inc.project_id)),
                note=inc.note,
                screenshot_url=inc.screenshot_url,
                window_minutes=inc.window_minutes,
                bundle=inc.bundle,
                collection_errors=inc.collection_errors,
                created_at=inc.created_at.isoformat(),
            )
            async for inc in IncidentCapture.objects.filter(
                agent_id=agent.id,
            ).order_by("-created_at")[:limit]
        ]

    @strawberry.field
    async def incident(
        self, incident_id: ID, info: strawberry.types.Info,
    ) -> IncidentCaptureType | None:
        """Retrieve a stored incident capture by ID."""
        from agents.models import IncidentCapture

        try:
            inc = await IncidentCapture.objects.select_related("project").aget(id=incident_id)
        except IncidentCapture.DoesNotExist:
            return None

        # Use canonical auth path — same as other project-scoped queries
        await authorize_project(info, str(inc.project_id))

        return IncidentCaptureType(
            id=strawberry.ID(str(inc.id)),
            agent_id=strawberry.ID(str(inc.agent_id)),
            project_id=strawberry.ID(str(inc.project_id)),
            note=inc.note,
            screenshot_url=inc.screenshot_url,
            window_minutes=inc.window_minutes,
            bundle=inc.bundle,
            collection_errors=inc.collection_errors,
            created_at=inc.created_at.isoformat(),
        )
