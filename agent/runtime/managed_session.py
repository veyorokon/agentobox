"""Runtime-owned Agentobox relay session.

The websocket client owns connectivity; this session owns how managed runtime
state reacts to canonical downstream commands. It is intentionally narrow so
legacy relay behavior gets split into explicit runtime concerns instead of
reforming into a single transport monolith.
"""

from __future__ import annotations

from pathlib import Path

from agent.contracts.events import RuntimeEvent
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.inbox import load_inbox_entries
from agent.runtime.logging import emit_event
from agent.runtime.runner import TaskObserver, TaskRecord, TaskRunner
from agent.transports.agentobox.commands import (
    CallbackResponseCommand,
    DownstreamCommand,
    RelayAction,
    ReloadCommand,
    SignalCommand,
)
from agent.transports.agentobox.session import RelaySession
from agent.transports.agentobox.upstream import TaskUpdateMessage, UpstreamMessage


class ManagedRelaySession(RelaySession, TaskObserver):
    """Applies managed transport commands to runtime-owned state and files."""

    def __init__(self, root_dir: Path, runner: TaskRunner):
        self._root_dir = root_dir
        self._runner = runner
        self._runner.add_observer(self)
        self._seen_task_ids: set[str] = set()
        self._callback_responses: dict[str, CallbackResponseCommand] = {}
        self._outbound_messages: list[UpstreamMessage] = []

    def on_connected(self) -> None:
        emit_event(RuntimeEvent.TRANSPORT_CONNECTED.value, source="managed_session")

    def on_command(self, command: DownstreamCommand) -> None:
        if isinstance(command, ReloadCommand):
            self._apply_reload(command)
            return
        if isinstance(command, SignalCommand):
            self._apply_signal(command)
            return
        if isinstance(command, CallbackResponseCommand):
            self._callback_responses[command.request_id] = command
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                response_request_id=command.request_id,
                behavior=command.behavior.value,
            )
            return
        raise TypeError(f"unsupported managed command: {type(command)!r}")

    def on_disconnected(self) -> None:
        emit_event(RuntimeEvent.TRANSPORT_DEGRADED.value, source="managed_session", reason="disconnected")

    def callback_response(self, request_id: str) -> CallbackResponseCommand | None:
        return self._callback_responses.get(request_id)

    def drain_outbound_messages(self) -> list[UpstreamMessage]:
        messages = list(self._outbound_messages)
        self._outbound_messages.clear()
        return messages

    def on_task_queued(self, record: TaskRecord) -> None:
        self._outbound_messages.append(
            TaskUpdateMessage(
                task_id=record.id,
                state=record.state,
                input_text=record.input_text,
            )
        )

    def on_task_completed(self, record: TaskRecord) -> None:
        self._outbound_messages.append(
            TaskUpdateMessage(
                task_id=record.id,
                state=record.state,
                input_text=record.input_text,
                output_text=record.output_text,
            )
        )

    def on_task_failed(self, record: TaskRecord) -> None:
        self._outbound_messages.append(
            TaskUpdateMessage(
                task_id=record.id,
                state=record.state,
                input_text=record.input_text,
                error=record.error,
            )
        )

    def on_task_cleared(self, record: TaskRecord) -> None:
        self._outbound_messages.append(
            TaskUpdateMessage(
                task_id=record.id,
                state=record.state,
                input_text=record.input_text,
            )
        )

    def _apply_reload(self, command: ReloadCommand) -> None:
        if command.path != CANONICAL_PATHS["task_inbox"]:
            raise ValueError(f"unsupported reload path: {command.path}")
        inbox_path = self._root_dir / command.path
        for entry in load_inbox_entries(inbox_path):
            if entry.task_id in self._seen_task_ids:
                continue
            self._seen_task_ids.add(entry.task_id)
            self._runner.submit_request(entry.to_task_request())
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                task_id=entry.task_id,
                update="task_submitted",
            )

    def _apply_signal(self, command: SignalCommand) -> None:
        if command.action is RelayAction.CLEAR:
            cleared = self._runner.clear_pending()
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                action=command.action.value,
                cleared=len(cleared),
            )
            return
        if command.action is RelayAction.INTERRUPT:
            interrupted = self._runner.interrupt()
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                action=command.action.value,
                interrupted=interrupted,
            )
            return
        if command.action is RelayAction.RESTART:
            cleared = self._runner.clear_pending()
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                action=command.action.value,
                cleared=len(cleared),
            )
            return
        raise ValueError(f"unsupported relay action: {command.action.value}")
