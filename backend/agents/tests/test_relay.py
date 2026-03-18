"""Tests for agents.services.relay — content normalization, inbox durability, and wire payloads."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.models import AgentStatus
from agents.services.relay import (
    _normalize_content,
    _sync_append_to_sandbox,
    _sync_write_to_sandbox,
    deliver_input,
    send_message,
    set_agent_mode,
    update_volume_and_reload,
)
from agents.services.relay_commands import (
    CallbackBehavior,
    CallbackResponseCommand,
    CommandType,
    ReloadCommand,
    SignalAction,
    SignalCommand,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Enum value locking — prevent accidental renames that break the wire protocol
# ---------------------------------------------------------------------------


def test_command_type_values_are_locked():
    """CommandType string values are part of the wire protocol. Never rename."""
    assert CommandType.RELOAD.value == "reload"
    assert CommandType.SIGNAL.value == "signal"
    assert CommandType.CALLBACK_RESPONSE.value == "callback_response"


def test_signal_action_values_are_locked():
    """SignalAction string values are part of the wire protocol. Never rename."""
    assert SignalAction.INTERRUPT.value == "interrupt"
    assert SignalAction.RESTART.value == "restart"
    assert SignalAction.CLEAR.value == "clear"


def test_callback_behavior_values_are_locked():
    """CallbackBehavior string values are part of the wire protocol. Never rename."""
    assert CallbackBehavior.ALLOW.value == "allow"
    assert CallbackBehavior.DENY.value == "deny"
    # Agent only supports allow|deny. No allowall — see agent/transports/agentobox/commands.py
    assert len(CallbackBehavior) == 2


# ---------------------------------------------------------------------------
# Wire format round-trip — construct → to_wire → verify exact shape
# ---------------------------------------------------------------------------


def test_reload_command_wire_format():
    """ReloadCommand produces exact wire dict and round-trips cleanly."""
    cmd = ReloadCommand(path="_abox/state.json")
    wire = cmd.to_wire()
    assert wire == {"type": "reload", "path": "_abox/state.json"}
    # Reconstruct from wire and verify equality
    assert ReloadCommand(path=wire["path"]) == cmd


def test_signal_command_wire_format():
    """SignalCommand produces exact wire dict for each action."""
    for action in SignalAction:
        cmd = SignalCommand(action=action)
        wire = cmd.to_wire()
        assert wire == {"type": "signal", "action": action.value}
        assert SignalCommand(action=SignalAction(wire["action"])) == cmd


def test_callback_response_wire_format_without_message():
    """CallbackResponseCommand omits message when empty."""
    cmd = CallbackResponseCommand(request_id="req-1", behavior=CallbackBehavior.ALLOW)
    wire = cmd.to_wire()
    assert wire == {"type": "callback_response", "request_id": "req-1", "behavior": "allow"}
    assert "message" not in wire
    # Round-trip
    reconstructed = CallbackResponseCommand(
        request_id=wire["request_id"],
        behavior=CallbackBehavior(wire["behavior"]),
    )
    assert reconstructed == cmd


def test_callback_response_wire_format_with_message():
    """CallbackResponseCommand includes message when non-empty."""
    cmd = CallbackResponseCommand(
        request_id="req-2",
        behavior=CallbackBehavior.DENY,
        message="Not allowed",
    )
    wire = cmd.to_wire()
    assert wire == {
        "type": "callback_response",
        "request_id": "req-2",
        "behavior": "deny",
        "message": "Not allowed",
    }
    reconstructed = CallbackResponseCommand(
        request_id=wire["request_id"],
        behavior=CallbackBehavior(wire["behavior"]),
        message=wire.get("message", ""),
    )
    assert reconstructed == cmd


def _image_block(url, media_type=None):
    """Helper: build an image content block with a URL source."""
    source = {"type": "url", "url": url}
    if media_type:
        source["media_type"] = media_type
    return {"type": "image", "source": source}


# ---------------------------------------------------------------------------
# SSRF prevention: untrusted hosts are skipped
# ---------------------------------------------------------------------------


def test_normalize_content_blocks_untrusted_host():
    """Non-allowlisted host is skipped — block is left with its original URL source."""
    block = _image_block("http://evil.example.com/image.png")
    result = _normalize_content([block])

    # Block should still have the original URL source (not converted to base64)
    assert result[0]["source"]["type"] == "url"
    assert result[0]["source"]["url"] == "http://evil.example.com/image.png"


# ---------------------------------------------------------------------------
# Allowlisted hosts: localhost and localstack
# ---------------------------------------------------------------------------


def test_normalize_content_allows_localhost():
    """localhost URLs are fetched and converted to base64."""
    fake_resp = MagicMock()
    fake_resp.read.return_value = b"\x89PNG\r\n\x1a\n"  # minimal PNG magic bytes
    fake_resp.headers = {"Content-Type": "image/png"}

    block = _image_block("http://localhost:4566/bucket/image.png")

    with patch("urllib.request.urlopen", return_value=fake_resp) as mock_urlopen:
        result = _normalize_content([block])

    # urlopen should be called with localhost rewritten to localstack
    mock_urlopen.assert_called_once()
    called_url = mock_urlopen.call_args[0][0]
    assert "localstack:" in called_url

    # Block should now be base64
    assert result[0]["source"]["type"] == "base64"
    assert result[0]["source"]["media_type"] == "image/png"
    assert "data" in result[0]["source"]


def test_normalize_content_allows_localstack():
    """localstack URLs are fetched directly."""
    fake_resp = MagicMock()
    fake_resp.read.return_value = b"\x89PNG\r\n\x1a\n"
    fake_resp.headers = {"Content-Type": "image/png"}

    block = _image_block("http://localstack:4566/bucket/image.png")

    with patch("urllib.request.urlopen", return_value=fake_resp) as mock_urlopen:
        result = _normalize_content([block])

    mock_urlopen.assert_called_once()
    assert result[0]["source"]["type"] == "base64"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_normalize_content_strips_media_type_from_url_source():
    """media_type is removed from URL sources (only valid for base64)."""
    block = _image_block("https://cdn.example.com/photo.jpg", media_type="image/jpeg")
    result = _normalize_content([block])

    # HTTPS URLs are left as-is (no fetch) but media_type is stripped
    assert "media_type" not in result[0]["source"]
    assert result[0]["source"]["type"] == "url"


def test_normalize_content_ignores_non_url_blocks():
    """Text blocks and base64 blocks pass through unchanged."""
    blocks = [
        {"type": "text", "text": "hello"},
        {"type": "image", "source": {"type": "base64", "data": "abc", "media_type": "image/png"}},
    ]
    result = _normalize_content(blocks)
    assert result[0] == {"type": "text", "text": "hello"}
    assert result[1]["source"]["type"] == "base64"


# ---------------------------------------------------------------------------
# WebSocket push on send_message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_message_pushes_to_dashboard_ws():
    """send_message() triggers a WebSocket push for the agent timeline update."""
    # Mock agent
    fake_agent = MagicMock()
    fake_agent.id = "agent-123"
    fake_agent.project_id = "proj-456"
    fake_agent.session_id = "session-789"
    fake_agent.status = "running"

    # Mock stream event
    fake_stream_event = MagicMock()
    fake_stream_event.id = "event-abc"

    # Mock channel layer
    mock_channel_layer = MagicMock()
    mock_channel_layer.group_send = AsyncMock()

    # Mock serialized agent
    fake_serialized_agent = {"_t": "agent", "id": "agent-123", "name": "test-agent"}

    # Mock volume for _send_via_inbox
    fake_volume = MagicMock()
    fake_agent.volume = fake_volume

    with (
        patch("agents.services.relay.Agent.objects.aget", new_callable=AsyncMock, return_value=fake_agent),
        patch("agents.services.relay.create_stream_event", new_callable=AsyncMock, return_value=fake_stream_event),
        patch("agents.services.relay.push_to_relay", new_callable=AsyncMock),
        patch("agents.services.relay.get_channel_layer", return_value=mock_channel_layer),
        patch("agents.serializers.serialize_agent", new_callable=AsyncMock, return_value=fake_serialized_agent),
    ):
        result = await send_message("agent-123", "Hello agent!")

    # Assert send_message succeeded
    assert result is True

    # Assert WebSocket push was triggered
    mock_channel_layer.group_send.assert_called_once()
    call_args = mock_channel_layer.group_send.call_args
    assert call_args[0][0] == "dashboard_proj-456"  # group name
    assert call_args[0][1]["type"] == "dashboard.agent_update"
    assert call_args[0][1]["payload"] == fake_serialized_agent


@pytest.mark.asyncio
async def test_deliver_input_writes_canonical_task_envelope():
    """deliver_input() writes the new task envelope to inbox, not the legacy input/payload shape."""
    fake_agent = MagicMock()
    fake_agent.id = "agent-123"
    fake_agent.volume = MagicMock()

    content = [{"type": "text", "text": "hello"}]
    with patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=False) as mock_push:
        result = await deliver_input(fake_agent, content, task_id="test-task-1")

    assert result is False
    # Assert the canonical task envelope — not the legacy {"type": "input", "payload": ...}
    fake_agent.volume.append_task.assert_called_once_with(task_id="test-task-1", content=content)
    # Assert reload command
    mock_push.assert_awaited_once()
    cmd = mock_push.await_args.args[1]
    assert isinstance(cmd, ReloadCommand)
    assert cmd.path == "_abox/inbox.jsonl"


@pytest.mark.asyncio
async def test_deliver_input_syncs_inbox_to_modal_sandbox():
    """deliver_input() must push the task line into the Modal sandbox.

    Regression: messages written to local filesystem are invisible to Modal
    sandboxes. The inbox append must be synced via runtime.exec so the
    relay inside the sandbox can read it.
    """
    fake_agent = MagicMock()
    fake_agent.id = "agent-modal-1"
    fake_agent.runtime = "modal"
    fake_agent.sandbox_id = "sb-abc123"
    fake_agent.volume = MagicMock()

    mock_runtime = MagicMock()
    mock_runtime.exec = AsyncMock(return_value="")

    content = [{"type": "text", "text": "hello from modal"}]
    with (
        patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=True),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        await deliver_input(fake_agent, content, task_id="modal-task-1")

    # Local write still happens (durable record)
    fake_agent.volume.append_task.assert_called_once()
    # Sandbox exec must be called to append the line inside the container
    mock_runtime.exec.assert_awaited_once()
    exec_args = mock_runtime.exec.await_args
    assert exec_args.args[0] == "sb-abc123"
    cmd = exec_args.args[1]
    assert ">> /vol/agents/agent-modal-1/_abox/inbox.jsonl" in cmd[-1]
    # The base64-encoded payload must decode to valid JSONL with trailing newline.
    # Without the newline, readline() in the relay never returns the line.
    import base64
    b64_token = cmd[-1].split("echo ", 1)[1].split(" |", 1)[0]
    decoded = base64.b64decode(b64_token).decode()
    assert decoded.endswith("\n"), f"inbox line must end with newline, got: {decoded!r}"
    import json
    parsed = json.loads(decoded.strip())
    assert parsed["type"] == "task"
    assert parsed["task_id"] == "modal-task-1"


@pytest.mark.asyncio
async def test_deliver_input_skips_sandbox_sync_for_docker():
    """Docker agents share filesystem — no sandbox sync needed."""
    fake_agent = MagicMock()
    fake_agent.id = "agent-docker-1"
    fake_agent.runtime = "docker"
    fake_agent.sandbox_id = "container-xyz"
    fake_agent.volume = MagicMock()

    content = [{"type": "text", "text": "hello from docker"}]
    with (
        patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=True),
        patch("agents.runtimes.get_runtime") as mock_get_runtime,
    ):
        await deliver_input(fake_agent, content, task_id="docker-task-1")

    fake_agent.volume.append_task.assert_called_once()
    mock_get_runtime.assert_not_called()


@pytest.mark.asyncio
async def test_update_volume_and_reload_syncs_to_modal_sandbox():
    """update_volume_and_reload() must push file content into Modal sandbox.

    Regression: mode changes, theme updates, and state writes go through
    this path. Without sandbox sync, the Modal agent never sees the update.
    """
    fake_agent = MagicMock()
    fake_agent.id = "agent-modal-2"
    fake_agent.runtime = "modal"
    fake_agent.sandbox_id = "sb-def456"
    fake_agent.volume = MagicMock()
    fake_agent.volume.mutate.return_value = ReloadCommand(path="_abox/state.json")

    mock_runtime = MagicMock()
    mock_runtime.write_file = AsyncMock()

    with (
        patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=True),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        await update_volume_and_reload(fake_agent, "_abox/state.json", '{"mode": "plan"}')

    fake_agent.volume.mutate.assert_called_once_with("_abox/state.json", '{"mode": "plan"}')
    mock_runtime.write_file.assert_awaited_once_with(
        "sb-def456",
        b'{"mode": "plan"}',
        "/vol/agents/agent-modal-2/_abox/state.json",
    )


@pytest.mark.asyncio
async def test_sync_append_skips_when_no_sandbox_id():
    """Sync helpers must be no-ops when sandbox_id is empty (agent not yet provisioned)."""
    fake_agent = MagicMock()
    fake_agent.runtime = "modal"
    fake_agent.sandbox_id = ""

    with patch("agents.runtimes.get_runtime") as mock_get_runtime:
        await _sync_append_to_sandbox(fake_agent, "_abox/inbox.jsonl", '{"test": true}')
        await _sync_write_to_sandbox(fake_agent, "_abox/state.json", '{"mode": "auto"}')

    mock_get_runtime.assert_not_called()


@pytest.mark.asyncio
async def test_deliver_input_generates_task_id_when_omitted():
    """deliver_input() generates a task_id if not provided."""
    fake_agent = MagicMock()
    fake_agent.id = "agent-123"
    fake_agent.volume = MagicMock()

    with patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=True):
        await deliver_input(fake_agent, [{"type": "text", "text": "hello"}])

    fake_agent.volume.append_task.assert_called_once()
    _, kwargs = fake_agent.volume.append_task.call_args
    assert len(kwargs["task_id"]) == 16  # uuid hex[:16]
    assert kwargs["content"][0]["type"] == "text"


@pytest.mark.asyncio
async def test_interagent_delivery_passes_content_blocks():
    """Inter-agent delivery passes content blocks to deliver_input, not wrapped message dicts."""
    from agents.services.interagent import deliver_to_stdin

    target = MagicMock()
    target.id = "agent-456"
    target.name = "worker-1"
    target.session_id = "session-123"

    with (
        patch("agents.services.interagent.create_stream_event", new_callable=AsyncMock),
        patch("agents.services.interagent.deliver_input", new_callable=AsyncMock, return_value=True) as mock_deliver,
    ):
        result = await deliver_to_stdin("lead", target, "Please review this.")

    assert result is True
    mock_deliver.assert_awaited_once()
    # deliver_input now receives content blocks directly, not a message wrapper
    content_blocks = mock_deliver.await_args.args[1]
    assert isinstance(content_blocks, list)
    assert content_blocks[0]["type"] == "text"
    assert content_blocks[0]["text"].startswith("[Team message from lead]:")


@pytest.mark.asyncio
async def test_set_agent_mode_recomputes_intervention_attention_for_supervised_mode():
    fake_agent = MagicMock()
    fake_agent.id = "agent-123"
    fake_agent.project_id = "proj-456"
    fake_agent.agent_type = "claude-code"
    fake_agent.status = AgentStatus.IDLE
    fake_agent.mode = "auto"
    fake_agent.model = "claude-haiku"
    fake_agent.allowed_tools = []
    fake_agent.latest_snapshot = {"result": {"type": "result", "session_id": "session-1"}}
    fake_agent.arefresh_from_db = AsyncMock()
    fake_agent.asave = AsyncMock()
    fake_agent.volume = MagicMock()
    fake_agent.volume.mutate_state.return_value = ReloadCommand(path="_abox/state.json")

    fake_adapter = MagicMock()
    fake_adapter.mode_to_wire.return_value = "default"

    with (
        patch("agents.services.relay.Agent.objects.aget", new_callable=AsyncMock, return_value=fake_agent),
        patch("agents.services.relay.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
        patch("agents.services.relay.create_stream_event", new_callable=AsyncMock),
        patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=True),
        patch("agents.adapters.get_adapter", return_value=fake_adapter),
        patch("agents.services.feed.recompute_attention", new_callable=AsyncMock) as mock_recompute,
    ):
        result = await set_agent_mode("agent-123", "supervised")

    assert result is fake_agent
    mock_recompute.assert_awaited_once_with("proj-456", "agent-123")
    mock_broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_set_agent_mode_recomputes_attention_when_leaving_supervised():
    fake_agent = MagicMock()
    fake_agent.id = "agent-123"
    fake_agent.project_id = "proj-456"
    fake_agent.agent_type = "claude-code"
    fake_agent.status = AgentStatus.IDLE
    fake_agent.mode = "supervised"
    fake_agent.model = "claude-haiku"
    fake_agent.allowed_tools = []
    fake_agent.latest_snapshot = {"result": {"type": "result", "session_id": "session-1"}}
    fake_agent.arefresh_from_db = AsyncMock()
    fake_agent.asave = AsyncMock()
    fake_agent.volume = MagicMock()
    fake_agent.volume.mutate_state.return_value = ReloadCommand(path="_abox/state.json")

    fake_adapter = MagicMock()
    fake_adapter.mode_to_wire.return_value = "acceptEdits"

    with (
        patch("agents.services.relay.Agent.objects.aget", new_callable=AsyncMock, return_value=fake_agent),
        patch("agents.services.relay.broadcast_agent_update", new_callable=AsyncMock),
        patch("agents.services.relay.create_stream_event", new_callable=AsyncMock),
        patch("agents.services.relay.push_to_relay", new_callable=AsyncMock, return_value=True),
        patch("agents.adapters.get_adapter", return_value=fake_adapter),
        patch("agents.services.feed.recompute_attention", new_callable=AsyncMock) as mock_recompute,
    ):
        await set_agent_mode("agent-123", "auto")

    mock_recompute.assert_awaited_once_with("proj-456", "agent-123")
