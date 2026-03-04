"""Tests for stream.py snapshot writes and phase logic."""

import pytest
from unittest.mock import AsyncMock, patch

from agents.models import Agent, AgentStatus


@pytest.fixture
def mock_broadcast():
    """Patch broadcast functions to no-op."""
    with (
        patch("agents.services.stream.broadcast_agent_update", new_callable=AsyncMock) as ba,
        patch("agents.services.stream.create_feed_item", new_callable=AsyncMock) as cf,
        patch("agents.services.stream.recompute_attention", new_callable=AsyncMock) as ra,
    ):
        yield {"broadcast_agent": ba, "create_feed": cf, "recompute": ra}


@pytest.mark.django_db(transaction=True)
class TestSnapshotWrites:
    """Principle: latest_snapshot is a faithful mirror of the last event pair.

    assistant events replace the assistant key and clear result;
    result events add the result key alongside the existing assistant.
    No other fields are modified. The snapshot is the sole input to adapters.
    """

    @pytest.fixture
    def agent(self, db):
        from projects.models import Project
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="test_stream", password="test")
        project = Project.objects.create(name="Test Stream", owner=user)
        return Agent.objects.create(
            name="stream-test",
            project=project,
            runtime="docker",
            status=AgentStatus.RUNNING,
            session_id="session_001",
            agent_type="claude-code",
        )

    @pytest.mark.asyncio
    async def test_assistant_event_updates_snapshot(self, agent, mock_broadcast):
        from agents.services.stream import _update_assistant_fields

        event = {
            "type": "assistant",
            "message": {
                "content": [{"type": "text", "text": "Hello world"}]
            },
        }
        await _update_assistant_fields(agent, event)

        assert agent.latest_snapshot["assistant"] == event
        assert "result" not in agent.latest_snapshot

    @pytest.mark.asyncio
    async def test_result_event_updates_snapshot(self, agent, mock_broadcast):
        from agents.services.stream import _handle_result

        # First set an assistant snapshot
        agent.latest_snapshot = {
            "assistant": {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "Done."}]},
            }
        }
        await agent.asave(update_fields=["latest_snapshot"])

        result_event = {
            "type": "result",
            "session_id": "session_001",
            "duration_ms": 5000,
            "num_turns": 3,
            "total_cost_usd": 0.01,
            "is_error": False,
        }
        await _handle_result(agent, result_event)

        assert agent.latest_snapshot["result"] == result_event
        assert agent.latest_snapshot["assistant"]["type"] == "assistant"

    @pytest.mark.asyncio
    async def test_new_assistant_clears_result(self, agent, mock_broadcast):
        from agents.services.stream import _update_assistant_fields

        # Start with a snapshot that has both assistant and result
        agent.latest_snapshot = {
            "assistant": {"type": "assistant", "message": {"content": []}},
            "result": {"type": "result", "duration_ms": 1000},
        }

        new_event = {
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "New turn"}]},
        }
        await _update_assistant_fields(agent, new_event)

        assert "result" not in agent.latest_snapshot
        assert agent.latest_snapshot["assistant"] == new_event


@pytest.mark.django_db(transaction=True)
class TestPhaseLogic:
    """Principle: phase transitions derive from stream events, not guesswork.

    The phase field (thinking, responding, tool_input, tool_use, idle) is set
    by stream_event subtypes, not by the LLM output content. result events
    reset phase to idle. Phase is a materialized field on Agent for dashboard
    display — it must never contradict the event log.
    """

    @pytest.fixture
    def agent(self, db):
        from projects.models import Project
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="test_phase", password="test")
        project = Project.objects.create(name="Test Phase", owner=user)
        return Agent.objects.create(
            name="phase-test",
            project=project,
            runtime="docker",
            status=AgentStatus.RUNNING,
            session_id="session_002",
            phase="responding",
        )

    @pytest.mark.asyncio
    async def test_message_stop_after_text_no_tool_use(self, agent, mock_broadcast):
        """message_stop after pure text (responding) should NOT set tool-use."""
        from agents.services.stream import _handle_phase

        agent.phase = "responding"
        event = {
            "type": "stream_event",
            "event": {"type": "message_stop"},
        }
        await _handle_phase(agent, event)

        # Phase should remain "responding" — no change because message_stop
        # only transitions to tool-use from tool-input
        assert agent.phase == "responding"

    @pytest.mark.asyncio
    async def test_message_stop_after_tool_input_sets_tool_use(self, agent, mock_broadcast):
        """message_stop after tool-input should set tool-use."""
        from agents.services.stream import _handle_phase

        agent.phase = "tool-input"
        event = {
            "type": "stream_event",
            "event": {"type": "message_stop"},
        }
        await _handle_phase(agent, event)

        assert agent.phase == "tool-use"

    @pytest.mark.asyncio
    async def test_content_block_start_text_sets_responding(self, agent, mock_broadcast):
        from agents.services.stream import _handle_phase

        agent.phase = ""
        event = {
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "content_block": {"type": "text"},
            },
        }
        await _handle_phase(agent, event)
        assert agent.phase == "responding"

    @pytest.mark.asyncio
    async def test_content_block_start_thinking_sets_thinking(self, agent, mock_broadcast):
        from agents.services.stream import _handle_phase

        agent.phase = ""
        event = {
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "content_block": {"type": "thinking"},
            },
        }
        await _handle_phase(agent, event)
        assert agent.phase == "thinking"

    @pytest.mark.asyncio
    async def test_content_block_start_tool_use_sets_tool_input(self, agent, mock_broadcast):
        from agents.services.stream import _handle_phase

        agent.phase = ""
        event = {
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "content_block": {"type": "tool_use"},
            },
        }
        await _handle_phase(agent, event)
        assert agent.phase == "tool-input"


