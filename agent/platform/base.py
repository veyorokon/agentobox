from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.platform import ExecResult, PlatformAdapter, PlatformKind
from agent.runtime.service_catalog import service_graph_for_platform
from agent.runtime.services import ServiceGraph


class BasePlatformAdapter(PlatformAdapter):
    kind: PlatformKind

    def create(self) -> None:
        raise NotImplementedError

    def exec(self, cmd: list[str]) -> ExecResult:
        raise NotImplementedError

    def terminate(self) -> None:
        raise NotImplementedError

    def service_graph(self, mode: AgentMode) -> ServiceGraph:
        return service_graph_for_platform(self.kind, mode)
