import json
import os
import threading
import time

from agent.contracts.execution import ExecutorKind
from agent.contracts.input import TaskInput
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.config import ManagedConfig, RuntimeConfig
from agent.runtime.execution import ExecutionEvent, ExecutionEventType
from agent.runtime.inbox import load_inbox_cursor
from agent.runtime.managed_session import ManagedRelaySession
from agent.runtime.runner import TaskRunner
from agent.runtime.state import RuntimeStateStore
from agent.contracts.theme import THEME_SCHEMA_VERSION
from agent.transports.agentobox.commands import (
    CallbackBehavior,
    CallbackResponseCommand,
    RelayAction,
    ReloadCommand,
    SignalCommand,
)


def _build_runner():
    state = RuntimeStateStore(mode=AgentMode.MANAGED, platform=PlatformKind.LOCAL)
    return TaskRunner(state)


def _managed_runtime_config(tmp_path):
    return RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )


def test_managed_session_reloads_task_inbox(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps(
            {
                "type": "task",
                "task_id": "task-1",
                "input": {"role": "user", "content": [{"type": "text", "text": "hello managed"}]},
            }
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_command(ReloadCommand(path=CANONICAL_PATHS["task_inbox"]))

    task = runner.get("task-1")
    assert task is not None
    assert task.input == TaskInput.from_text("hello managed")
    assert task.input_text == "hello managed"
    assert task.state == "queued"
    assert [message.to_dict() for message in session.drain_outbound_messages()] == [
        {
            "type": "task_update",
            "task_id": "task-1",
            "state": "queued",
            "input_text": "hello managed",
        }
    ]
    assert load_inbox_cursor(tmp_path / CANONICAL_PATHS["task_inbox_cursor"]).offset > 0


def test_managed_session_reconciles_inbox_on_connect(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps(
            {
                "type": "task",
                "task_id": "task-connect-1",
                "input": {"role": "user", "content": [{"type": "text", "text": "hello reconnect"}]},
            }
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_connected()

    task = runner.get("task-connect-1")
    assert task is not None
    messages = [message.to_dict() for message in session.drain_outbound_messages()]
    assert messages[0]["type"] == "runtime_hello"
    assert messages[1] == {
        "type": "task_update",
        "task_id": "task-connect-1",
        "state": "queued",
        "input_text": "hello reconnect",
    }


def test_managed_session_does_not_requeue_seen_inbox_entries_on_reconnect(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps(
            {
                "type": "task",
                "task_id": "task-once-1",
                "input": {"role": "user", "content": [{"type": "text", "text": "once"}]},
            }
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_connected()
    first_messages = [message.to_dict() for message in session.drain_outbound_messages()]
    assert [message["type"] for message in first_messages] == ["runtime_hello", "task_update"]

    session.on_connected()
    second_messages = [message.to_dict() for message in session.drain_outbound_messages()]
    assert len(second_messages) == 1
    assert second_messages[0]["type"] == "runtime_hello"
    assert second_messages[0]["agent_id"] == "agent-123"
    assert second_messages[0]["mode"] == "managed"
    assert second_messages[0]["platform"] == "local"
    assert second_messages[0]["profile"] == "core"


def test_managed_session_reconciles_inbox_on_transport_poll_without_reload(tmp_path):
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_connected()
    session.drain_outbound_messages()

    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps(
            {
                "type": "task",
                "task_id": "task-poll-1",
                "input": {"role": "user", "content": [{"type": "text", "text": "poll path"}]},
            }
        )
    )

    session.on_transport_poll()

    task = runner.get("task-poll-1")
    assert task is not None
    assert [message.to_dict() for message in session.drain_outbound_messages()] == [
        {
            "type": "task_update",
            "task_id": "task-poll-1",
            "state": "queued",
            "input_text": "poll path",
        }
    ]


def test_managed_session_reloads_theme_tokens(tmp_path):
    theme_path = tmp_path / CANONICAL_PATHS["theme_tokens"]
    theme_path.parent.mkdir(parents=True, exist_ok=True)
    theme_path.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "name": "Night Shift",
                "tokens": {
                    "surface": "#101010",
                    "accent": "#ffaa00",
                },
            }
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_command(ReloadCommand(path=CANONICAL_PATHS["theme_tokens"]))

    theme_json = json.loads((tmp_path / CANONICAL_PATHS["theme_json"]).read_text())
    theme_css = (tmp_path / CANONICAL_PATHS["theme_css"]).read_text()
    awesome_lua = (tmp_path / CANONICAL_PATHS["theme_awesome_lua"]).read_text()
    browser_home = (tmp_path / CANONICAL_PATHS["browser_home_html"]).read_text()
    assert theme_json["name"] == "Night Shift"
    assert theme_json["tokens"]["surface"] == "#101010"
    assert "--abox-accent: #ffaa00;" in theme_css
    assert '["accent"] = "#ffaa00"' in awesome_lua
    assert "Night Shift" in browser_home
    assert "/theme.json?ts=" in browser_home
    assert session.drain_outbound_messages() == []


def test_managed_session_reloads_runtime_state_without_degrading_transport(tmp_path, monkeypatch):
    state_path = tmp_path / CANONICAL_PATHS["runtime_state"]
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "model": "claude-haiku-4-5",
                "mode": "auto",
                "allowed_tools": ["Read"],
            }
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    class ReplacementExecutor:
        pass

    replacement = ReplacementExecutor()
    monkeypatch.setattr("agent.runtime.managed_session.build_executor", lambda _config: replacement)

    session.on_command(ReloadCommand(path=CANONICAL_PATHS["runtime_state"]))

    assert runner._executor is replacement
    assert os.environ["CLAUDE_MODEL"] == "claude-haiku-4-5"
    assert os.environ["AGENT_MODE"] == "auto"
    assert os.environ["ALLOWED_TOOLS"] == '["Read"]'
    assert session.drain_outbound_messages() == []


def test_managed_session_clear_action_clears_pending_tasks(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "type": "task",
                        "task_id": "task-1",
                        "input": {"role": "user", "content": [{"type": "text", "text": "one"}]},
                    }
                ),
                json.dumps(
                    {
                        "type": "task",
                        "task_id": "task-2",
                        "input": {"role": "user", "content": [{"type": "text", "text": "two"}]},
                    }
                ),
            ]
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_command(ReloadCommand(path=CANONICAL_PATHS["task_inbox"]))
    session.on_command(SignalCommand(action=RelayAction.CLEAR))

    assert runner.get("task-1").state == "cleared"
    assert runner.get("task-2").state == "cleared"
    messages = [message.to_dict() for message in session.drain_outbound_messages()]
    assert messages[-2:] == [
        {
            "type": "task_update",
            "task_id": "task-1",
            "state": "cleared",
            "input_text": "one",
        },
        {
            "type": "task_update",
            "task_id": "task-2",
            "state": "cleared",
            "input_text": "two",
        },
    ]


def test_managed_session_tracks_callback_responses(tmp_path):
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)
    response = CallbackResponseCommand(
        request_id="req-1",
        behavior=CallbackBehavior.ALLOW,
        message="approved",
    )

    session.on_command(response)

    assert session.callback_response("req-1") == response


