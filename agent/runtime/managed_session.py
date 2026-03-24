"""Runtime-owned Agentobox relay session.

The websocket client owns connectivity; this session owns how managed runtime
state reacts to canonical downstream commands. It is intentionally narrow so
legacy relay behavior gets split into explicit runtime concerns instead of
reforming into a single transport monolith.
"""

from __future__ import annotations

import os
import threading
import uuid
from pathlib import Path

from agent.contracts.events import RuntimeEvent
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.config import RuntimeConfig
from agent.runtime.envfiles import apply_env_overrides, load_runtime_state_env
from agent.runtime.execution import (
    ExecutionCallbackHandler,
    ExecutionEvent,
    ExecutionEventType,
    ExecutionObserver,
)
from agent.runtime.executors.factory import build_executor
from agent.runtime.inbox import (
    inbox_cursor_path,
    load_new_inbox_entries,
    store_inbox_cursor,
)
from agent.runtime.logging import emit_event
from agent.runtime.mailbox import DrainingMailbox
from agent.runtime.pty_manager import PtySessionManager
from agent.runtime.runner import TaskObserver, TaskRecord, TaskRunner
from agent.runtime.state import RuntimeStateStore
from agent.runtime.theme import ThemeManager, build_theme_manager
from agent.transports.agentobox.commands import (
    CallbackResponseCommand,
    DownstreamCommand,
    RelayAction,
    ReloadCommand,
    SignalCommand,
    TerminalAction,
    TerminalCommand,
)
from agent.transports.agentobox.session import RelaySession
from agent.transports.agentobox.upstream import (
    CallbackRequestMessage,
    ExecutionEventMessage,
    RuntimeHelloMessage,
    RuntimeStatusMessage,
    TaskUpdateMessage,
    TerminalEventMessage,
    UpstreamMessage,
)


