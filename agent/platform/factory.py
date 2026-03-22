from __future__ import annotations

from agent.contracts.platform import PlatformKind
from agent.platform.docker import DockerPlatformAdapter
from agent.platform.local import LocalPlatformAdapter
from agent.platform.modal import ModalPlatformAdapter


def build_platform(kind: PlatformKind):
    if kind is PlatformKind.LOCAL:
        return LocalPlatformAdapter()
    if kind is PlatformKind.DOCKER:
        return DockerPlatformAdapter()
    if kind is PlatformKind.MODAL:
        return ModalPlatformAdapter()
    raise ValueError(f"Unsupported platform kind: {kind}")

