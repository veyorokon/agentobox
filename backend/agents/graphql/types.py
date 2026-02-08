import strawberry
import strawberry_django
from strawberry import auto
from strawberry.scalars import JSON

from agents import models


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
    created_at: auto


@strawberry.type
class AgentEventType:
    """Ephemeral event pushed through channels — not DB-backed."""

    event_type: str
    data: JSON
    agent_id: str
    agent_name: str
