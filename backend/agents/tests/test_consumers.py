import socket
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from django.utils import timezone

from agents.consumers import (
    RelayConsumer,
    _is_transient_vnc_upstream_failure,
    _should_mark_vnc_runtime_unavailable,
)
from agents.models import AgentStatus


pytestmark = pytest.mark.unit


def _relay_consumer() -> RelayConsumer:
    consumer = RelayConsumer()
    consumer.agent = MagicMock()
    consumer.agent.id = "agent-123"
    consumer.agent_id = "agent-123"
    consumer.send_json = AsyncMock()
    return consumer


@pytest.mark.asyncio
async def test_connect_marks_relay_connected_without_premature_ready_transition():
    consumer = RelayConsumer()
    consumer.scope = {
        "url_route": {"kwargs": {"agent_id": "agent-123"}},
        "headers": [(b"authorization", b"Bearer test-token")],
    }
    consumer.channel_name = "channel-123"
    consumer.channel_layer = MagicMock()
    consumer.channel_layer.group_add = AsyncMock()
    consumer.accept = AsyncMock()
    consumer.close = AsyncMock()

    agent = MagicMock()
    agent.id = "agent-123"
    agent.status = AgentStatus.DEPLOYING
    agent.relay_connected = False
    agent.deployed_at = None
    agent.asave = AsyncMock()

    with (
        patch("agents.services.auth_relay.get_relay_agent", new_callable=AsyncMock, return_value=agent),
        patch("agents.services.reconcile.ensure_running"),
        patch("agents.services.broadcast.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
    ):
        await consumer.connect()

    agent.asave.assert_awaited_once()
    assert agent.relay_connected is True
    assert agent.deployed_at is not None
    mock_broadcast.assert_awaited_once_with(agent)


@pytest.mark.asyncio
async def test_receive_json_routes_callback_request_to_callback_service():
    consumer = _relay_consumer()
    content = {
        "type": "callback_request",
        "request_id": "req-1",
        "callback_type": "can_use_tool",
        "payload": {"tool_name": "Bash", "tool_input": {"command": "ls"}},
    }

    with patch("agents.services.callbacks.process_callback", new_callable=AsyncMock) as mock_process:
        await consumer.receive_json(content)

    mock_process.assert_awaited_once_with(consumer.agent, content)


@pytest.mark.asyncio
async def test_receive_json_routes_execution_event_raw_message_to_stream_service():
    consumer = _relay_consumer()
    payload = {
        "type": "assistant",
        "message": {"id": "msg-1", "content": [{"type": "text", "text": "pong"}]},
    }
    content = {
        "type": "execution_event",
        "event_type": "raw_message",
        "session_id": "sess-1",
        "payload": payload,
    }

    with patch("agents.services.stream.process_stream_event", new_callable=AsyncMock) as mock_process:
        await consumer.receive_json(content)

    mock_process.assert_awaited_once_with(
        consumer.agent,
        {
            "type": "assistant",
            "session_id": "sess-1",
            "message": {"id": "msg-1", "content": [{"type": "text", "text": "pong"}]},
        },
    )


@pytest.mark.asyncio
async def test_receive_json_persists_task_update():
    consumer = _relay_consumer()
    content = {
        "type": "task_update",
        "task_id": "task-1",
        "state": "failed",
        "session_id": "sess-abc",
    }

    with (
        patch("agents.services.stream.process_stream_event", new_callable=AsyncMock) as mock_process,
        patch("agents.models.StreamEvent.objects") as mock_qs,
    ):
        mock_qs.acreate = AsyncMock()
        await consumer.receive_json(content)

    # Should NOT go through process_stream_event (that's for execution_event)
    mock_process.assert_not_called()
    # Should persist as a StreamEvent
    mock_qs.acreate.assert_called_once()
    call_kwargs = mock_qs.acreate.call_args[1]
    assert call_kwargs["agent_id"] == "agent-123"
    assert call_kwargs["event_type"] == "task_update"
    assert call_kwargs["data"]["task_id"] == "task-1"
    assert call_kwargs["data"]["state"] == "failed"
    assert call_kwargs["session_id"] == "sess-abc"
    assert call_kwargs["is_canonical"] is True


@pytest.mark.asyncio
async def test_receive_json_persists_runtime_status_projection():
    consumer = _relay_consumer()
    consumer.agent.relay_connected = False
    payload = {
        "status_version": "2",
        "profile": "desktop",
        "startup_stage": "managed_ready",
        "runtime_state": "ready",
        "transport": {"enabled": True, "connected": True, "state": "connected", "last_error": ""},
        "services": {"xvfb": "up", "x11vnc": "up", "websockify": "up", "awesome": "up"},
    }

    with (
        patch("agents.models.Agent.objects.filter") as mock_filter,
        patch("agents.services.broadcast.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
    ):
        mock_filter.return_value.aupdate = AsyncMock()
        await consumer.receive_json({"type": "runtime_status", "payload": payload})

    mock_filter.return_value.aupdate.assert_awaited_once_with(runtime_status_projection=payload)
    assert consumer.agent.runtime_status_projection == payload
    mock_broadcast.assert_awaited_once_with(consumer.agent)


@pytest.mark.asyncio
async def test_receive_json_runtime_ready_promotes_deploying_agent_and_completes_attempt():
    consumer = _relay_consumer()
    consumer.agent.status = AgentStatus.DEPLOYING
    consumer.agent.relay_connected = True
    payload = {
        "status_version": "2",
        "profile": "desktop",
        "startup_stage": "managed_ready",
        "runtime_state": "ready",
        "transport": {"enabled": True, "connected": True, "state": "connected", "last_error": ""},
        "services": {"xvfb": "up", "x11vnc": "up", "websockify": "up", "awesome": "up"},
    }

    with (
        patch("agents.models.Agent.objects.filter") as mock_filter,
        patch("agents.models.Agent.objects.aget", new_callable=AsyncMock, return_value=consumer.agent),
        patch("agents.services.broadcast.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
        patch("agents.services.lifecycle.succeed_active_lifecycle_attempts", new_callable=AsyncMock) as mock_succeed,
    ):
        mock_filter.return_value.aupdate = AsyncMock()
        await consumer.receive_json({"type": "runtime_status", "payload": payload})

    kwargs = mock_filter.return_value.aupdate.await_args.kwargs
    assert kwargs["status"] == AgentStatus.IDLE
    assert kwargs["runtime_status_projection"] == payload
    assert "deployed_at" not in kwargs
    assert consumer.agent.status == AgentStatus.IDLE
    mock_succeed.assert_awaited_once()
    mock_broadcast.assert_awaited_once_with(consumer.agent)


@pytest.mark.asyncio
async def test_relay_disconnect_broadcasts_updated_agent_state():
    consumer = _relay_consumer()
    consumer.group_name = "relay_agent-123"
    consumer.channel_name = "channel-123"
    consumer.channel_layer = MagicMock()
    consumer.channel_layer.group_discard = AsyncMock()

    updated_agent = MagicMock()

    with (
        patch("agents.models.Agent.objects.filter") as mock_filter,
        patch("agents.models.Agent.objects.aget", new_callable=AsyncMock, return_value=updated_agent),
        patch("agents.services.broadcast.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
    ):
        mock_filter.return_value.aupdate = AsyncMock()
        await consumer.disconnect(1000)

    consumer.channel_layer.group_discard.assert_awaited_once_with("relay_agent-123", "channel-123")
    mock_filter.return_value.aupdate.assert_awaited_once()
    mock_broadcast.assert_awaited_once_with(updated_agent)


def test_transient_vnc_upstream_failure_when_agent_is_still_deploying():
    agent = MagicMock(status=AgentStatus.DEPLOYING, relay_connected=False)

    assert _is_transient_vnc_upstream_failure(agent, socket.gaierror(-2, "Name or service not known")) is True


def test_transient_vnc_upstream_failure_false_for_ready_agent():
    agent = MagicMock(status=AgentStatus.IDLE, relay_connected=True)

    assert _is_transient_vnc_upstream_failure(agent, socket.gaierror(-2, "Name or service not known")) is False


def test_transient_vnc_upstream_failure_for_recently_deployed_connection_refused():
    agent = MagicMock(
        status=AgentStatus.IDLE,
        relay_connected=True,
        deployed_at=timezone.now(),
    )

    assert _is_transient_vnc_upstream_failure(
        agent,
        ConnectionRefusedError(111, "Connect call failed"),
    ) is True


def test_marks_runtime_unavailable_for_ready_agent_with_missing_upstream():
    agent = MagicMock(
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sandbox-123",
    )

    assert _should_mark_vnc_runtime_unavailable(
        agent,
        socket.gaierror(-2, "Name or service not known"),
    ) is True


def test_marks_runtime_unavailable_for_connection_reset_on_ready_agent():
    agent = MagicMock(
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sandbox-123",
        deployed_at=None,
    )

    assert _should_mark_vnc_runtime_unavailable(
        agent,
        ConnectionResetError(),
    ) is True


def test_does_not_mark_runtime_unavailable_for_recent_connection_refused_on_ready_agent():
    agent = MagicMock(
        status=AgentStatus.IDLE,
        relay_connected=True,
        sandbox_id="sandbox-123",
        deployed_at=timezone.now(),
    )

    assert _should_mark_vnc_runtime_unavailable(
        agent,
        ConnectionRefusedError(111, "Connect call failed"),
    ) is False


def test_does_not_mark_runtime_unavailable_while_still_deploying():
    agent = MagicMock(
        status=AgentStatus.DEPLOYING,
        relay_connected=False,
        sandbox_id="sandbox-123",
    )

    assert _should_mark_vnc_runtime_unavailable(
        agent,
        socket.gaierror(-2, "Name or service not known"),
    ) is False
