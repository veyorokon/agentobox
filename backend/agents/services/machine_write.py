from __future__ import annotations

import json
from typing import Protocol

from agents.models import Agent
from agents.runtimes import get_runtime
from agents.services.relay_commands import ReloadCommand


class AgentMachineWriter(Protocol):
    """Backend-owned desired-state writer for one agent machine surface."""

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None: ...

    async def write(self, path: str, content: str | bytes) -> None: ...

    async def remove_tree(self, path: str) -> None: ...

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand: ...


class RuntimeBackedAgentMachineWriter:
    """Write canonical machine state, then refresh runtime visibility if needed."""

    def __init__(self, agent: Agent):
        self.agent = agent
        self.machine = agent.machine
        self.runtime = get_runtime(agent.runtime)

    async def _sync_machine_volume(self) -> None:
        if not self.agent.sandbox_id:
            return
        await self.runtime.sync_machine_volume(
            self.agent.sandbox_id,
            self.machine.mounted_root(),
        )

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None:
        message = {
            "type": "task",
            "task_id": task_id,
            "input": {
                "role": role,
                "content": content,
            },
        }
        self.machine.append_inbox(message)
        if self.agent.sandbox_id:
            await self.runtime.mirror_machine_append(
                self.agent.sandbox_id,
                self.machine.mounted_path("_abox/inbox.jsonl"),
                json.dumps(message) + "\n",
            )
        await self._sync_machine_volume()

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand:
        reload_cmd = self.machine.mutate(path, content)
        await self._sync_machine_volume()
        return reload_cmd

    async def write(self, path: str, content: str | bytes) -> None:
        self.machine.write(path, content)
        await self._sync_machine_volume()

    async def remove_tree(self, path: str) -> None:
        self.machine.remove_tree(path)
        await self._sync_machine_volume()


def get_machine_writer(agent: Agent) -> AgentMachineWriter:
    return RuntimeBackedAgentMachineWriter(agent)
