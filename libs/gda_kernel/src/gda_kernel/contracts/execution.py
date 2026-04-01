from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ExecutionOutcome:
    invocation_id: str
    status: str
    commitment_id: str | None = None
    resource_usage: dict[str, float] = field(default_factory=dict)
    artifact_refs: tuple[str, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)
