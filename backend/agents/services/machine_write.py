from __future__ import annotations

import base64
import json
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
        self.volume = agent.volume

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None:
        self.volume.append_task(task_id=task_id, content=content, role=role)

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand:
        return self.volume.mutate(path, content)


class ModalAgentMachineWriter(LocalAgentMachineWriter):
    """Modal writer: keep backend machine state and mirror desired writes into sandbox."""

    def __init__(self, agent: Agent):
        super().__init__(agent)
        self._runtime = None

    def _sandbox_dest(self, path: str) -> str:
        return f"/vol/agents/{self.agent.id}/{path}"

    @property
    def runtime(self):
        if self._runtime is None:
            self._runtime = get_runtime("modal")
        return self._runtime

    async def append_task(self, *, task_id: str, content: list, role: str = "user") -> None:
        await super().append_task(task_id=task_id, content=content, role=role)
        if not self.agent.sandbox_id:
            return

        line = json.dumps({
            "type": "task",
            "task_id": task_id,
            "input": {"role": role, "content": content},
        })
        encoded = base64.b64encode((line + "\n").encode()).decode()
        await self.runtime.exec(
            self.agent.sandbox_id,
            ["bash", "-c", f"echo {encoded} | base64 -d >> {self._sandbox_dest('_abox/inbox.jsonl')}"],
        )

    async def mutate(self, path: str, content: str | bytes) -> ReloadCommand:
        reload_cmd = await super().mutate(path, content)
        if not self.agent.sandbox_id:
            return reload_cmd

        body = content if isinstance(content, bytes) else content.encode()
        await self.runtime.write_file(
            self.agent.sandbox_id,
            body,
            self._sandbox_dest(path),
        )
        return reload_cmd


def get_machine_writer(agent: Agent) -> AgentMachineWriter:
    if agent.runtime == "modal":
        return ModalAgentMachineWriter(agent)
    return LocalAgentMachineWriter(agent)
