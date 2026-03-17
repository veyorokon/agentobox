import socket
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.consumers import RelayConsumer, _is_transient_vnc_upstream_failure
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
async def test_receive_json_ignores_task_update():
    consumer = _relay_consumer()
    content = {
        "type": "task_update",
        "task_id": "task-1",
        "state": "completed",
        "output_text": "pong",
    }

    with patch("agents.services.stream.process_stream_event", new_callable=AsyncMock) as mock_process:
        await consumer.receive_json(content)

    mock_process.assert_not_called()


def test_transient_vnc_upstream_failure_when_agent_is_still_deploying():
    agent = MagicMock(status=AgentStatus.DEPLOYING, relay_connected=False)

    assert _is_transient_vnc_upstream_failure(agent, socket.gaierror(-2, "Name or service not known")) is True


def test_transient_vnc_upstream_failure_false_for_ready_agent():
    agent = MagicMock(status=AgentStatus.IDLE, relay_connected=True)

    assert _is_transient_vnc_upstream_failure(agent, socket.gaierror(-2, "Name or service not known")) is False
