from __future__ import annotations

import queue
import threading
import uuid
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from agent.contracts.input import TaskInput
from agent.contracts.events import RuntimeEvent
from agent.contracts.lifecycle import RuntimeState
from agent.runtime.execution import ExecutionCallbackHandler, ExecutionObserver, StreamingTaskExecutor
from agent.runtime.logging import emit_event
from agent.runtime.state import RuntimeStateStore


@dataclass(frozen=True)
class TaskRequest:
    id: str
    input: TaskInput

    @property
    def input_text(self) -> str:
        return self.input.summary_text()


@dataclass
class TaskRecord:
    id: str
    input: TaskInput
    state: str = "queued"
    output_text: str = ""
    error: str = ""

    @property
    def input_text(self) -> str:
        return self.input.summary_text()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "input": self.input.to_dict(),
            "input_text": self.input_text,
            "state": self.state,
            "output_text": self.output_text,
            "error": self.error,
        }


class TaskExecutor(Protocol):
    def execute(self, request: TaskRequest) -> str: ...


@runtime_checkable
class InterruptibleTaskExecutor(TaskExecutor, Protocol):
    def interrupt(self) -> bool: ...


class TaskObserver(Protocol):
    """Observer for task lifecycle changes produced by the runtime."""

    def on_task_queued(self, record: TaskRecord) -> None: ...

    def on_task_running(self, record: TaskRecord) -> None: ...

    def on_task_completed(self, record: TaskRecord) -> None: ...

    def on_task_failed(self, record: TaskRecord) -> None: ...

    def on_task_cleared(self, record: TaskRecord) -> None: ...


class EchoExecutor:
    def execute(self, request: TaskRequest) -> str:
        return request.input_text


class TaskRunner:
    """Owns task queueing and execution for both local and managed ingress."""

    def __init__(self, state: RuntimeStateStore, executor: TaskExecutor | None = None):
        self._state = state
        self._executor = executor or EchoExecutor()
        self._callback_handler: ExecutionCallbackHandler | None = None
        self._queue: queue.Queue[TaskRequest] = queue.Queue()
        self._lock = threading.Lock()
        self._tasks: dict[str, TaskRecord] = {}
        self._task_order: list[str] = []
        self._observers: list[TaskObserver] = []
        self._execution_observers: list[ExecutionObserver] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="agent-task-runner", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._queue.put(TaskRequest(id="__stop__", input=TaskInput.from_text("")))
        if self._thread:
            self._thread.join(timeout=2)

    def submit(self, input_text: str) -> TaskRecord:
        return self.submit_request(TaskRequest(id=str(uuid.uuid4()), input=TaskInput.from_text(input_text)))

    def submit_request(self, request: TaskRequest) -> TaskRecord:
        """Queue a task with an explicit identifier.

        Managed mode uses backend-issued task IDs from the durable inbox.
        Standalone mode uses locally generated UUIDs via `submit()`.
        """

        with self._lock:
            if request.id in self._tasks:
                return self._tasks[request.id]
            record = TaskRecord(id=request.id, input=request.input)
            self._tasks[request.id] = record
            self._task_order.append(request.id)
        self._queue.put(request)
        self._notify("on_task_queued", record)
        return record

    def get(self, task_id: str) -> TaskRecord | None:
        with self._lock:
            return self._tasks.get(task_id)

    def add_observer(self, observer: TaskObserver) -> None:
        self._observers.append(observer)

    def add_execution_observer(self, observer: ExecutionObserver) -> None:
        self._execution_observers.append(observer)

    def set_callback_handler(self, handler: ExecutionCallbackHandler) -> None:
        with self._lock:
            self._callback_handler = handler
        setter = getattr(self._executor, "set_callback_handler", None)
        if callable(setter):
            setter(handler)

    def set_executor(self, executor: TaskExecutor) -> None:
        with self._lock:
            self._executor = executor
            callback_handler = getattr(self, "_callback_handler", None)
        if callback_handler is not None:
            setter = getattr(self._executor, "set_callback_handler", None)
            if callable(setter):
                setter(callback_handler)

    def clear_pending(self) -> list[str]:
        """Drop queued-but-not-running tasks and mark them as cleared."""

        retained: list[TaskRequest] = []
        cleared: list[str] = []
        with self._lock:
            while True:
                try:
                    request = self._queue.get_nowait()
                except queue.Empty:
                    break
                if request.id == "__stop__":
                    retained.append(request)
                    continue
                record = self._tasks.get(request.id)
                if record is None or record.state != "queued":
                    retained.append(request)
                    continue
                record.state = "cleared"
                cleared.append(request.id)
                self._notify("on_task_cleared", record)
            for request in retained:
                self._queue.put(request)
        if cleared and self._state.snapshot().runtime_state is not RuntimeState.BUSY:
            self._state.set_task(task_id="", task_state="idle", client_active=False)
        return cleared

    def interrupt(self) -> bool:
        """Request interruption from the executor when supported."""

        executor = self._executor
        if not isinstance(executor, InterruptibleTaskExecutor):
            return False
        return executor.interrupt()

    def _run(self) -> None:
        while not self._stop.is_set():
            request = self._queue.get()
            if request.id == "__stop__":
                return
            with self._lock:
                record = self._tasks[request.id]
                record.state = "running"
            self._state.update_runtime_state(RuntimeState.BUSY)
            self._state.set_task(task_id=request.id, task_state="running", client_active=True)
            self._notify("on_task_running", record)
            try:
                observer = _ExecutionObserverFanout(request.id, self._execution_observers)
                if isinstance(self._executor, StreamingTaskExecutor):
                    output_text = self._executor.execute_streaming(request, observer)
                else:
                    output_text = self._executor.execute(request)
                with self._lock:
                    record.output_text = output_text
                    record.state = "completed"
                self._notify("on_task_completed", record)
            except Exception as exc:  # intentional: task execution failure should be surfaced on the task record
                with self._lock:
                    record.state = "failed"
                    record.error = str(exc)
                emit_event(
                    RuntimeEvent.RUNTIME_UPDATED.value,
                    source="task_runner",
                    update="task_failed",
                    task_id=request.id,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
                self._notify("on_task_failed", record)
            finally:
                self._state.set_task(task_id=request.id, task_state=record.state, client_active=False)
                self._state.update_runtime_state(RuntimeState.READY)

    def _notify(self, method_name: str, record: TaskRecord) -> None:
        for observer in self._observers:
            getattr(observer, method_name)(record)


class _ExecutionObserverFanout:
    """Dispatch execution events to every registered runtime observer."""

    def __init__(self, task_id: str, observers: list[ExecutionObserver]):
        self._task_id = task_id
        self._observers = observers

    def on_execution_event(self, _task_id: str, event) -> None:
        for observer in self._observers:
            observer.on_execution_event(self._task_id, event)
