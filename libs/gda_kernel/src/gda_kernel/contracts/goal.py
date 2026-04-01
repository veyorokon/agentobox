from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Goal:
    goal_id: str
    name: str
    description: str = ""
    desired_state: dict[str, object] = field(default_factory=dict)
    satisfaction_criteria: dict[str, object] = field(default_factory=dict)
