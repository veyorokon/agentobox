"""Derived agent/UI projections over canonical GDA records.

These types are intentionally useful, but they are not the kernel trunk.
They should be consumed through explicit read seams rather than treated as the
primary ontology of the system.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from gda_kernel.contracts.boundary import Boundary
from gda_kernel.contracts.commitment import Commitment
from gda_kernel.contracts.objective import Objective
from gda_kernel.contracts.observation import Observation
from gda_kernel.contracts.state import StateEntry


@dataclass(frozen=True, slots=True)
class GDAAwarenessSummary:
    control_status: str
    active_commitment_count: int = 0
    recent_observation_count: int = 0
    last_observed_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class CommitmentSummary:
    commitment_id: str
    capability_id: str
    status: str


@dataclass(frozen=True, slots=True)
class StateSignal:
    dimension_id: str
    value: object


@dataclass(frozen=True, slots=True)
class RecentChange:
    change_type: str
    ref_id: str
    summary: str
    occurred_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class GoalProgress:
    goal_id: str
    goal_name: str
    status: str
    missing_dimensions: tuple[str, ...] = ()
    failed_dimensions: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ProgressSummary:
    objective_id: str
    status: str
    total_goals: int = 0
    satisfied_goals: int = 0
    unknown_goals: int = 0
    failed_goals: int = 0
    goal_progress: tuple[GoalProgress, ...] = ()


@dataclass(frozen=True, slots=True)
class GDAContextEnvelope:
    context_version_id: str
    subject_ref: str
    subject_name: str = ""
    run_id: str = ""
    world_ref: str = ""
    objective: Objective | None = None
    boundary: Boundary | None = None
    state_entries: tuple[StateEntry, ...] = ()
    active_commitments: tuple[Commitment, ...] = ()
    recent_observations: tuple[Observation, ...] = ()
    awareness: GDAAwarenessSummary = field(
        default_factory=lambda: GDAAwarenessSummary(control_status="idle")
    )
    progress: ProgressSummary = field(
        default_factory=lambda: ProgressSummary(objective_id="", status="idle")
    )
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentTurnBrief:
    role: str
    context_version_id: str
    subject_ref: str
    subject_name: str = ""
    objective_id: str = ""
    objective_name: str = ""
    goal_names: tuple[str, ...] = ()
    allowed_actions: tuple[str, ...] = ()
    allowed_capability_ids: tuple[str, ...] = ()
    relevant_state: tuple[StateSignal, ...] = ()
    active_commitments: tuple[CommitmentSummary, ...] = ()
    recent_changes: tuple[RecentChange, ...] = ()
    control_status: str = ""
    progress: ProgressSummary = field(
        default_factory=lambda: ProgressSummary(objective_id="", status="idle")
    )
