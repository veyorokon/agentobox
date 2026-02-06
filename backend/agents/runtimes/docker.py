from agents.runtimes.base import Runtime, SandboxInstance


class DockerRuntime:
    """Local Docker runtime. Implements Runtime protocol."""

    async def create(self, name: str, env: dict[str, str]) -> SandboxInstance:
        ...

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "computeruse"
    ) -> str:
        ...

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None:
        ...

    async def terminate(self, sandbox_id: str) -> None:
        ...

    async def list_sandboxes(self) -> list[SandboxInstance]:
        ...

    async def get_status(self, sandbox_id: str) -> str:
        ...
