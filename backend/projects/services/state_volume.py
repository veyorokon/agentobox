from __future__ import annotations

import asyncio
import os

import docker
import modal
import structlog

from config.app_config import app_config

log = structlog.get_logger("projects.state_volume")


def project_state_volume_name(project_id: str) -> str:
    return f"agentobox-state-{str(project_id)[:8]}"


async def delete_project_state_volume(project_id: str) -> None:
    volume_name = project_state_volume_name(project_id)
    runtime = app_config.agent.runtime

    if runtime == "modal":
        await _delete_modal_volume(volume_name)
        return

    await _delete_docker_volume(volume_name)


async def _delete_docker_volume(volume_name: str) -> None:
    def _remove() -> None:
        from docker.errors import DockerException, NotFound

        client = docker.from_env()
        try:
            try:
                volume = client.volumes.get(volume_name)
            except NotFound:
                return
            volume.remove(force=True)
        except NotFound:
            return
        except DockerException:
            raise
        finally:
            client.close()

    await asyncio.get_running_loop().run_in_executor(None, _remove)
    log.info("project.state_volume_deleted", runtime="docker", volume_name=volume_name)


async def _delete_modal_volume(volume_name: str) -> None:
    environment_name = os.environ.get("MODAL_ENVIRONMENT") or app_config.environment
    try:
        await modal.Volume.delete.aio(volume_name, environment_name=environment_name)
    except modal.exception.NotFoundError:
        return

    log.info(
        "project.state_volume_deleted",
        runtime="modal",
        volume_name=volume_name,
        environment_name=environment_name,
    )
