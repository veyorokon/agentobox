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
        runtime_status_projection={
            "profile": "desktop",
            "startup_stage": "managed_ready",
            "runtime_state": "ready",
            "transport": {"connected": True},
            "services": {
                "xvfb": "up",
                "x11vnc": "up",
                "websockify": "up",
                "awesome": "up",
                "browser": "up",
            },
        },
        agent_type="claude-code",
    )
    running = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="running-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.RUNNING,
        relay_connected=True,
        sandbox_id="sb-789",
        vnc_url="ws://vnc-running",
        runtime_status_projection={
            "profile": "desktop",
            "startup_stage": "managed_ready",
            "runtime_state": "running",
            "transport": {"connected": True},
            "services": {
                "xvfb": "up",
                "x11vnc": "up",
                "websockify": "up",
                "awesome": "up",
                "browser": "up",
            },
        },
        agent_type="claude-code",
    )
    booting = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="booting-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sb-boot",
        vnc_url="ws://vnc-booting",
        runtime_status_projection={
            "profile": "desktop",
            "startup_stage": "transport_connecting",
            "runtime_state": "starting",
            "transport": {"connected": False},
            "services": {
                "xvfb": "up",
                "x11vnc": "down",
                "websockify": "down",
                "awesome": "up",
                "browser": "down",
            },
        },
        agent_type="claude-code",
    )
    booting_without_status = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="booting-no-status-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sb-boot-empty",
        vnc_url="ws://vnc-booting-empty",
        runtime_status_projection={},
        agent_type="claude-code",
    )
    desktop_not_ready = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="desktop-not-ready-agent",
        project=project,
        runtime="modal",
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sb-234",
        vnc_url="ws://vnc-not-ready",
        runtime_status_projection={
            "profile": "desktop",
            "startup_stage": "managed_ready",
            "runtime_state": "ready",
            "transport": {"connected": True},
            "services": {
                "xvfb": "up",
                "x11vnc": "up",
                "websockify": "up",
                "awesome": "up",
                "browser": "down",
            },
        },
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
    running_payload = await serialize_agent(running)
    booting_payload = await serialize_agent(booting)
    booting_without_status_payload = await serialize_agent(booting_without_status)
    desktop_not_ready_payload = await serialize_agent(desktop_not_ready)
    unavailable_payload = await serialize_agent(unavailable)
    errored_payload = await serialize_agent(errored)

    assert deploying_payload["previewState"] == "deploying"
    assert deploying_payload["previewRuntimeId"] == ""
    assert ready_payload["previewState"] == "ready"
    assert ready_payload["previewRuntimeId"] == "sb-123"
    assert running_payload["previewState"] == "ready"
    assert running_payload["previewRuntimeId"] == "sb-789"
    assert booting_payload["previewState"] == "deploying"
    assert booting_payload["previewRuntimeId"] == ""
    assert booting_without_status_payload["previewState"] == "deploying"
    assert booting_without_status_payload["previewRuntimeId"] == ""
    assert desktop_not_ready_payload["previewState"] == "ready"
    assert desktop_not_ready_payload["previewRuntimeId"] == "sb-234"
    assert unavailable_payload["previewState"] == "unavailable"
    assert unavailable_payload["previewRuntimeId"] == ""
    assert errored_payload["previewState"] == "error"
    assert errored_payload["previewRuntimeId"] == ""
