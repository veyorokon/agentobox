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
    created_at: auto

    @strawberry_django.field
    def messages(self, limit: int = 50, offset: int = 0) -> list[AgentMessageType]:
        return models.AgentMessage.objects.filter(agent_id=self.id).order_by("created_at")[offset:offset + limit]


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
