import strawberry
import strawberry_django
from strawberry import auto
from strawberry.scalars import JSON

from agents import models


@strawberry_django.type(models.AgentMessage)
class AgentMessageType:
    id: auto
    direction: auto
    content: auto
    created_at: auto


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

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
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

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "result event"
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
    transcript_path: auto
    permission_mode: auto
    mcp_servers: auto
    workspace_path: auto
    instructions: auto
    session_cost_usd: auto
    capabilities: auto
    created_at: auto

    @strawberry_django.field
    def messages(self, limit: int = 50, offset: int = 0) -> list[AgentMessageType]:
        return models.AgentMessage.objects.filter(agent_id=self.id).order_by("created_at")[offset:offset + limit]

    @strawberry_django.field
    def stream_messages(self, limit: int = 100, offset: int = 0) -> list[MessageType]:
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
