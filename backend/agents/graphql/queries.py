"""Feed queries — raw event log, cursor-paginated.

Matches Anthropic's v1/sessions/{id}/events pattern: the API returns every
event from the StreamEvent log without server-side filtering or transformation.
The frontend decides what to render and how to group events.

No server-side transformation. No FeedItemType. No _FEED_EXCLUDED_TYPES.
"""

import base64
from datetime import datetime

import strawberry
from django.db.models import Q
from strawberry import ID

from agents.graphql.auth import authorize_agent, authorize_project
from agents.models import Agent
from agents.graphql.types import (
    AgentType,
    EventConnection,
    EventEdge,
    McpRegistryEntryType,
    ModelEntryType,
    PageInfo,
    ProjectSecretType,
    TimelineEntryType,
)


async def _collect_qs(qs):
    """Materialize an async Django queryset into a list."""
    return [obj async for obj in qs]


def _encode_cursor(item_id: str, timestamp: datetime) -> str:
    raw = f"{item_id}|{timestamp.isoformat()}"
    return base64.b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[str, datetime]:
    raw = base64.b64decode(cursor.encode()).decode()
    item_id, ts_str = raw.rsplit("|", 1)
    return item_id, datetime.fromisoformat(ts_str)


def _build_connection(entries: list[TimelineEntryType], first: int) -> EventConnection:
    """Slice entries to `first` items, build edges with cursors, detect next page."""
    has_next_page = len(entries) > first
    page = entries[:first]
    edges = [
        EventEdge(
            node=item,
            cursor=_encode_cursor(item.id, item.created_at),
        )
        for item in page
    ]
    end_cursor = edges[-1].cursor if edges else None
    return EventConnection(
        edges=edges,
        page_info=PageInfo(has_next_page=has_next_page, end_cursor=end_cursor),
    )


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
    async def timeline(
        self, project_id: ID, info: strawberry.types.Info, limit: int = 200, offset: int = 0,
    ) -> list[TimelineEntryType]:
        """Unified timeline from StreamEvent log, sorted newest-first."""
        from agents.models import StreamEvent

        await authorize_project(info, project_id)

        fetch_limit = min(limit + offset, 500)

        events = await _collect_qs(
            StreamEvent.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("-created_at")[:fetch_limit]
        )

        return _events_to_entries(events)[offset:offset + limit]

    @strawberry.field
    async def agent_feed(
        self,
        agent_id: ID,
        info: strawberry.types.Info,
        first: int = 50,
        after: str | None = None,
    ) -> EventConnection:
        """Cursor-paginated raw event log for a single agent.

        Returns every StreamEvent row without filtering or transformation.
        The frontend renders based on event_type and the raw data dict.
        """
        from agents.models import StreamEvent

        agent = await authorize_agent(info, agent_id)

        qs = StreamEvent.objects.filter(
            agent=agent,
        ).select_related("agent").order_by("-created_at", "-id")

        if after:
            after_item_id, after_ts = _decode_cursor(after)
            after_db_id = int(after_item_id.removeprefix("evt_"))
            qs = qs.filter(
                Q(created_at__lt=after_ts)
                | Q(created_at=after_ts, id__lt=after_db_id)
            )

        events = await _collect_qs(qs[:first + 1])
        entries = _events_to_entries(events)
        return _build_connection(entries, first)

    @strawberry.field
    async def project_feed(
        self,
        project_id: ID,
        info: strawberry.types.Info,
        first: int = 50,
        after: str | None = None,
    ) -> EventConnection:
        """Cursor-paginated raw event log for all agents in a project."""
        from agents.models import StreamEvent

        await authorize_project(info, project_id)

        qs = StreamEvent.objects.filter(
            agent__project_id=project_id,
        ).select_related("agent").order_by("-created_at", "-id")

        if after:
            after_item_id, after_ts = _decode_cursor(after)
            after_db_id = int(after_item_id.removeprefix("evt_"))
            qs = qs.filter(
                Q(created_at__lt=after_ts)
                | Q(created_at=after_ts, id__lt=after_db_id)
            )

        events = await _collect_qs(qs[:first + 1])
        entries = _events_to_entries(events)
        return _build_connection(entries, first)

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
