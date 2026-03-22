"""Contracts for runtime-owned service supervision.

The runtime service graph is the canonical declaration of long-running local
processes that support the agent image. Service specs are platform-agnostic:
platform adapters decide how services are run, not what services exist or how
they depend on each other.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path


class ServiceOutputStream(StrEnum):
    """Structured label for subprocess output streams."""

    STDOUT = "stdout"
    STDERR = "stderr"


@dataclass(frozen=True)
class ServiceSpec:
    """Declarative runtime service definition.

    `depends_on` encodes startup ordering. `required_for_readiness` separates
    critical services from optional helpers so readiness policy remains
    explicit instead of being inferred from names or shell ordering.
    """

    name: str
    command: tuple[str, ...]
    env: dict[str, str] = field(default_factory=dict)
    cwd: Path | None = None
    depends_on: tuple[str, ...] = ()
    required_for_readiness: bool = True
