from __future__ import annotations

import subprocess

from agent.contracts.mode import AgentMode
from agent.contracts.platform import ExecResult, PlatformAdapter, PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.runtime.service_catalog import service_graph_for_platform
from agent.runtime.services import ServiceGraph


class BasePlatformAdapter(PlatformAdapter):
    """Common platform behavior shared by in-process runtime adapters.

    Docker and Modal differ in how the agent process is *launched*. Once the
    runtime is already inside that environment, local subprocess execution is
    the same basic primitive: spawn a process, capture stdout/stderr, and
    report the exit code. Platform-specific lifecycle behavior can build on
    this without redefining the contract.
    """

    kind: PlatformKind

    def create(self) -> None:
        raise NotImplementedError

    def exec(self, cmd: list[str]) -> ExecResult:
        raise NotImplementedError

    def terminate(self) -> None:
        raise NotImplementedError

    def service_graph(self, mode: AgentMode, profile: RuntimeProfile) -> ServiceGraph:
        return service_graph_for_platform(self.kind, mode, profile)

    def _run_local_command(self, cmd: list[str]) -> ExecResult:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
        return ExecResult(
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )
