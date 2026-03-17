import pytest
from asgiref.sync import sync_to_async

from agents.models import Agent, AgentStatus, SessionResult


pytestmark = pytest.mark.integration


@pytest.mark.django_db
@pytest.mark.asyncio
async def test_serialize_agent_cost_accumulates_latest_total_per_session():
    from django.contrib.auth import get_user_model

    from agents.serializers import serialize_agent
    from projects.models import Project

    User = get_user_model()
    user = await sync_to_async(User.objects.create_user, thread_sensitive=True)(
        username="test_serializer_cost", password="test"
    )
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Serializer Cost", owner=user
    )
    agent = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="serializer-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        agent_type="claude-code",
        session_cost_usd=0.99,
    )

    await sync_to_async(SessionResult.objects.create, thread_sensitive=True)(
        agent=agent,
        session_id="session-a",
        total_cost_usd=0.01,
        duration_ms=1000,
    )
    await sync_to_async(SessionResult.objects.create, thread_sensitive=True)(
        agent=agent,
        session_id="session-a",
        total_cost_usd=0.04,
        duration_ms=2000,
    )
    await sync_to_async(SessionResult.objects.create, thread_sensitive=True)(
        agent=agent,
        session_id="session-b",
        total_cost_usd=0.02,
        duration_ms=1000,
    )

    payload = await serialize_agent(agent)
    assert payload["cost"] == pytest.approx(0.06)
