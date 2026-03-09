"""
Strawberry GraphQL type definitions for the agents app.

Maps Django models to GraphQL types consumed by the dashboard. AgentType is
the main shape — Strawberry auto-converts snake_case fields to camelCase
(lifecycle_status → lifecycleStatus). Derived fields (lastOutput, liveAction,
cost, duration, turns) delegate to the agent's adapter so the GraphQL layer
stays agent-type-agnostic.

TeamFeedItemType is a flat union matching the frontend's discriminated union —
every field present on every row, null where inapplicable. This avoids
GraphQL union/interface complexity for a feed that the frontend already
handles as a flat discriminated type.

TimelineEntryType wraps raw StreamEvent rows for queries and subscriptions.
The data field is the raw event dict — the frontend decides what to render.
"""
from datetime import datetime

import strawberry
import strawberry_django
from asgiref.sync import sync_to_async
from strawberry import auto
from strawberry.scalars import JSON

from agents import models


# ── Helper types ──


@strawberry.type
class TaskProgressType:
    done: int
    total: int


@strawberry.type
class AgentTaskType:
    task_id: str
    title: str
    description: str
    status: str
    assignee: str
    active_form: str
    blocked_by: list[str]
    created_at: datetime
    updated_at: datetime


@strawberry.type
class FeedQuestionType:
    text: str
    options: list[str]


# ── Session result (model-backed) ──


@strawberry_django.type(models.SessionResult)
class SessionResultType:
    id: auto
    session_id: auto
    is_error: auto
    total_cost_usd: auto
    duration_ms: auto
    duration_api_ms: auto
    num_turns: auto
    model_usage: auto
    permission_denials: auto
    created_at: auto
    updated_at: auto

    @strawberry.field
    def agent_id(self) -> str:
        return str(self.agent_id)  # type: ignore[return-value]


# ── Event types — raw event log, same shape for queries + subscriptions ──


@strawberry.type
class TimelineEntryType:
    """Raw event from the StreamEvent log.

    Used by feed queries, timeline query, and event_stream subscription.
    The data field contains the raw event dict — the frontend decides
    what to render based on entry_type and the contents of data.
    """

    id: str
    entry_type: str
    agent_id: str
    agent_name: str
    summary: str | None
    data: JSON
    created_at: datetime


# ── Lifecycle attempt type (model-backed) ──


@strawberry_django.type(models.AgentLifecycleAttempt)
class LifecycleAttemptType:
    id: auto
    kind: auto
    status: auto
    step: auto
    attempt_no: auto
    correlation_id: auto
    error_code: auto
    error_detail: auto
    started_at: auto
    finished_at: auto


# ── Model-backed types ──


@strawberry_django.type(models.ProjectSecret)
class ProjectSecretType:
    """Project secret metadata — NEVER exposes decrypted values."""
    id: auto
    key: auto
    created_at: auto
    updated_at: auto

    @strawberry.field
    def project_id(self) -> str:
        return str(self.project_id)  # type: ignore[return-value]

    @strawberry_django.field
    async def scoped_agent_ids(self) -> list[str]:
        ids = await sync_to_async(
            lambda: list(
                models.Agent.objects.filter(
                    scoped_secrets__id=self.id  # type: ignore[attr-defined]
                ).only("id").values_list("id", flat=True)
            ),
            thread_sensitive=False,
        )()
        return [str(i) for i in ids]


@strawberry_django.type(models.AgentFeedback)
class AgentFeedbackType:
    id: auto
    rating: auto
    comment: auto
    session_id: auto
    created_at: auto

    @strawberry.field
    def agent_id(self) -> str:
        return str(self.agent_id)  # type: ignore[return-value]


@strawberry.type
class ModelEntryType:
    value: str
    label: str
    provider: str


@strawberry.type
class McpRegistryEntryType:
    name: str
    compat: list[str]


# ── MCP registry search types (proxied from registry.modelcontextprotocol.io) ──


@strawberry.type
class McpPackageType:
    registry_type: str
    identifier: str
    transport_type: str


@strawberry.type
class McpRegistryServerType:
    name: str
    description: str
    version: str
    website_url: str | None
    has_remote: bool
    packages: list[McpPackageType]


@strawberry.type
class McpRegistrySearchResult:
    servers: list[McpRegistryServerType]
    next_cursor: str | None


# ── Skill type (model-backed) ──


@strawberry_django.type(models.Skill)
class SkillType:
    id: auto
    name: auto
    description: auto
    content: auto
    assigned_tags: auto
    assigned_to_all: auto
    created_at: auto
    updated_at: auto

    @strawberry.field
    def project_id(self) -> str:
        return str(self.project_id)  # type: ignore[return-value]


