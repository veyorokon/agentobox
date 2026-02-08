import time

import modal
import structlog
from django.conf import settings

from agents.runtimes.base import SandboxInstance

log = structlog.get_logger("agents.runtime.modal")


class ModalRuntime:
    """Modal Python SDK runtime. Implements Runtime protocol."""

    async def create(
        self, name: str, env: dict[str, str],
        volumes: dict[str, str] | None = None,
    ) -> SandboxInstance:
        op = log.bind(op="create", agent=name)
        op.info("creating_sandbox", volumes=volumes)
        t0 = time.monotonic()

        app = await modal.App.lookup.aio(
            settings.MODAL_APP_NAME, create_if_missing=True
        )
        image = modal.Image.from_registry(
            settings.MODAL_AGENT_IMAGE,
            secret=modal.Secret.from_name("ghcr-secret"),
        )
        env_secret = modal.Secret.from_dict(env)

        # Map {host_path: container_path} to Modal volumes.
        # Each unique workspace gets a named volume keyed by a slug of the path.
        modal_volumes = {}
        if volumes:
            for host_path, container_path in volumes.items():
                vol_label = "agentobox-ws-" + host_path.strip("/").replace("/", "-")[-60:]
                vol = modal.Volume.from_name(vol_label, create_if_missing=True)
                modal_volumes[container_path] = vol
            op.info("modal_volumes_attached", labels=list(modal_volumes.keys()))

        sb = await modal.Sandbox.create.aio(
            "/init",
            app=app,
            image=image,
            secrets=[env_secret],
            encrypted_ports=[6080],
            timeout=3600,
            cpu=2.0,
            memory=4096,
            volumes=modal_volumes or None,
        )
        await sb.set_tags.aio(
            {"agentobox.managed": "true", "agentobox.agent": name}
        )
        tunnels = await sb.tunnels.aio()
        vnc_url = tunnels[6080].url if 6080 in tunnels else ""

        op.info(
            "sandbox_created",
            sandbox_id=sb.object_id,
            vnc_url=vnc_url,
            elapsed_s=round(time.monotonic() - t0, 2),
        )
        return SandboxInstance(id=sb.object_id, vnc_url=vnc_url)

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "computeruse"
    ) -> str:
        op = log.bind(op="exec", sandbox_id=sandbox_id, cmd=cmd[:3])
        op.info("exec_start")
        t0 = time.monotonic()

        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        process = await sb.exec.aio(*cmd)
        await process.wait.aio()
        output = await process.stdout.read.aio()

        op.info("exec_done", elapsed_s=round(time.monotonic() - t0, 2))
        return output

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None:
        op = log.bind(op="write_file", sandbox_id=sandbox_id, dest=dest)
        op.info("write_file_start", size=len(content))
        t0 = time.monotonic()

        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        f = await sb.open.aio(dest, "wb")
        f.write(content)
        f.close()

        op.info("write_file_done", elapsed_s=round(time.monotonic() - t0, 2))

    async def terminate(self, sandbox_id: str) -> None:
        op = log.bind(op="terminate", sandbox_id=sandbox_id)
        op.info("terminate_start")
        t0 = time.monotonic()

        try:
            sb = await modal.Sandbox.from_id.aio(sandbox_id)
            await sb.terminate.aio()
            op.info("terminate_done", elapsed_s=round(time.monotonic() - t0, 2))
        except modal.exception.NotFoundError:
            op.info("terminate_not_found")

    async def list_sandboxes(self) -> list[SandboxInstance]:
        op = log.bind(op="list_sandboxes")
        op.info("list_start")
        t0 = time.monotonic()

        app = await modal.App.lookup.aio(settings.MODAL_APP_NAME)
        results = []
        async for sb in modal.Sandbox.list.aio(app_id=app.app_id):
            tunnels = await sb.tunnels.aio()
            vnc_url = tunnels[6080].url if 6080 in tunnels else ""
            results.append(SandboxInstance(id=sb.object_id, vnc_url=vnc_url))

        op.info(
            "list_done",
            count=len(results),
            elapsed_s=round(time.monotonic() - t0, 2),
        )
        return results

    async def get_status(self, sandbox_id: str) -> str:
        """Check sandbox status. Kept quiet — called every 5s by GDA."""
        try:
            sb = await modal.Sandbox.from_id.aio(sandbox_id)
            if sb.returncode is None:
                return "running"
            return "exited"
        except modal.exception.NotFoundError:
            return "dead"
