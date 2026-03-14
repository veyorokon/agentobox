import json
import time

from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.managed_session import ManagedRelaySession
from agent.runtime.runner import TaskRunner
from agent.runtime.state import RuntimeStateStore
from agent.transports.agentobox.commands import (
    CallbackBehavior,
    CallbackResponseCommand,
    RelayAction,
    ReloadCommand,
    SignalCommand,
)


def _build_runner():
    from agent.contracts.mode import AgentMode
    from agent.contracts.platform import PlatformKind

    state = RuntimeStateStore(mode=AgentMode.MANAGED, platform=PlatformKind.LOCAL)
    return TaskRunner(state)


def test_managed_session_reloads_task_inbox(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps({"type": "task", "task_id": "task-1", "input_text": "hello managed"})
    )
    runner = _build_runner()
    session = ManagedRelaySession(tmp_path, runner)

    session.on_command(ReloadCommand(path=CANONICAL_PATHS["task_inbox"]))

    task = runner.get("task-1")
    assert task is not None
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


def test_managed_session_clear_action_clears_pending_tasks(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        "\n".join(
            [
                json.dumps({"type": "task", "task_id": "task-1", "input_text": "one"}),
                json.dumps({"type": "task", "task_id": "task-2", "input_text": "two"}),
            ]
        )
    )
    runner = _build_runner()
    session = ManagedRelaySession(tmp_path, runner)

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
    session = ManagedRelaySession(tmp_path, _build_runner())
    response = CallbackResponseCommand(
        request_id="req-1",
        behavior=CallbackBehavior.ALLOW,
        message="approved",
    )

    session.on_command(response)

    assert session.callback_response("req-1") == response


def test_managed_session_publishes_completed_task_updates(tmp_path):
    inbox_path = tmp_path / CANONICAL_PATHS["task_inbox"]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        json.dumps({"type": "task", "task_id": "task-1", "input_text": "done"})
    )
    runner = _build_runner()
    runner.start()
    session = ManagedRelaySession(tmp_path, runner)

    try:
        session.on_command(ReloadCommand(path=CANONICAL_PATHS["task_inbox"]))
        deadline_messages = []
        for _ in range(20):
            deadline_messages = [message.to_dict() for message in session.drain_outbound_messages()]
            if any(message["state"] == "completed" for message in deadline_messages):
                break
            time.sleep(0.05)
        else:
            assert False, "expected completed task update"

        assert deadline_messages[-1] == {
            "type": "task_update",
            "task_id": "task-1",
            "state": "completed",
            "input_text": "done",
            "output_text": "done",
        }
    finally:
        runner.stop()
