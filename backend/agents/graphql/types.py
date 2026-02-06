import strawberry_django
from strawberry import auto

from agents import models


@strawberry_django.type(models.Goal)
class GoalType:
    id: auto
    text: auto
    context_path: auto
    plan: auto
    status: auto
    created_at: auto
    satisfied_at: auto


@strawberry_django.type(models.Agent)
class AgentType:
    id: auto
    name: auto
    runtime: auto
    sandbox_id: auto
    vnc_url: auto
    status: auto
    confidence: auto
    sentiment: auto
    summary: auto
    reasoning: auto
    output: auto
    created_at: auto
    completed_at: auto
    goal: GoalType | None


@strawberry_django.type(models.AgentEvent)
class AgentEventType:
    id: auto
    event_type: auto
    data: auto
    timestamp: auto


@strawberry_django.type(models.Case)
class CaseType:
    id: auto
    goal_text: auto
    context_path: auto
    plan: auto
    outcome: auto
    duration_seconds: auto
    total_tokens: auto
    created_at: auto