class ManagedRelaySession(RelaySession, TaskObserver, ExecutionObserver, ExecutionCallbackHandler):
    """Applies managed transport commands to runtime-owned state and files."""

    def __init__(
        self,
        config: RuntimeConfig,
        runner: TaskRunner,
        state: RuntimeStateStore,
        theme_manager: ThemeManager | None = None,
        pty_manager: PtySessionManager | None = None,
    ):
        self._config = config
        self._root_dir = config.root_dir
        self._runner = runner
        self._state = state
        self._theme_manager = theme_manager or build_theme_manager(
            config.root_dir,
            config.platform,
            config.profile,
        )
        self._runner.add_observer(self)
        self._runner.add_execution_observer(self)
        self._inbox_cursor_path = inbox_cursor_path(config.root_dir)
        self._inbox_lock = threading.Lock()
        self._last_inbox_signature: tuple[int, int] | None = None
        self._callback_responses: dict[str, CallbackResponseCommand] = {}
        self._outbound_messages = DrainingMailbox[UpstreamMessage]()
        self._callback_condition = threading.Condition()
        shell_cwd = Path(os.environ.get("HOME", str(config.root_dir))).resolve()
        if not shell_cwd.exists():
            shell_cwd = config.root_dir
        self._pty_manager = pty_manager or PtySessionManager(shell_cwd, self._publish_terminal_event)

    def on_connected(self) -> None:
        assert self._config.managed is not None
        self._outbound_messages.publish(
            RuntimeHelloMessage(
                agent_id=self._config.managed.agent_id,
                mode=self._config.mode,
                platform=self._config.platform,
                profile=self._config.profile,
            )
        )
        self._reconcile_inbox(reason="connected")
        emit_event(RuntimeEvent.TRANSPORT_CONNECTED.value, source="managed_session")

    def on_command(self, command: DownstreamCommand) -> None:
        emit_event(
            RuntimeEvent.TRANSPORT_COMMAND_RECEIVED.value,
            source="managed_session",
            command_type=command.type.value,
        )
        if isinstance(command, ReloadCommand):
            self._apply_reload(command)
            return
        if isinstance(command, SignalCommand):
            self._apply_signal(command)
            return
        if isinstance(command, CallbackResponseCommand):
            self._apply_callback_response(command)
            return
        if isinstance(command, TerminalCommand):
            self._apply_terminal(command)
            return
        raise TypeError(f"unsupported managed command: {type(command)!r}")

    def on_disconnected(self) -> None:
        emit_event(RuntimeEvent.TRANSPORT_DEGRADED.value, source="managed_session", reason="disconnected")

    def on_transport_poll(self) -> None:
        inbox_path = self._root_dir / CANONICAL_PATHS["task_inbox"]
        if not inbox_path.exists():
            self._last_inbox_signature = None
            return
        stat = inbox_path.stat()
        signature = (stat.st_mtime_ns, stat.st_size)
        if signature == self._last_inbox_signature:
            return
        self._reconcile_inbox(reason="poll")

    def callback_response(self, request_id: str) -> CallbackResponseCommand | None:
        with self._callback_condition:
            return self._callback_responses.get(request_id)

    def request_callback(self, callback_type: str, payload: dict, *, timeout_s: float = 300.0) -> dict:
        request_id = uuid.uuid4().hex
        with self._callback_condition:
            self._outbound_messages.publish(
                CallbackRequestMessage(
                    request_id=request_id,
                    callback_type=callback_type,
                    payload=payload,
                )
            )
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                update="callback_requested",
                request_id=request_id,
                callback_type=callback_type,
            )
            notified = self._callback_condition.wait_for(
                lambda: request_id in self._callback_responses,
                timeout=timeout_s,
            )
            if not notified:
                return {"behavior": "deny", "message": "Timed out waiting for callback response"}
            response = self._callback_responses.pop(request_id)
        return {
            "behavior": response.behavior.value,
            "message": response.message,
        }

    def drain_outbound_messages(self) -> list[UpstreamMessage]:
        return self._outbound_messages.drain()

    def publish_runtime_status(self, payload: dict) -> None:
        self._outbound_messages.publish(RuntimeStatusMessage(payload=payload))

    def on_task_queued(self, record: TaskRecord) -> None:
        self._publish_task_update(record)

    def on_task_running(self, record: TaskRecord) -> None:
        self._publish_task_update(record)

    def on_task_completed(self, record: TaskRecord) -> None:
        self._publish_task_update(record)

    def on_task_failed(self, record: TaskRecord) -> None:
        self._publish_task_update(record)

    def on_task_cleared(self, record: TaskRecord) -> None:
        self._publish_task_update(record)

    def on_execution_event(self, task_id: str, event: ExecutionEvent) -> None:
        if event.session_id:
            self._state.set_session(event.session_id)
            self._runner.set_executor(build_executor(self._config, resume_session_id=event.session_id))
        if event.type in {
            ExecutionEventType.RAW_MESSAGE,
            ExecutionEventType.RESULT,
            ExecutionEventType.PROCESS_EXIT,
            ExecutionEventType.CALLBACK_REQUEST,
        }:
            self._outbound_messages.publish(
                ExecutionEventMessage(
                    task_id=task_id,
                    event_type=event.type.value,
                    payload=event.payload,
                    session_id=event.session_id,
                )
            )

    def _apply_reload(self, command: ReloadCommand) -> None:
        if command.path == CANONICAL_PATHS["task_inbox"]:
            self._reconcile_inbox(reason="reload")
            return
        if command.path == CANONICAL_PATHS["theme_tokens"]:
            document = self._theme_manager.reload_from_tokens_path(command.path)
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                update="theme_applied",
                token_count=len(document.tokens),
                theme_name=document.name,
            )
            return
        if command.path == CANONICAL_PATHS["runtime_state"]:
            state_env = load_runtime_state_env(self._root_dir)
            apply_env_overrides(state_env, override=True)
            current_session_id = self._state.snapshot().runtime.session_id
            self._runner.set_executor(build_executor(self._config, resume_session_id=current_session_id))
            emit_event(
                RuntimeEvent.RUNTIME_UPDATED.value,
                source="managed_session",
                update="state_reloaded",
                reloaded_keys=sorted(state_env.keys()),
            )
            return
        raise ValueError(f"unsupported reload path: {command.path}")

    def _apply_callback_response(self, command: CallbackResponseCommand) -> None:
        with self._callback_condition:
            self._callback_responses[command.request_id] = command
            self._callback_condition.notify_all()
        emit_event(
            RuntimeEvent.RUNTIME_UPDATED.value,
            source="managed_session",
            response_request_id=command.request_id,
            behavior=command.behavior.value,
        )

    def _publish_task_update(self, record: TaskRecord) -> None:
        self._outbound_messages.publish(
            TaskUpdateMessage(
                task_id=record.id,
                state=record.state,
                input_text=record.input_text,
                output_text=record.output_text,
                error=record.error,
            )
        )

    def _publish_terminal_event(self, terminal_id: str, event_type: str, payload: dict) -> None:
        self._outbound_messages.publish(
            TerminalEventMessage(
                terminal_id=terminal_id,
                event_type=event_type,
                payload=payload,
            )
        )

    def _apply_terminal(self, command: TerminalCommand) -> None:
        if command.action is TerminalAction.OPEN:
            self._pty_manager.open(command.terminal_id, cols=command.cols or 120, rows=command.rows or 34)
            return
        if command.action is TerminalAction.INPUT:
            self._pty_manager.input(command.terminal_id, command.data)
            return
        if command.action is TerminalAction.RESIZE:
            self._pty_manager.resize(
                command.terminal_id,
                cols=command.cols or 120,
                rows=command.rows or 34,
            )
            return
        if command.action is TerminalAction.CLOSE:
            self._pty_manager.close(command.terminal_id)
            return
        raise ValueError(f"unsupported terminal action: {command.action.value}")

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

    def _reconcile_inbox(self, *, reason: str) -> None:
        inbox_path = self._root_dir / CANONICAL_PATHS["task_inbox"]
        with self._inbox_lock:
            entries, cursor = load_new_inbox_entries(inbox_path, self._inbox_cursor_path)
            if not entries:
                self._last_inbox_signature = self._inbox_signature(inbox_path)
                return
            for entry in entries:
                self._runner.submit_request(entry.to_task_request())
                emit_event(
                    RuntimeEvent.RUNTIME_UPDATED.value,
                    source="managed_session",
                    task_id=entry.task_id,
                    update="task_submitted",
                    reason=reason,
                )
            store_inbox_cursor(self._inbox_cursor_path, cursor)
            self._last_inbox_signature = self._inbox_signature(inbox_path)

    def _inbox_signature(self, inbox_path: Path) -> tuple[int, int] | None:
        if not inbox_path.exists():
            return None
        stat = inbox_path.stat()
        return (stat.st_mtime_ns, stat.st_size)
