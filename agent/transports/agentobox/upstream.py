"""Canonical Agentobox managed transport messages sent from agent to backend."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class UpstreamMessageType(StrEnum):
    TASK_UPDATE = "task_update"


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


UpstreamMessage = TaskUpdateMessage
