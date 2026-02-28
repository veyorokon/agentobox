import asyncio
import io
import tarfile
import time
from pathlib import PurePosixPath

import docker
import structlog
from django.conf import settings

from agents.runtimes.base import SandboxInstance, VolumeMount

log = structlog.get_logger("agents.runtime.docker")


class DockerRuntime:
    """Local Docker runtime. Implements Runtime protocol."""

    def __init__(self):
        self._client = docker.from_env()

    def _run_sync(self, fn, *args, **kwargs):
        loop = asyncio.get_running_loop()
        return loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def create(
        self, name: str, env: dict[str, str],
        volumes: list[VolumeMount] | None = None,
    ) -> SandboxInstance:
        project_id = env.get("PROJECT_ID", "")[:8]
        container_name = f"agentobox-agent-{project_id}-{name}"
        image = getattr(settings, "AGENT_IMAGE", "agentobox-agent:latest")
        network = getattr(settings, "DOCKER_NETWORK", "agentobox_default")

        op = log.bind(op="create", agent_name=name, image=image)
        op.info("creating_container", volumes=[m.name for m in volumes] if volumes else [])
        t0 = time.monotonic()

        # Convert VolumeMount list to docker-py format
        docker_volumes = {}
        if volumes:
            for mount in volumes:
                mode = "ro" if mount.read_only else "rw"
                if mount.host_path:
                    # Bind mount (local dev)
                    docker_volumes[mount.host_path] = {"bind": mount.mount_path, "mode": mode}
                else:
                    # Named Docker volume
                    docker_volumes[mount.name] = {"bind": mount.mount_path, "mode": mode}

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
                volumes=docker_volumes or None,
            )
            # VNC URL uses container name DNS — the backend proxies VNC
            # to the browser (via VncProxyConsumer), so this URL only needs
            # to be resolvable from the backend container, not the browser.
            # Both containers share the Docker network, so container name
            # DNS works. Same pattern as Guacamole / Kasm Workspaces.
            vnc_url = f"http://{container_name}:6080"
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
        self, sandbox_id: str, cmd: list[str], user: str = "agent"
    ) -> str:
        op = log.bind(op="exec", container_id=sandbox_id[:12], cmd=cmd[:3])
        op.info("exec_start")
        t0 = time.monotonic()

        def _exec():
            container = self._client.containers.get(sandbox_id)
            exit_code, output = container.exec_run(cmd, user=user)
            decoded = output.decode("utf-8", errors="replace")
            return exit_code, decoded

        exit_code, result = await self._run_sync(_exec)
        elapsed = round(time.monotonic() - t0, 2)
        if exit_code != 0:
            op.warning("exec_failed", exit_code=exit_code, elapsed_s=elapsed,
                       output=result[:200] if result else "")
        else:
            op.info("exec_done", elapsed_s=elapsed)
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
                # Container name DNS — see comment in create() for rationale
                vnc_url = f"http://{c.name}:6080"
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

    async def get_crash_info(self, sandbox_id: str) -> dict | None:
        """Capture exit code, OOM status, and last 50 log lines from a dead container."""

        def _inspect():
            try:
                container = self._client.containers.get(sandbox_id)
                container.reload()
                state = container.attrs.get("State", {})
                logs = container.logs(tail=50, timestamps=True).decode(errors="replace")
                return {
                    "exit_code": state.get("ExitCode", -1),
                    "oom_killed": state.get("OOMKilled", False),
                    "logs": logs,
                }
            except docker.errors.NotFound:
                return None

        return await self._run_sync(_inspect)
