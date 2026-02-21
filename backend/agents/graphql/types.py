import enum
from datetime import datetime

import strawberry
import strawberry_django
from strawberry import auto
from strawberry.scalars import JSON

from agents import models


# ── Feed item types (computed, not model-backed) ──


@strawberry.enum
class FeedItemKind(enum.Enum):
    USER_MESSAGE = "user-message"
    AGENT_TEXT = "agent-text"
    ACTIVITY = "activity"
    STATUS = "status"
    TASK = "task"
    SYSTEM = "system"
    ERROR = "error"
    QUESTION = "question"
    MEMORY = "memory"
    PLAN = "plan"
    TASK_START = "task-start"
    TASK_END = "task-end"
    TEAM_MESSAGE = "team-message"


@strawberry.type
class ToolUseItemType:
    name: str
    input: JSON  # raw tool_use.input dict
    result: JSON  # raw tool_result.content (string or ContentBlock[])
    is_error: bool = False


@strawberry.type
class QuestionOptionType:
    label: str
    description: str


@strawberry.type
class AgentQuestionType:
    question: str
    header: str
    options: list[QuestionOptionType]
    multi_select: bool


@strawberry.type
class QuestionAnswerType:
    selected_indices: list[int]
    other_text: str | None = None


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


@strawberry.type
class FeedItemType:
    """Single item in the dashboard activity feed.

    Computed from StreamEvent data by feed_transform.stream_events_to_feed().
    Each `kind` uses a different subset of fields — same contract as before,
    now powered by a single table source instead of Message + AgentEvent.
    """

    id: str
    kind: FeedItemKind
    agent_id: str
    agent_name: str
    timestamp: datetime
    text: str | None = None
    image_urls: list[str] | None = None
    target_name: str | None = None
    tools: list[ToolUseItemType] | None = None
    from_status: str | None = None
    to_status: str | None = None
    task_summary: str | None = None
    error_text: str | None = None
    cumulative_cost_usd: float | None = None
    questions: list[AgentQuestionType] | None = None
    memory_content: str | None = None
    plan_status: str | None = None
    plan_summary: str | None = None
    plan_steps: list[str] | None = None
    task_divider_subject: str | None = None
    task_divider_id: str | None = None
    task_divider_active_form: str | None = None
    answers: list[QuestionAnswerType | None] | None = None
    tool_use_id: str | None = None
    sender_name: str | None = None
    target_agent_ids: list[str] | None = None
    session_result: SessionResultType | None = None


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
    cwd: auto
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


# ── Subscription payload types ──
# These are the shapes pushed through Channels. TimelineEntryType is
# the unified subscription contract — same shape for all event types.


@strawberry.type
class TimelineEntryType:
    """Unified timeline/subscription entry from StreamEvent log.

    Used by both the timeline query and the event_stream subscription.
    """

    id: str
    entry_type: str
    agent_id: str
    agent_name: str
    summary: str | None
    data: JSON
    created_at: datetime
