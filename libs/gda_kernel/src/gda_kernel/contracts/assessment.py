from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Assessment:
    assessment_id: str
    dimension_id: str
    value: object
    schema_ref: str
    origin: str
    assessed_at: datetime
    provenance_refs: tuple[str, ...] = ()
    valid_from: datetime | None = None
    valid_until: datetime | None = None

    @property
    def effective_from(self) -> datetime:
        return self.valid_from or self.assessed_at
