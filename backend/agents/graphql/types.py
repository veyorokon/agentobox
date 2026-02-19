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


@strawberry.type
class FeedItemType:
    """
    Single item in the v2 dashboard activity feed.

    Computed from Message + AgentEvent data by feed_transform.messages_to_feed().
    Each `kind` uses a different subset of fields:

        USER_MESSAGE  — text, image_urls, target_name
        AGENT_TEXT    — text
        ACTIVITY      — tools[] (grouped standard tool calls: Read/Edit/Write/Bash/Grep/Glob)
        STATUS        — from_status, to_status
        TASK          — task_summary
        ERROR         — error_text
        QUESTION      — questions[]
        MEMORY        — memory_content (CLAUDE.md edits)
        PLAN          — plan_status, plan_summary, plan_steps
        TASK_START    — task_divider_subject, task_divider_id
        TASK_END      — task_divider_subject, task_divider_id
        TEAM_MESSAGE  — text, sender_name (agent_name = recipient)
        SYSTEM        — text

    cumulative_cost_usd is set on all items — point-in-time per-agent cost
    from the SessionResult timeline (one row per turn).
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



@strawberry_django.type(models.ProjectSecret)
class ProjectSecretType:
    """
    Individual project secret metadata exposed via GraphQL.

    NEVER exposes decrypted values. Only returns the key name,
    scoping, and timestamps.
    """
    id: auto
    key: auto
    created_at: auto
    updated_at: auto

    @strawberry.field
    def project_id(self) -> str:
        return str(self.project_id)  # type: ignore[return-value]

    @strawberry_django.field
    def scoped_agent_ids(self) -> list[str]:
        """Agent IDs this secret is restricted to. Empty = all agents."""
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


@strawberry_django.type(models.Message)
class MessageType:
    """
    GraphQL type mirroring the Message model (Claude Code stream-json events).

    Parts is a JSON array of typed content parts matching the Anthropic API format:
        [{type: "text", text: "..."}, {type: "tool_use", ...}, {type: "tool_result", ...}]

    See: docs/ARCHITECTURE.md, "Data Model"
    """
    id: auto
    message_id: auto
    session_id: auto
    role: auto
    model: auto
    parts: auto
    usage: auto
    parent_tool_use_id: auto
    stop_reason: auto
    turn_number: auto
    created_at: auto
    updated_at: auto

    @strawberry.field
    def agent_id(self) -> str:
        return str(self.agent_id)  # type: ignore[return-value]


@strawberry_django.type(models.SessionResult)
class SessionResultType:
    """
    GraphQL type for session cost/usage from Claude Code's result events.

    See: docs/ARCHITECTURE.md, "result event"
    """
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
    def stream_messages(self, limit: int = 500, offset: int = 0) -> list[MessageType]:
        """Stream-json messages (typed content parts). Replaces legacy messages."""
        return models.Message.objects.filter(agent_id=self.id).order_by("created_at")[offset:offset + limit]

    @strawberry_django.field
    def session_result(self) -> SessionResultType | None:
        """Current session's cost/usage result."""
        return models.SessionResult.objects.filter(agent_id=self.id).order_by("-updated_at").first()

    @strawberry_django.field
    def feedback(self, limit: int = 50, offset: int = 0) -> list[AgentFeedbackType]:
        return models.AgentFeedback.objects.filter(agent_id=self.id).order_by("-created_at")[offset:offset + limit]


@strawberry_django.type(models.AgentEvent)
class AgentEventType:
    id: auto
    event_type: auto
    data: auto
    summary: auto
    created_at: auto

    @strawberry.field
    def agent_id(self) -> str:
        return str(self.agent_id)  # type: ignore[return-value]

    @strawberry.field
    def agent_name(self) -> str:
        return self.agent.name  # type: ignore[attr-defined]


@strawberry.type
class AgentEventSubType:
    """Event payload pushed through channels for subscriptions."""

    id: int
    event_type: str
    data: JSON
    agent_id: str
    agent_name: str
    created_at: str


@strawberry.type
class MessageSubType:
    """Message payload pushed through channels for messageReceived subscription."""

    id: int
    message_id: str
    agent_id: str
    agent_name: str
    role: str
    parts: JSON
    session_id: str
    turn_number: int
    created_at: str


@strawberry.type
class TimelineEntryType:
    """
    Unified timeline entry joining Messages and AgentEvents.

    For Messages: entry_type="message", data contains role/parts/message_id/turn_number/session_id.
    For AgentEvents: entry_type=event.event_type, data is the event's existing data field.
    """

    id: str
    entry_type: str
    agent_id: str
    agent_name: str
    summary: str | None
    data: JSON
    created_at: datetime