def test_managed_session_requests_callback_and_waits_for_response(tmp_path):
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)
    result_holder = {}

    def _request():
        result_holder["result"] = session.request_callback(
            "can_use_tool",
            {"tool_name": "Read", "tool_input": {"path": "/tmp/demo.txt"}},
            timeout_s=1.0,
        )

    thread = threading.Thread(target=_request)
    thread.start()
    time.sleep(0.05)
    outbound = [message.to_dict() for message in session.drain_outbound_messages()]
    assert outbound[0]["type"] == "callback_request"
    request_id = outbound[0]["request_id"]
    session.on_command(
        CallbackResponseCommand(
            request_id=request_id,
            behavior=CallbackBehavior.ALLOW,
            message="approved",
        )
    )
    thread.join(timeout=1.0)

    assert result_holder["result"] == {"behavior": "allow", "message": "approved"}


def test_managed_session_publishes_execution_events(tmp_path):
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_execution_event(
        "task-1",
        ExecutionEvent(
            type=ExecutionEventType.RAW_MESSAGE,
            payload={"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
            session_id="sess-1",
        ),
    )

    assert [message.to_dict() for message in session.drain_outbound_messages()] == [
        {
            "type": "execution_event",
            "task_id": "task-1",
            "event_type": "raw_message",
            "payload": {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
            "session_id": "sess-1",
        }
    ]
    assert runner._state.snapshot().runtime.session_id == "sess-1"


def test_managed_session_publishes_runtime_status(tmp_path):
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)
    payload = {
        "status_version": "2",
        "startup_stage": "managed_ready",
        "runtime_state": "ready",
        "profile": "desktop",
    }

    session.publish_runtime_status(payload)

    assert [message.to_dict() for message in session.drain_outbound_messages()] == [
        {
            "type": "runtime_status",
            "payload": payload,
        }
    ]


def test_managed_session_publishes_result_execution_events(tmp_path):
    runner = _build_runner()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    session.on_execution_event(
        "task-2",
        ExecutionEvent(
            type=ExecutionEventType.RESULT,
            payload={"output_text": "done", "subtype": "success"},
            session_id="sess-2",
        ),
    )

    assert [message.to_dict() for message in session.drain_outbound_messages()] == [
        {
            "type": "execution_event",
            "task_id": "task-2",
            "event_type": "result",
            "payload": {"output_text": "done", "subtype": "success"},
            "session_id": "sess-2",
        }
    ]
    assert runner._state.snapshot().runtime.session_id == "sess-2"


def test_managed_session_publishes_completed_task_updates(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps(
            {
                "type": "task",
                "task_id": "task-1",
                "input": {"role": "user", "content": [{"type": "text", "text": "done"}]},
            }
        )
    )
    runner = _build_runner()
    runner.start()
    session = ManagedRelaySession(_managed_runtime_config(tmp_path), runner, runner._state)

    try:
        session.on_command(ReloadCommand(path=CANONICAL_PATHS["task_inbox"]))
        for _ in range(20):
            record = runner.get("task-1")
            if record is not None and record.state == "completed":
                break
            time.sleep(0.05)
        else:
            assert False, "expected task completion"

        deadline_messages = [message.to_dict() for message in session.drain_outbound_messages()]

        assert deadline_messages[-1] == {
            "type": "task_update",
            "task_id": "task-1",
            "state": "completed",
            "input_text": "done",
            "output_text": "done",
        }
    finally:
        runner.stop()
