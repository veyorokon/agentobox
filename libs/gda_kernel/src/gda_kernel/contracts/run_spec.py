from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from gda_kernel.contracts.boundary import Boundary
from gda_kernel.contracts.objective import Objective


@dataclass(frozen=True, slots=True)
class RunSpec:
    run_id: str
    objective: Objective
    boundary: Boundary
    world_ref: str
    as_of: datetime
    evaluator_profile: str = "default"
    capability_ids: tuple[str, ...] = ()
    metadata: dict[str, str] = field(default_factory=dict)
