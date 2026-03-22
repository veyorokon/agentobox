from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from agent.contracts.mode import AgentMode


class FileValidator(StrEnum):
    EXISTS = "exists"
    NONEMPTY_FILE = "nonempty_file"
    VALID_JSON = "valid_json"


@dataclass(frozen=True)
class ProvisioningManifest:
    manifest_version: str
    mode: AgentMode
    required_files: tuple[str, ...]
    optional_files: tuple[str, ...] = ()
    derived_files: tuple[str, ...] = ()
    validators: dict[str, FileValidator] = field(default_factory=dict)


@dataclass(frozen=True)
class ProvisioningReport:
    manifest: ProvisioningManifest
    root: Path


class ProvisioningProvider(Protocol):
    def prepare(self, root: Path) -> ProvisioningReport: ...

