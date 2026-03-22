from __future__ import annotations

import io
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import modal

from config.app_config import app_config


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
        return f"home/agent/.claude/skills/{safe_name}"

    def skill_file(self, safe_name: str) -> str:
        return f"{self.skill_dir(safe_name)}/SKILL.md"


class ProjectVolumeStore(Protocol):
    """Backend-facing access contract for project/agent machine state."""

    def write_bytes(self, machine: AgentMachinePaths, path: str, content: bytes) -> None: ...

    def read_text(self, machine: AgentMachinePaths, path: str) -> str: ...

    def read_bytes(self, machine: AgentMachinePaths, path: str) -> bytes: ...

    def read_bytes_limited(self, machine: AgentMachinePaths, path: str, max_bytes: int) -> tuple[bytes, bool]:
        """Read up to max_bytes from a file. Returns (data, was_truncated)."""
        ...

    def exists(self, machine: AgentMachinePaths, path: str) -> bool: ...

    def chmod(self, machine: AgentMachinePaths, path: str, mode: int) -> None: ...

    def mkdir(self, machine: AgentMachinePaths, path: str) -> None: ...

    def unlink(self, machine: AgentMachinePaths, path: str) -> None: ...

    def append_text(self, machine: AgentMachinePaths, path: str, content: str) -> None: ...

    def remove_tree(self, machine: AgentMachinePaths, path: str) -> None: ...

    def stat_size(self, machine: AgentMachinePaths, path: str) -> int: ...

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

    def read_bytes_limited(self, machine: AgentMachinePaths, path: str, max_bytes: int) -> tuple[bytes, bool]:
        full = self._full_path(machine, path)
        with open(full, "rb") as f:
            data = f.read(max_bytes + 1)
        truncated = len(data) > max_bytes
        return data[:max_bytes], truncated

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

    def local_machine_root(self, machine: AgentMachinePaths) -> Path:
        return self._full_path(machine)


class ModalProjectVolumeStore:
    """Modal Volume-backed machine store for runtime-visible agent state."""

    def __init__(self, volume_name: str, *, environment_name: str | None = None):
        self._volume_name = volume_name
        self._environment_name = environment_name or os.environ.get("MODAL_ENVIRONMENT") or app_config.environment
        self._volume = None

    @property
    def volume(self):
        if self._volume is None:
            self._volume = modal.Volume.from_name(
                self._volume_name,
                create_if_missing=True,
                environment_name=self._environment_name,
            )
        return self._volume

    def _volume_path(self, machine: AgentMachinePaths, path: str = "") -> str:
        entry = machine.archive_entry(path)
        return f"/{entry}"

    @staticmethod
    def _is_missing_path_error(exc: Exception) -> bool:
        if isinstance(exc, modal.exception.NotFoundError):
            return True
        if isinstance(exc, modal.exception.InvalidError):
            return "No such file or directory" in str(exc)
        return False

    def write_bytes(self, machine: AgentMachinePaths, path: str, content: bytes) -> None:
        with self.volume.batch_upload(force=True) as batch:
            batch.put_file(io.BytesIO(content), self._volume_path(machine, path))

    def read_text(self, machine: AgentMachinePaths, path: str) -> str:
        return self.read_bytes(machine, path).decode()

    def read_bytes(self, machine: AgentMachinePaths, path: str) -> bytes:
        return b"".join(self.volume.read_file(self._volume_path(machine, path)))

    def read_bytes_limited(self, machine: AgentMachinePaths, path: str, max_bytes: int) -> tuple[bytes, bool]:
        # Modal API does not support partial reads — read full then truncate.
        data = self.read_bytes(machine, path)
        truncated = len(data) > max_bytes
        return data[:max_bytes], truncated

    def exists(self, machine: AgentMachinePaths, path: str) -> bool:
        target = self._volume_path(machine, path).lstrip("/")
        try:
            entries = self.volume.listdir(self._volume_path(machine, path), recursive=False)
        except (modal.exception.NotFoundError, modal.exception.InvalidError) as exc:
            if self._is_missing_path_error(exc):
                return False
            raise
        return any(getattr(entry, "path", "") == target for entry in entries) or bool(entries)

    def chmod(self, machine: AgentMachinePaths, path: str, mode: int) -> None:
        body = self.read_bytes(machine, path)
        with self.volume.batch_upload(force=True) as batch:
            batch.put_file(io.BytesIO(body), self._volume_path(machine, path), mode=mode)

    def mkdir(self, machine: AgentMachinePaths, path: str) -> None:
        # Managed runtime no longer requires empty directory precreation on Modal.
        return None

    def unlink(self, machine: AgentMachinePaths, path: str) -> None:
        try:
            self.volume.remove_file(self._volume_path(machine, path), recursive=True)
        except (modal.exception.NotFoundError, modal.exception.InvalidError) as exc:
            if self._is_missing_path_error(exc):
                return None
            raise

    def append_text(self, machine: AgentMachinePaths, path: str, content: str) -> None:
        existing = self.read_text(machine, path) if self.exists(machine, path) else ""
        self.write_bytes(machine, path, (existing + content).encode())

    def remove_tree(self, machine: AgentMachinePaths, path: str) -> None:
        self.unlink(machine, path)

    def stat_size(self, machine: AgentMachinePaths, path: str) -> int:
        target = self._volume_path(machine, path).lstrip("/")
        try:
            for entry in self.volume.listdir(self._volume_path(machine, path), recursive=False):
                if getattr(entry, "path", "") == target:
                    return int(getattr(entry, "size", 0))
        except (modal.exception.NotFoundError, modal.exception.InvalidError) as exc:
            if not self._is_missing_path_error(exc):
                raise
        return len(self.read_bytes(machine, path))

    def local_machine_root(self, machine: AgentMachinePaths) -> Path:
        return Path(machine.mounted_root())
