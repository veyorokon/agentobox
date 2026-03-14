from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol

from agent.contracts.mode import AgentMode

if TYPE_CHECKING:
    from agent.runtime.services import ServiceGraph


class PlatformKind(StrEnum):
    DOCKER = "docker"
    MODAL = "modal"
    LOCAL = "local"


@dataclass(frozen=True)
class ExecResult:
    exit_code: int
    stdout: str = ""
    stderr: str = ""


class PlatformAdapter(Protocol):
    kind: PlatformKind

    def create(self) -> None: ...

    def exec(self, cmd: list[str]) -> ExecResult: ...

    def terminate(self) -> None: ...

    def service_graph(self, mode: AgentMode) -> "ServiceGraph": ...
