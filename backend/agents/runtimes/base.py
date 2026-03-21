"""
Runtime Protocol — the port in Ports and Adapters for container orchestration.

Defines the async interface that all runtimes (Docker, Modal) must implement:
create, exec, write_file, terminate, list_sandboxes, get_status, get_crash_info.
SandboxInstance and VolumeMount are the runtime-agnostic data types that cross
the boundary.

Services never import DockerRuntime or ModalRuntime directly — they call
get_runtime(name) from __init__.py and program against this Protocol. Adding
a new runtime (e.g. Fly.io) means implementing this interface and registering
it in __init__.py; no service code changes.
"""
from decimal import Decimal
from dataclasses import dataclass
from typing import Protocol

from agents.services.project_volume import ProjectVolumeStore


@dataclass
class SandboxInstance:
    id: str
    vnc_url: str
    health_url: str = ""


@dataclass
class VolumeMount:
    """Runtime-agnostic volume specification.

    - name: Logical volume identifier. On Modal, this becomes the volume label
      passed to modal.Volume.from_name(). On Docker, this maps to a host path
      via host_path or is used as a Docker named volume.
    - mount_path: Absolute path inside the container.
    - host_path: Host filesystem path for Docker bind mounts. Docker-only —
      ignored by Modal. When set, Docker bind-mounts this path instead of
      using a named volume.
    - read_only: Mount as read-only (default False).
    """
    name: str
    mount_path: str
    host_path: str = ""
    read_only: bool = False


@dataclass(frozen=True)
class RuntimeResources:
    cpu_cores: Decimal
    memory_mb: int


class Runtime(Protocol):
    async def create(
        self, name: str, env: dict[str, str],
        volumes: list[VolumeMount] | None = None,
    ) -> SandboxInstance: ...

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "agent"
    ) -> str: ...

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None: ...

    def machine_store(self) -> ProjectVolumeStore: ...

    def resource_snapshot(self) -> RuntimeResources: ...

    async def sync_machine_volume(
        self, sandbox_id: str, mount_path: str = "/vol"
    ) -> None: ...

    async def mirror_machine_append(
        self,
        sandbox_id: str,
        path: str,
        content: str,
    ) -> None: ...

    async def await_machine_path_visible(
        self,
        sandbox_id: str,
        path: str,
        *,
        expected_content: str = "",
        timeout_s: float = 20.0,
        poll_interval_s: float = 0.25,
    ) -> None: ...

    async def terminate(self, sandbox_id: str) -> None: ...

    async def list_sandboxes(self) -> list[SandboxInstance]: ...

    async def get_status(self, sandbox_id: str) -> str: ...

    async def get_crash_info(self, sandbox_id: str) -> dict | None:
        """Return exit code and last log lines for a dead/exited container.

        Returns None if the container is not found or info is unavailable.
        Result shape: {exit_code: int, oom_killed: bool, logs: str}
        """
        ...

    async def get_event_tail(self, sandbox_id: str, *, limit: int = 20) -> list[dict]:
        """Return recent platform events correlated to the sandbox if available."""
        ...
