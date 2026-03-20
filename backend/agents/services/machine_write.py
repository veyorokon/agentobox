from __future__ import annotations

from typing import Protocol

from agents.models import Agent
from agents.runtimes import get_runtime
from agents.services.relay_commands import ReloadCommand


class AgentMachineWriter(Protocol):
    """Backend-owned desired-state writer for one agent machine surface."""

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None: ...

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand: ...


class LocalAgentMachineWriter:
    """Docker/local writer: backend volume write is already runtime-visible."""

    def __init__(self, agent: Agent):
        self.agent = agent
        self.machine = agent.machine

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None:
        self.machine.append_task(task_id=task_id, content=content, role=role)

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand:
        return self.machine.mutate(path, content)


class ModalAgentMachineWriter(LocalAgentMachineWriter):
    """Modal writer: store desired state canonically, then refresh /vol visibility."""

    def __init__(self, agent: Agent):
        super().__init__(agent)
        self._runtime = None

    @property
    def runtime(self):
        if self._runtime is None:
            self._runtime = get_runtime("modal")
        return self._runtime

    async def _sync_machine_volume(self) -> None:
        if not self.agent.sandbox_id:
            return
        await self.runtime.sync_machine_volume(self.agent.sandbox_id, self.machine.mounted_root())

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None:
        await super().append_task(task_id=task_id, content=content, role=role)
        await self._sync_machine_volume()

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand:
        reload_cmd = await super().mutate(path, content)
        await self._sync_machine_volume()
        return reload_cmd


def get_machine_writer(agent: Agent) -> AgentMachineWriter:
    if agent.runtime == "modal":
        return ModalAgentMachineWriter(agent)
    return LocalAgentMachineWriter(agent)
