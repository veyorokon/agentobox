from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Capability:
    capability_id: str
    input_schema: dict[str, object] = field(default_factory=dict)
    readable_resources: tuple[str, ...] = ()
    writable_resources: tuple[str, ...] = ()
    expected_outcome: dict[str, object] = field(default_factory=dict)
    required_authority: str | None = None
