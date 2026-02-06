import modal
from django.conf import settings

from agents.runtimes.base import SandboxInstance


class ModalRuntime:
    """Modal Python SDK runtime. Implements Runtime protocol."""

    async def create(self, name: str, env: dict[str, str]) -> SandboxInstance:
        app = await modal.App.lookup.aio(
            settings.MODAL_APP_NAME, create_if_missing=True
        )
        image = modal.Image.from_registry(
            settings.MODAL_AGENT_IMAGE,
            secret=modal.Secret.from_name("ghcr-secret"),
        )
        env_secret = modal.Secret.from_dict(env)
        sb = await modal.Sandbox.create.aio(
            app=app,
            image=image,
            secrets=[env_secret],
            encrypted_ports=[6080],
            timeout=3600,
            cpu=2.0,
            memory=4096,
        )
        await sb.set_tags.aio(
            {"agentobox.managed": "true", "agentobox.agent": name}
        )
        tunnels = await sb.tunnels.aio()
        vnc_url = tunnels[6080].url if 6080 in tunnels else ""
        return SandboxInstance(id=sb.object_id, vnc_url=vnc_url)

    async def exec(
        self, sandbox_id: str, cmd: list[str], user: str = "computeruse"
    ) -> str:
        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        process = await sb.exec.aio(*cmd)
        await process.wait.aio()
        return await process.stdout.read.aio()

    async def write_file(
        self, sandbox_id: str, content: bytes, dest: str
    ) -> None:
        sb = await modal.Sandbox.from_id.aio(sandbox_id)
        f = await sb.open.aio(dest, "wb")
        f.write(content)
        f.close()

    async def terminate(self, sandbox_id: str) -> None:
        try:
            sb = await modal.Sandbox.from_id.aio(sandbox_id)
            await sb.terminate.aio()
        except modal.exception.NotFoundError:
            pass

    async def list_sandboxes(self) -> list[SandboxInstance]:
        app = await modal.App.lookup.aio(settings.MODAL_APP_NAME)
        results = []
        async for sb in modal.Sandbox.list.aio(app_id=app.app_id):
            tunnels = await sb.tunnels.aio()
            vnc_url = tunnels[6080].url if 6080 in tunnels else ""
            results.append(SandboxInstance(id=sb.object_id, vnc_url=vnc_url))
        return results

    async def get_status(self, sandbox_id: str) -> str:
        try:
            sb = await modal.Sandbox.from_id.aio(sandbox_id)
            if sb.returncode is None:
                return "running"
            return "exited"
        except modal.exception.NotFoundError:
            return "dead"