@pytest.mark.django_db(transaction=True)
class TestMessageInterception:
    """Principle: CC native SendMessage doesnt fire PostToolUse hooks.

    The stream processor intercepts SendMessage tool_use blocks in assistant
    events and creates agent-message feed items — same data as MCP coord would
    produce, but triggered from the stream instead of the hook bridge.
    """

    @pytest.fixture
    def agent(self, db):
        from projects.models import Project
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="test_msg", password="test")
        project = Project.objects.create(name="Test Msg", owner=user)
        return Agent.objects.create(
            name="sender",
            project=project,
            runtime="docker",
            status=AgentStatus.RUNNING,
            session_id="session_msg",
            agent_type="claude-code",
        )

    @pytest.mark.asyncio
    async def test_send_message_creates_feed_item(self, agent, mock_broadcast):
        from agents.services.stream import _maybe_create_message_item
        from agents.models import StreamEvent

        source = await StreamEvent.objects.acreate(
            agent=agent, session_id="s1", event_type="assistant", data={},
        )
        event = {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Sending a message"},
                    {
                        "type": "tool_use",
                        "id": "toolu_123",
                        "name": "SendMessage",
                        "input": {
                            "type": "message",
                            "recipient": "team-lead",
                            "content": "Hello from sender",
                            "summary": "Greeting",
                        },
                    },
                ],
            },
        }
        await _maybe_create_message_item(agent, event, source)

        mock_broadcast["create_feed"].assert_called_once()
        call_kwargs = mock_broadcast["create_feed"].call_args[1]
        assert call_kwargs["type"] == "agent-message"
        assert call_kwargs["from_value"] == "sender"
        assert call_kwargs["to_value"] == "team-lead"
        assert call_kwargs["text"] == "Hello from sender"

    @pytest.mark.asyncio
    async def test_broadcast_message_creates_feed_item(self, agent, mock_broadcast):
        from agents.services.stream import _maybe_create_message_item
        from agents.models import StreamEvent

        source = await StreamEvent.objects.acreate(
            agent=agent, session_id="s1", event_type="assistant", data={},
        )
        event = {
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "toolu_456",
                    "name": "SendMessage",
                    "input": {
                        "type": "broadcast",
                        "content": "Attention everyone",
                        "summary": "Team announcement",
                    },
                }],
            },
        }
        await _maybe_create_message_item(agent, event, source)

        call_kwargs = mock_broadcast["create_feed"].call_args[1]
        assert call_kwargs["to_value"] == "all"

    @pytest.mark.asyncio
    async def test_shutdown_request_no_feed_item(self, agent, mock_broadcast):
        from agents.services.stream import _maybe_create_message_item
        from agents.models import StreamEvent

        source = await StreamEvent.objects.acreate(
            agent=agent, session_id="s1", event_type="assistant", data={},
        )
        event = {
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "toolu_789",
                    "name": "SendMessage",
                    "input": {
                        "type": "shutdown_request",
                        "recipient": "worker",
                        "content": "Shutting down",
                    },
                }],
            },
        }
        await _maybe_create_message_item(agent, event, source)

        mock_broadcast["create_feed"].assert_not_called()

    @pytest.mark.asyncio
    async def test_non_sendmessage_tool_ignored(self, agent, mock_broadcast):
        from agents.services.stream import _maybe_create_message_item
        from agents.models import StreamEvent

        source = await StreamEvent.objects.acreate(
            agent=agent, session_id="s1", event_type="assistant", data={},
        )
        event = {
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "toolu_abc",
                    "name": "Edit",
                    "input": {"file_path": "/foo.py"},
                }],
            },
        }
        await _maybe_create_message_item(agent, event, source)

        mock_broadcast["create_feed"].assert_not_called()
