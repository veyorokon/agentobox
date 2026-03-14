from __future__ import annotations

from agent.contracts.platform import ExecResult, PlatformKind
from agent.platform.base import BasePlatformAdapter


class DockerPlatformAdapter(BasePlatformAdapter):
    kind = PlatformKind.DOCKER

    def create(self) -> None:
        return None

    def exec(self, cmd: list[str]) -> ExecResult:
        raise NotImplementedError("Docker platform adapter is not implemented yet.")

    def terminate(self) -> None:
        return None

