"""Canonical current-state records used by reducers/evaluators.

`StateEntry` is a mechanical sparse-state slice. It is intentionally not part
of the primary root import surface for the kernel.
"""

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


@dataclass(frozen=True, slots=True)
class StateEntry:
    dimension_id: str
    value: object
    schema_ref: str
    origin: str
    valid_from: datetime
    valid_until: datetime | None = None
    provenance_refs: tuple[str, ...] = ()

    def is_valid_at(self, when: datetime) -> bool:
        if self.valid_from > when:
            return False
        if self.valid_until is None:
            return True
        return when < self.valid_until
