from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Commitment:
    commitment_id: str
    objective_id: str
    capability_id: str
    arguments: dict[str, object] = field(default_factory=dict)
    touched_scope: tuple[str, ...] = ()
    status: str = "proposed"
    expected_observation: dict[str, object] = field(default_factory=dict)
    expected_outcome: dict[str, object] = field(default_factory=dict)
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    close_reason: str | None = None
