import asyncio
import io
import tarfile
from pathlib import PurePosixPath

import docker
from django.conf import settings

from agents.runtimes.base import SandboxInstance


class DockerRuntime:
    """Local Docker runtime. Implements Runtime protocol."""

    def __init__(self):
        self._client = docker.from_env()

    def _run_sync(self, fn, *args, **kwargs):
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def create(self, name: str, env: dict[str, str]) -> SandboxInstance:
        container_name = f"agentobox-agent-{name}"
        image = getattr(settings, "AGENT_IMAGE", "agentobox-agent:latest")
        network = getattr(settings, "DOCKER_NETWORK", "agentobox_default")

        def _create():
            container = self._client.containers.run(
                image,
                detach=True,
                name=container_name,
                environment=env,
                ports={"6080/tcp": None},
                labels={
                    "agentobox.managed": "true",
                    "agentobox.agent": name,
                },
                network=network,
            )
            # Reload to get port mappings
            container.reload()
            port_bindings = container.ports.get("6080/tcp")
            if port_bindings:
                host_port = port_bindings[0]["HostPort"]
                vnc_url = f"http://localhost:{host_port}/vnc.html"
            else:
                vnc_url = ""
            return SandboxInstance(id=container.id, vnc_url=vnc_url)

        return await self._run_sync(_create)

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "computeruse"
    ) -> str:
        def _exec():
            container = self._client.containers.get(sandbox_id)
            exit_code, output = container.exec_run(cmd, user=user)
            return output.decode("utf-8", errors="replace")

        return await self._run_sync(_exec)

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None:
        def _write():
            container = self._client.containers.get(sandbox_id)
            path = PurePosixPath(dest)
            parent_dir = str(path.parent)
            file_name = path.name

            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w") as tar:
                info = tarfile.TarInfo(name=file_name)
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))
            buf.seek(0)
            container.put_archive(parent_dir, buf)

        await self._run_sync(_write)

    async def terminate(self, sandbox_id: str) -> None:
        def _terminate():
            try:
                container = self._client.containers.get(sandbox_id)
                container.stop(timeout=5)
                container.remove(force=True)
            except docker.errors.NotFound:
                pass

        await self._run_sync(_terminate)

    async def list_sandboxes(self) -> list[SandboxInstance]:
        def _list():
            containers = self._client.containers.list(
                filters={"label": "agentobox.managed=true"}
            )
            results = []
            for c in containers:
                port_bindings = c.ports.get("6080/tcp")
                if port_bindings:
                    host_port = port_bindings[0]["HostPort"]
                    vnc_url = f"http://localhost:{host_port}/vnc.html"
                else:
                    vnc_url = ""
                results.append(SandboxInstance(id=c.id, vnc_url=vnc_url))
            return results

        return await self._run_sync(_list)

    async def get_status(self, sandbox_id: str) -> str:
        def _status():
            try:
                container = self._client.containers.get(sandbox_id)
                container.reload()
                return container.status  # "running", "exited", etc.
            except docker.errors.NotFound:
                return "dead"

        return await self._run_sync(_status)
