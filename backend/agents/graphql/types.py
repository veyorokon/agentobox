from datetime import datetime

import strawberry
import strawberry_django
from strawberry import auto
from strawberry.scalars import JSON

from agents import models


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
    def scoped_agent_ids(self) -> list[str]:
        return [
            str(a.id) for a in models.Agent.objects.filter(
                scoped_secrets__id=self.id  # type: ignore[attr-defined]
            ).only("id")
        ]


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


@strawberry.type
class McpRegistryEntryType:
    name: str
    compat: list[str]


@strawberry_django.type(models.Agent)
class AgentType:
    id: auto
    name: auto
    runtime: auto
    sandbox_id: auto
    vnc_url: auto
    status: auto
    phase: auto
    team_name: auto
    parent_session_id: auto
    session_id: auto
    model: auto
    permission_mode: auto
    mcp_servers: auto
    workspace_path: auto
    volume_mounts: auto
    instructions: auto
    role: auto
    session_cost_usd: auto
    capabilities: auto
    created_at: auto

    @strawberry_django.field
    def session_result(self) -> SessionResultType | None:
        """Current session's cost/usage result."""
        return models.SessionResult.objects.filter(agent_id=self.id).order_by("-updated_at").first()

    @strawberry_django.field
    def feedback(self, limit: int = 50, offset: int = 0) -> list[AgentFeedbackType]:
        return models.AgentFeedback.objects.filter(agent_id=self.id).order_by("-created_at")[offset:offset + limit]
