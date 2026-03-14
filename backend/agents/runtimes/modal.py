"""
Modal runtime — serverless container orchestration via Modal Python SDK.

Implements the Runtime protocol for production deployments. Each agent gets
a Modal Sandbox with the agent image pulled from GHCR (authenticated via
ghcr-secret). Volumes use modal.Volume.from_name() with create_if_missing.
VNC is exposed via Modal's encrypted tunnel on port 6080.

Modal Sandbox.create is natively async (.aio suffix), so no executor
wrapping needed unlike DockerRuntime.
"""
import time

import modal
import structlog
from config.app_config import app_config

from agents.runtimes.base import SandboxInstance, VolumeMount

log = structlog.get_logger("abox.runtime.modal")


class ModalRuntime:
    """Modal Python SDK runtime. Implements Runtime protocol."""

    async def create(
        self, name: str, env: dict[str, str],
        volumes: list[VolumeMount] | None = None,
    ) -> SandboxInstance:
        op = log.bind(op="create", agent_name=name)
        op.info("runtime.sandbox_creating", volumes=[m.name for m in volumes] if volumes else [])
        t0 = time.monotonic()

        app = await modal.App.lookup.aio(
            app_config.modal.app_name, create_if_missing=True
        )
        # Select image based on agent_type. The env dict carries AGENT_TYPE
        # (set by lifecycle.py from the Agent model field).
        agent_type = env.get("AGENT_TYPE", "claude-code")
        image_ref = app_config.modal.agent_image_map.get(agent_type, app_config.modal.agent_image)
        image = modal.Image.from_registry(
            image_ref,
            secret=modal.Secret.from_name("ghcr-secret"),
        ).entrypoint(["/usr/local/bin/abox-init"])
        env_secret = modal.Secret.from_dict(env)

        # Convert VolumeMount list to Modal volumes.
        # mount.name is used directly as the Modal volume label.
        modal_volumes = {}
        if volumes:
            for mount in volumes:
                vol = modal.Volume.from_name(mount.name, create_if_missing=True)
                modal_volumes[mount.mount_path] = vol
            op.info("runtime.volumes_attached", names=[m.name for m in volumes])

        create_kwargs = dict(
            app=app,
            image=image,
            secrets=[env_secret],
            encrypted_ports=[6080, 8080],
            timeout=3600,
            cpu=2.0,
            memory=4096,
        )
        if modal_volumes:
            create_kwargs["volumes"] = modal_volumes

        sb = await modal.Sandbox.create.aio(**create_kwargs)
        agent_id = env.get("AGENT_ID", "")
        await sb.set_tags.aio(
            {"agentobox.managed": "true", "agentobox.agent": name, "agentobox.agent.id": agent_id}
        )
        tunnels = await sb.tunnels.aio()
        vnc_url = tunnels[6080].url if 6080 in tunnels else ""
        health_url = tunnels[8080].url if 8080 in tunnels else ""

        op.info(
            "runtime.sandbox_created",
            sandbox_id=sb.object_id,
            vnc_url=vnc_url,
            health_url=health_url,
            elapsed_s=round(time.monotonic() - t0, 2),
        )
        return SandboxInstance(id=sb.object_id, vnc_url=vnc_url, health_url=health_url)

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "agent"
    ) -> str:
        op = log.bind(op="exec", sandbox_id=sandbox_id, cmd=cmd[:3])
        op.info("runtime.exec_start")
        t0 = time.monotonic()

        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        process = await sb.exec.aio(*cmd)
        await process.wait.aio()
        output = await process.stdout.read.aio()

        elapsed = round(time.monotonic() - t0, 2)
        if process.returncode and process.returncode != 0:
            op.warning("runtime.exec_failed", exit_code=process.returncode, elapsed_s=elapsed,
                       output=output[:200] if output else "")
        else:
            op.info("runtime.exec_done", elapsed_s=elapsed)
        return output

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None:
        op = log.bind(op="write_file", sandbox_id=sandbox_id, dest=dest)
        op.info("runtime.write_file_start", size=len(content))
        t0 = time.monotonic()

        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        f = await sb.open.aio(dest, "wb")
        f.write(content)
        f.close()

        op.info("runtime.write_file_done", elapsed_s=round(time.monotonic() - t0, 2))

    async def terminate(self, sandbox_id: str) -> None:
        op = log.bind(op="terminate", sandbox_id=sandbox_id)
        op.info("runtime.terminate_start")
        t0 = time.monotonic()

        try:
            sb = await modal.Sandbox.from_id.aio(sandbox_id)
            await sb.terminate.aio()
            op.info("runtime.terminate_done", elapsed_s=round(time.monotonic() - t0, 2))
        except modal.exception.NotFoundError:
            op.info("runtime.terminate_not_found")

    async def list_sandboxes(self) -> list[SandboxInstance]:
        op = log.bind(op="list_sandboxes")
        op.info("runtime.list_start")
        t0 = time.monotonic()

        app = await modal.App.lookup.aio(app_config.modal.app_name)
        results = []
        async for sb in modal.Sandbox.list.aio(app_id=app.app_id):
            tunnels = await sb.tunnels.aio()
            vnc_url = tunnels[6080].url if 6080 in tunnels else ""
            results.append(SandboxInstance(id=sb.object_id, vnc_url=vnc_url))

        op.info(
            "runtime.list_done",
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
