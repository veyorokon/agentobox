from dataclasses import dataclass
from typing import Protocol


@dataclass
class SandboxInstance:
    id: str
    vnc_url: str


class Runtime(Protocol):
    async def create(self, name: str, env: dict[str, str]) -> SandboxInstance: ...

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "computeruse"
    ) -> str: ...

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None: ...

    async def terminate(self, sandbox_id: str) -> None: ...

    async def list_sandboxes(self) -> list[SandboxInstance]: ...

    async def get_status(self, sandbox_id: str) -> str: ...