@strawberry_django.type(models.Agent)
class AgentType:
    """Agent type matching the dashboard's Agent shape.

    Strawberry auto-converts snake_case to camelCase:
    lifecycle_status → lifecycleStatus, attention_level → attentionLevel, etc.
    """
    id: auto
    name: auto
    model: auto
    role: auto
    instructions: auto
    runtime: auto
    phase: auto
    tags: auto
    mode: auto
    attention_level: auto
    relay_connected: auto
    task: auto

    @strawberry.field
    def triggers(self) -> JSON:
        """Trigger configuration — what wakes this agent up."""
        return self.triggers if isinstance(self.triggers, list) else []

    @strawberry.field
    def compute_seconds(self) -> int:
        """Accumulated container runtime in seconds."""
        return self.compute_seconds or 0

    @strawberry.field
    def error_message(self) -> str:
        """Last error context — stderr excerpt or crash diagnostics."""
        return self.error_message or ""

    @strawberry.field
    def lifecycle_status(self) -> str:
        """Map internal status to frontend LifecycleStatus."""
        return self.status

    @strawberry.field
    def last_output(self) -> str:
        from agents.adapters import get_adapter
        adapter = get_adapter(self.agent_type)
        return adapter.last_output(self.latest_snapshot)

    @strawberry.field
    def live_action(self) -> str | None:
        from agents.adapters import get_adapter
        adapter = get_adapter(self.agent_type)
        result = adapter.live_action(self.latest_snapshot)
        return result or None

    @strawberry.field
    def cost(self) -> float:
        return float(self.session_cost_usd)

    @strawberry.field
    def duration(self) -> str:
        from agents.adapters import get_adapter
        adapter = get_adapter(self.agent_type)
        return adapter.duration(self.latest_snapshot)

    @strawberry.field
    def turns(self) -> int:
        from agents.adapters import get_adapter
        adapter = get_adapter(self.agent_type)
        return adapter.turns(self.latest_snapshot)

    @strawberry.field
    def allowed_tools(self) -> list[str]:
        """Pre-authorized tool names — SDK skips can_use_tool for these."""
        return self.allowed_tools if isinstance(self.allowed_tools, list) else []

    @strawberry.field
    def workspace_path(self) -> str:
        return self.workspace_path

    @strawberry.field
    def mcp_servers(self) -> list[str]:
        """MCP server names (keys only, not full config dict)."""
        if isinstance(self.mcp_servers, dict):
            return list(self.mcp_servers.keys())
        return self.mcp_servers if isinstance(self.mcp_servers, list) else []

    @strawberry_django.field
    async def task_progress(self) -> TaskProgressType | None:
        def _count():
            qs = models.AgentTask.objects.filter(agent_id=self.id)
            total = qs.count()
            if not total:
                return None
            done = qs.filter(status="completed").count()
            return (done, total)

        result = await sync_to_async(_count, thread_sensitive=False)()
        if result is None:
            return None
        return TaskProgressType(done=result[0], total=result[1])

    @strawberry_django.field
    async def lifecycle_attempts(self) -> list[LifecycleAttemptType]:
        def _fetch():
            return list(
                models.AgentLifecycleAttempt.objects.filter(agent_id=self.id)
                .order_by("-started_at")[:10]
            )
        return await sync_to_async(_fetch, thread_sensitive=False)()

    @strawberry_django.field
    async def tasks(self) -> list[AgentTaskType]:
        def _fetch():
            return list(
                models.AgentTask.objects.filter(agent_id=self.id)
                .exclude(status="deleted")
                .order_by("created_at")
                .values(
                    "task_id", "title", "description", "status",
                    "assignee", "active_form", "blocked_by", "created_at", "updated_at",
                )
            )
        rows = await sync_to_async(_fetch, thread_sensitive=False)()
        return [AgentTaskType(**row) for row in rows]


# ── TeamFeedItem type ──


@strawberry.type
class TeamFeedItemType:
    """Flat union matching frontend's TeamFeedItem. All fields nullable except id/type."""
    id: strawberry.ID
    type: str
    agent: str | None = None
    agent_id: str | None = None
    text: str | None = None
    command: str | None = None
    risk: str | None = None
    perm_status: str | None = None
    title: str | None = None
    plan: str | None = None
    plan_status: str | None = None
    summary: str | None = None
    cost: float | None = None
    turns: int | None = None
    duration: str | None = None
    is_error: bool | None = None
    target: str | None = None
    question: str | None = None
    options: list[str] | None = None
    questions: list[FeedQuestionType] | None = None
    from_: str | None = strawberry.field(default=None, name="from")
    to: str | None = None


def model_to_feed_item_type(item: models.TeamFeedItem) -> TeamFeedItemType:
    """Convert a TeamFeedItem model instance to its GraphQL type."""
    questions = None
    if item.questions:
        questions = [
            FeedQuestionType(text=q.get("text", ""), options=q.get("options", []))
            for q in item.questions
        ]

    return TeamFeedItemType(
        id=strawberry.ID(str(item.id)),
        type=item.type,
        agent=item.agent_name or None,
        agent_id=str(item.agent_record_id) if item.agent_record_id else None,
        text=item.text or None,
        command=item.command or None,
        risk=item.risk or None,
        perm_status=item.perm_status or None,
        title=item.title or None,
        plan=item.plan or None,
        plan_status=item.plan_status or None,
        summary=item.summary or None,
        cost=float(item.cost) if item.cost is not None else None,
        turns=item.turns,
        duration=item.duration or None,
        is_error=item.is_error,
        target=item.target or None,
        question=item.question or None,
        options=item.options if item.options else None,
        questions=questions,
        from_=item.from_value or None,
        to=item.to_value or None,
    )


# ── VNC token result ──


@strawberry.type
class VncTokenResult:
    token: str
    expires_at: str
