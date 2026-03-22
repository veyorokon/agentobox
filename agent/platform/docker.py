from __future__ import annotations

from agent.contracts.platform import ExecResult, PlatformKind
from agent.platform.base import BasePlatformAdapter


class DockerPlatformAdapter(BasePlatformAdapter):
    kind = PlatformKind.DOCKER

    def create(self) -> None:
        return None

    def exec(self, cmd: list[str]) -> ExecResult:
        return self._run_local_command(cmd)

    def terminate(self) -> None:
        return None
