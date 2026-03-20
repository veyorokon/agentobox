from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class AgentMachinePaths:
    """Canonical backend-side path vocabulary for one agent machine surface.

    Phase 1 preserves the existing on-disk layout. The backend still stores
    agent machine state under `VOLUME_ROOT/agents/{agent_id}/...`, but callers
    stop hard-coding that shape directly.
    """

    project_id: str
    agent_id: str

    def relative(self, path: str = "") -> Path:
        base = Path("agents") / self.agent_id
        return base / path if path else base

    def archive_entry(self, path: str = "") -> str:
        return self.relative(path).as_posix()

    def mounted_root(self) -> str:
        return f"/vol/{self.archive_entry()}"

    def mounted_path(self, path: str) -> str:
        return f"{self.mounted_root()}/{path}"

    def skill_dir(self, safe_name: str) -> str:
        return f"home/agent/workspace/.claude/skills/{safe_name}"

    def skill_file(self, safe_name: str) -> str:
        return f"{self.skill_dir(safe_name)}/SKILL.md"


class ProjectVolumeStore(Protocol):
    """Backend-facing access contract for project/agent machine state."""

    def write_bytes(self, machine: AgentMachinePaths, path: str, content: bytes) -> None: ...

    def read_text(self, machine: AgentMachinePaths, path: str) -> str: ...

    def read_bytes(self, machine: AgentMachinePaths, path: str) -> bytes: ...

    def exists(self, machine: AgentMachinePaths, path: str) -> bool: ...

    def chmod(self, machine: AgentMachinePaths, path: str, mode: int) -> None: ...

    def mkdir(self, machine: AgentMachinePaths, path: str) -> None: ...

    def unlink(self, machine: AgentMachinePaths, path: str) -> None: ...

    def append_text(self, machine: AgentMachinePaths, path: str, content: str) -> None: ...

    def remove_tree(self, machine: AgentMachinePaths, path: str) -> None: ...

    def stat_size(self, machine: AgentMachinePaths, path: str) -> int: ...

    def stat_mode(self, machine: AgentMachinePaths, path: str) -> int: ...

    def list_files(self, machine: AgentMachinePaths, prefix: str) -> list[str]: ...

    def local_machine_root(self, machine: AgentMachinePaths) -> Path: ...


class LocalProjectVolumeStore:
    """Filesystem-backed machine store used by the current Docker-style backend."""

    def __init__(self, root: Path):
        self._root = root

    def _full_path(self, machine: AgentMachinePaths, path: str = "") -> Path:
        rel = machine.relative(path)
        return self._root / rel

    def write_bytes(self, machine: AgentMachinePaths, path: str, content: bytes) -> None:
        full = self._full_path(machine, path)
        full.parent.mkdir(parents=True, exist_ok=True)
        tmp = full.with_suffix(".tmp")
        tmp.write_bytes(content)
        tmp.rename(full)

    def read_text(self, machine: AgentMachinePaths, path: str) -> str:
        return self._full_path(machine, path).read_text()

    def read_bytes(self, machine: AgentMachinePaths, path: str) -> bytes:
        return self._full_path(machine, path).read_bytes()

    def exists(self, machine: AgentMachinePaths, path: str) -> bool:
        return self._full_path(machine, path).exists()

    def chmod(self, machine: AgentMachinePaths, path: str, mode: int) -> None:
        self._full_path(machine, path).chmod(mode)

    def mkdir(self, machine: AgentMachinePaths, path: str) -> None:
        self._full_path(machine, path).mkdir(parents=True, exist_ok=True)

    def unlink(self, machine: AgentMachinePaths, path: str) -> None:
        target = self._full_path(machine, path)
        if target.exists():
            target.unlink()

    def append_text(self, machine: AgentMachinePaths, path: str, content: str) -> None:
        full = self._full_path(machine, path)
        full.parent.mkdir(parents=True, exist_ok=True)
        with open(full, "a") as f:
            f.write(content)

    def remove_tree(self, machine: AgentMachinePaths, path: str) -> None:
        target = self._full_path(machine, path)
        if target.exists():
            shutil.rmtree(target)

    def stat_size(self, machine: AgentMachinePaths, path: str) -> int:
        return self._full_path(machine, path).stat().st_size

    def stat_mode(self, machine: AgentMachinePaths, path: str) -> int:
        return self._full_path(machine, path).stat().st_mode & 0o777

    def list_files(self, machine: AgentMachinePaths, prefix: str) -> list[str]:
        base = self._full_path(machine, prefix)
        if not base.exists():
            return []
        return [
            str(full_path.relative_to(self._full_path(machine)))
            for full_path in sorted(base.rglob("*"))
            if full_path.is_file()
        ]

    def local_machine_root(self, machine: AgentMachinePaths) -> Path:
        return self._full_path(machine)
