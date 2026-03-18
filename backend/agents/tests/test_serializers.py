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


@pytest.mark.django_db
@pytest.mark.asyncio
async def test_serialize_agent_derives_preview_contract():
    from django.contrib.auth import get_user_model

    from agents.serializers import serialize_agent
    from projects.models import Project

    User = get_user_model()
    user = await sync_to_async(User.objects.create_user, thread_sensitive=True)(
        username="test_serializer_preview", password="test"
    )
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Serializer Preview", owner=user
    )

    deploying = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="deploying-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.DEPLOYING,
        agent_type="claude-code",
    )
    ready = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="ready-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sb-123",
        vnc_url="ws://vnc",
        agent_type="claude-code",
    )
    unavailable = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="unavailable-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.IDLE,
        sandbox_id="sb-456",
        agent_type="claude-code",
    )
    errored = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="error-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.ERROR,
        error_message="runtime crashed",
        agent_type="claude-code",
    )

    deploying_payload = await serialize_agent(deploying)
    ready_payload = await serialize_agent(ready)
    unavailable_payload = await serialize_agent(unavailable)
    errored_payload = await serialize_agent(errored)

    assert deploying_payload["previewState"] == "deploying"
    assert deploying_payload["previewRuntimeId"] == ""
    assert ready_payload["previewState"] == "ready"
    assert ready_payload["previewRuntimeId"] == "sb-123"
    assert unavailable_payload["previewState"] == "unavailable"
    assert unavailable_payload["previewRuntimeId"] == ""
    assert errored_payload["previewState"] == "error"
    assert errored_payload["previewRuntimeId"] == ""
