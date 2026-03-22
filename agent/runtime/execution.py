"""Execution-layer contracts for runtime-owned task execution.

The transport tells the runtime *that* new work exists. Executors own *how*
that work is performed and what execution-time events are emitted. Keeping
this seam explicit prevents transport and execution concerns from collapsing
back into a single relay blob.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from agent.runtime.runner import TaskRequest


class ExecutionEventType(StrEnum):
    RAW_MESSAGE = "raw_message"
    RESULT = "result"
    CALLBACK_REQUEST = "callback_request"
    PROCESS_EXIT = "process_exit"


@dataclass(frozen=True)
class ExecutionEvent:
    type: ExecutionEventType
    payload: dict
    session_id: str = ""


class ExecutionObserver(Protocol):
    """Consumes execution-time events produced while a task runs."""

    def on_execution_event(self, task_id: str, event: ExecutionEvent) -> None: ...


class ExecutionCallbackHandler(Protocol):
    """Blocking callback bridge used by executors that need external approval."""

    def request_callback(self, callback_type: str, payload: dict, *, timeout_s: float = 300.0) -> dict: ...


@runtime_checkable
class StreamingTaskExecutor(Protocol):
    """Executor that can emit structured execution events while running."""

    def execute_streaming(self, request: "TaskRequest", observer: ExecutionObserver | None = None) -> str: ...
