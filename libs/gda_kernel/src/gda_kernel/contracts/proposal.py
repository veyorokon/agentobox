from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class CommitmentProposal:
    capability_id: str
    arguments: dict[str, object] = field(default_factory=dict)
    touched_scope: tuple[str, ...] = ()
    expected_observation: dict[str, object] = field(default_factory=dict)
    expected_outcome: dict[str, object] = field(default_factory=dict)
