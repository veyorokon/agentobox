"""Canonical Agentobox managed transport commands.

These are semantic control-plane requests from backend to agent. They are
kept separate from runtime events so the wire contract stays clear:

- commands ask the agent to do something
- events report facts about what happened
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class DownstreamCommandType(StrEnum):
    RELOAD = "reload"
    SIGNAL = "signal"
    CALLBACK_RESPONSE = "callback_response"


class RelayAction(StrEnum):
    INTERRUPT = "interrupt"
    RESTART = "restart"
    CLEAR = "clear"


class CallbackBehavior(StrEnum):
    ALLOW = "allow"
    DENY = "deny"


@dataclass(frozen=True)
class ReloadCommand:
    path: str
    type: DownstreamCommandType = DownstreamCommandType.RELOAD

    def to_dict(self) -> dict[str, str]:
        return {"type": self.type.value, "path": self.path}


@dataclass(frozen=True)
class SignalCommand:
    action: RelayAction
    type: DownstreamCommandType = DownstreamCommandType.SIGNAL

    def to_dict(self) -> dict[str, str]:
        return {"type": self.type.value, "action": self.action.value}


@dataclass(frozen=True)
class CallbackResponseCommand:
    request_id: str
    behavior: CallbackBehavior
    message: str = ""
    type: DownstreamCommandType = DownstreamCommandType.CALLBACK_RESPONSE

    def to_dict(self) -> dict[str, str]:
        payload = {
            "type": self.type.value,
            "request_id": self.request_id,
            "behavior": self.behavior.value,
        }
        if self.message:
            payload["message"] = self.message
        return payload


DownstreamCommand = ReloadCommand | SignalCommand | CallbackResponseCommand
