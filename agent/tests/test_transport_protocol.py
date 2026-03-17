from __future__ import annotations

from agent.transports.agentobox.codec import (
    encode_downstream_command,
    encode_upstream_message,
    parse_downstream_command,
)
from agent.transports.agentobox.commands import (
    RelayAction,
    CallbackBehavior,
    CallbackResponseCommand,
    DownstreamCommandType,
    ReloadCommand,
    SignalCommand,
)
from agent.transports.agentobox.upstream import TaskUpdateMessage, UpstreamMessageType
from agent.transports.agentobox.upstream import ExecutionEventMessage


def test_parse_reload_command():
    command = parse_downstream_command({"type": "reload", "path": "_abox/inbox.jsonl"})

    assert command == ReloadCommand(path="_abox/inbox.jsonl")
    assert encode_downstream_command(command) == {"type": "reload", "path": "_abox/inbox.jsonl"}


def test_parse_signal_command_uses_semantic_action_names():
    command = parse_downstream_command({"type": "signal", "action": "interrupt"})

    assert command == SignalCommand(action=RelayAction.INTERRUPT)
    assert encode_downstream_command(command) == {"type": "signal", "action": "interrupt"}


def test_parse_callback_response_command():
    command = parse_downstream_command(
        {
            "type": "callback_response",
            "request_id": "req-123",
            "behavior": "allow",
            "message": "Approved",
        }
    )

    assert command == CallbackResponseCommand(
        request_id="req-123",
        behavior=CallbackBehavior.ALLOW,
        message="Approved",
    )
    assert command.type is DownstreamCommandType.CALLBACK_RESPONSE


def test_parse_downstream_command_rejects_unknown_shapes():
    try:
        parse_downstream_command({"type": "input", "payload": {}})
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "unsupported downstream command type" in str(exc)


def test_encode_upstream_task_update_message():
    message = TaskUpdateMessage(
        task_id="task-1",
        state="completed",
        input_text="hi",
        output_text="hello",
    )

    assert message.type is UpstreamMessageType.TASK_UPDATE
    assert encode_upstream_message(message) == {
        "type": "task_update",
        "task_id": "task-1",
        "state": "completed",
        "input_text": "hi",
        "output_text": "hello",
    }


def test_encode_upstream_execution_event_message():
    message = ExecutionEventMessage(
        task_id="task-1",
        event_type="raw_message",
        payload={"type": "assistant"},
        session_id="sess-1",
    )

    assert encode_upstream_message(message) == {
        "type": "execution_event",
        "task_id": "task-1",
        "event_type": "raw_message",
        "payload": {"type": "assistant"},
        "session_id": "sess-1",
    }
