import asyncio
import io
import tarfile
import time
from pathlib import PurePosixPath

import docker
import structlog
from django.conf import settings

from agents.runtimes.base import SandboxInstance

log = structlog.get_logger("agents.runtime.docker")


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

        op = log.bind(op="create", agent=name, image=image)
        op.info("creating_container")
        t0 = time.monotonic()

        def _create():
            # Remove stale container with the same name (e.g. from a previous failed deploy)
            try:
                stale = self._client.containers.get(container_name)
                stale.remove(force=True)
                op.info("removed_stale_container", container_name=container_name)
            except docker.errors.NotFound:
                pass

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
                vnc_url = f"http://localhost:{host_port}"
            else:
                vnc_url = ""
            return SandboxInstance(id=container.id, vnc_url=vnc_url)

        result = await self._run_sync(_create)
        op.info(
            "container_created",
            container_id=result.id[:12],
            vnc_url=result.vnc_url,
            elapsed_s=round(time.monotonic() - t0, 2),
        )
        return result

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "computeruse"
    ) -> str:
        op = log.bind(op="exec", container_id=sandbox_id[:12], cmd=cmd[:3])
        op.info("exec_start")
        t0 = time.monotonic()

        def _exec():
            container = self._client.containers.get(sandbox_id)
            exit_code, output = container.exec_run(cmd, user=user)
            return output.decode("utf-8", errors="replace")

        result = await self._run_sync(_exec)
        op.info("exec_done", elapsed_s=round(time.monotonic() - t0, 2))
        return result

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None:
        op = log.bind(op="write_file", container_id=sandbox_id[:12], dest=dest)
        op.info("write_file_start", size=len(content))
        t0 = time.monotonic()

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
        op.info("write_file_done", elapsed_s=round(time.monotonic() - t0, 2))

    async def terminate(self, sandbox_id: str) -> None:
        op = log.bind(op="terminate", container_id=sandbox_id[:12])
        op.info("terminate_start")
        t0 = time.monotonic()

        def _terminate():
            try:
                container = self._client.containers.get(sandbox_id)
                container.stop(timeout=5)
                container.remove(force=True)
            except docker.errors.NotFound:
                pass

        await self._run_sync(_terminate)
        op.info("terminate_done", elapsed_s=round(time.monotonic() - t0, 2))

    async def list_sandboxes(self) -> list[SandboxInstance]:
        op = log.bind(op="list_sandboxes")
        op.info("list_start")
        t0 = time.monotonic()

        def _list():
            containers = self._client.containers.list(
                filters={"label": "agentobox.managed=true"}
            )
            results = []
            for c in containers:
                port_bindings = c.ports.get("6080/tcp")
                if port_bindings:
                    host_port = port_bindings[0]["HostPort"]
                    vnc_url = f"http://localhost:{host_port}"
                else:
                    vnc_url = ""
                results.append(SandboxInstance(id=c.id, vnc_url=vnc_url))
            return results

        results = await self._run_sync(_list)
        op.info(
            "list_done",
            count=len(results),
            elapsed_s=round(time.monotonic() - t0, 2),
        )
        return results

    async def get_status(self, sandbox_id: str) -> str:
        """Check container status. Kept quiet — called every 5s by GDA."""

        def _status():
            try:
                container = self._client.containers.get(sandbox_id)
                container.reload()
                return container.status  # "running", "exited", etc.
            except docker.errors.NotFound:
                return "dead"

        return await self._run_sync(_status)
