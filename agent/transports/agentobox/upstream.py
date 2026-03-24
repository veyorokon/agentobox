"""Canonical Agentobox managed transport messages sent from agent to backend."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.status import STATUS_SCHEMA_VERSION


UPSTREAM_PROTOCOL_VERSION = "1"


class UpstreamMessageType(StrEnum):
    RUNTIME_HELLO = "runtime_hello"
    RUNTIME_STATUS = "runtime_status"
    TASK_UPDATE = "task_update"
    EXECUTION_EVENT = "execution_event"
    CALLBACK_REQUEST = "callback_request"
    TERMINAL_EVENT = "terminal_event"


@dataclass(frozen=True)
class RuntimeHelloMessage:
    agent_id: str
    mode: AgentMode
    platform: PlatformKind
    profile: RuntimeProfile
    protocol_version: str = UPSTREAM_PROTOCOL_VERSION
    status_schema_version: str = STATUS_SCHEMA_VERSION
    type: UpstreamMessageType = UpstreamMessageType.RUNTIME_HELLO

    def to_dict(self) -> dict[str, str]:
        return {
            "type": self.type.value,
            "protocol_version": self.protocol_version,
            "status_schema_version": self.status_schema_version,
            "agent_id": self.agent_id,
            "mode": self.mode.value,
            "platform": self.platform.value,
            "profile": self.profile.value,
        }


@dataclass(frozen=True)
class TaskUpdateMessage:
    task_id: str
    state: str
    input_text: str
    output_text: str = ""
    error: str = ""
    type: UpstreamMessageType = UpstreamMessageType.TASK_UPDATE

    def to_dict(self) -> dict[str, str]:
        payload = {
            "type": self.type.value,
            "task_id": self.task_id,
            "state": self.state,
            "input_text": self.input_text,
        }
        if self.output_text:
            payload["output_text"] = self.output_text
        if self.error:
            payload["error"] = self.error
        return payload


@dataclass(frozen=True)
class RuntimeStatusMessage:
    payload: dict[str, Any]
    type: UpstreamMessageType = UpstreamMessageType.RUNTIME_STATUS

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "payload": self.payload,
        }


@dataclass(frozen=True)
class ExecutionEventMessage:
    task_id: str
    event_type: str
    payload: dict[str, Any]
    session_id: str = ""
    type: UpstreamMessageType = UpstreamMessageType.EXECUTION_EVENT

    def to_dict(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "type": self.type.value,
            "task_id": self.task_id,
            "event_type": self.event_type,
            "payload": self.payload,
        }
        if self.session_id:
            wire["session_id"] = self.session_id
        return wire


@dataclass(frozen=True)
class CallbackRequestMessage:
    request_id: str
    callback_type: str
    payload: dict[str, Any]
    type: UpstreamMessageType = UpstreamMessageType.CALLBACK_REQUEST

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "request_id": self.request_id,
            "callback_type": self.callback_type,
            "payload": self.payload,
        }


@dataclass(frozen=True)
class TerminalEventMessage:
    terminal_id: str
    event_type: str
    payload: dict[str, Any]
    type: UpstreamMessageType = UpstreamMessageType.TERMINAL_EVENT

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "terminal_id": self.terminal_id,
            "event_type": self.event_type,
            "payload": self.payload,
        }


UpstreamMessage = (
    RuntimeHelloMessage
    | RuntimeStatusMessage
    | TaskUpdateMessage
    | ExecutionEventMessage
    | CallbackRequestMessage
    | TerminalEventMessage
)
