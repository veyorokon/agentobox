"""Typed command builders for the backend → agent relay protocol.

Every command the backend sends to an agent relay MUST go through one of
these builders. Raw dicts at the relay boundary are an architectural
violation — they drift silently when the agent protocol changes.

The wire format mirrors agent/transports/agentobox/commands.py exactly.
If the agent protocol changes, update these types and the serializer.
Contract tests (test_relay.py) assert exact wire payloads.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CommandType(StrEnum):
    RELOAD = "reload"
    SIGNAL = "signal"
    CALLBACK_RESPONSE = "callback_response"
    TERMINAL = "terminal"


class SignalAction(StrEnum):
    INTERRUPT = "interrupt"
    RESTART = "restart"
    CLEAR = "clear"


class CallbackBehavior(StrEnum):
    ALLOW = "allow"
    DENY = "deny"


class TerminalAction(StrEnum):
    OPEN = "open"
    INPUT = "input"
    RESIZE = "resize"
    CLOSE = "close"


class TerminalProgram(StrEnum):
    SHELL = "shell"
    CLAUDE = "claude"


@dataclass(frozen=True)
class ReloadCommand:
    """Notify relay that a volume file changed and should be re-read."""

    path: str

    def to_wire(self) -> dict:
        return {"type": CommandType.RELOAD, "path": self.path}


@dataclass(frozen=True)
class SignalCommand:
    """Ephemeral control signal — no volume state, relay acts immediately."""

    action: SignalAction

    def to_wire(self) -> dict:
        return {"type": CommandType.SIGNAL, "action": self.action}


@dataclass(frozen=True)
class CallbackResponseCommand:
    """Response to an SDK callback (permission, plan, etc.).

    Contract is intentionally narrow: request_id + behavior + message.
    Do not add extra fields from legacy callback payloads — if new fields
    are needed, that is an explicit protocol extension.
    """

    request_id: str
    behavior: CallbackBehavior
    message: str = ""

    def to_wire(self) -> dict:
        d: dict = {
            "type": CommandType.CALLBACK_RESPONSE,
            "request_id": self.request_id,
            "behavior": self.behavior,
        }
        if self.message:
            d["message"] = self.message
        return d


@dataclass(frozen=True)
class TerminalCommand:
    terminal_id: str
    action: TerminalAction
    program: TerminalProgram | None = None
    data: str = ""
    cols: int = 0
    rows: int = 0

    def to_wire(self) -> dict:
        d: dict = {
            "type": CommandType.TERMINAL,
            "terminal_id": self.terminal_id,
            "action": self.action,
        }
        if self.program is not None:
            d["program"] = self.program
        if self.data:
            d["data"] = self.data
        if self.cols > 0:
            d["cols"] = self.cols
        if self.rows > 0:
            d["rows"] = self.rows
        return d


# Type union for push_to_relay signature
RelayCommand = ReloadCommand | SignalCommand | CallbackResponseCommand | TerminalCommand
