from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class TransportState(StrEnum):
    DISABLED = "disabled"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DEGRADED = "degraded"
    FATAL = "fatal"


@dataclass(frozen=True)
class TransportSnapshot:
    enabled: bool
    state: TransportState
    connected: bool
    last_error: str = ""


class ManagedTransport(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def snapshot(self) -> TransportSnapshot: ...

