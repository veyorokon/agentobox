from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Mapping


@dataclass(frozen=True, slots=True)
class ObservationSource:
    kind: str
    source_id: str


@dataclass(frozen=True, slots=True)
class ObservationFreshnessPolicy:
    require_provenance: bool = False
    reject_future: bool = False
    reject_expired: bool = False

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "ObservationFreshnessPolicy":
        return cls(
            require_provenance=bool(value.get("require_provenance", False)),
            reject_future=bool(value.get("reject_future", False)),
            reject_expired=bool(value.get("reject_expired", False)),
        )


@dataclass(frozen=True, slots=True)
class Observation:
    observation_id: str
    kind: str
    subject: str
    observed_at: datetime
    source: ObservationSource
    payload: dict[str, object] = field(default_factory=dict)
    provenance_refs: tuple[str, ...] = ()
    valid_at: datetime | None = None
    expires_at: datetime | None = None
    quality: str = "exact"

    @property
    def effective_at(self) -> datetime:
        return self.valid_at or self.observed_at

    def is_expired_at(self, when: datetime) -> bool:
        return self.expires_at is not None and self.expires_at <= when
