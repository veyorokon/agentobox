from __future__ import annotations

import subprocess

from agent.contracts.platform import ExecResult, PlatformKind
from agent.platform.base import BasePlatformAdapter


class LocalPlatformAdapter(BasePlatformAdapter):
    kind = PlatformKind.LOCAL

    def create(self) -> None:
        return None

    def exec(self, cmd: list[str]) -> ExecResult:
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

    def terminate(self) -> None:
        return None
