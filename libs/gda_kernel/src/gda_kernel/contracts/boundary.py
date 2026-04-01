from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Boundary:
    boundary_id: str
    readable_scope: tuple[str, ...] = ()
    writable_scope: tuple[str, ...] = ()
    capability_ids: tuple[str, ...] = ()
    budget: dict[str, object] = field(default_factory=dict)
    policy: dict[str, object] = field(default_factory=dict)
