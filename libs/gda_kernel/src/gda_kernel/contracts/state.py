from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class StateVersion:
    version_id: str
    observed_at: datetime
    source_refs: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class State:
    subject: str
    version: StateVersion
    facts: dict[str, object] = field(default_factory=dict)
