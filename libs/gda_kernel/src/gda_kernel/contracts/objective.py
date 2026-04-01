from __future__ import annotations

from dataclasses import dataclass, field

from gda_kernel.contracts.goal import Goal


@dataclass(frozen=True, slots=True)
class Objective:
    objective_id: str
    name: str
    description: str = ""
    goals: tuple[Goal, ...] = ()
    success_criteria: dict[str, object] = field(default_factory=dict)
