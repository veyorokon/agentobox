from __future__ import annotations

from datetime import datetime, timezone

from gda_kernel import (
    Boundary,
    Commitment,
    Goal,
    Objective,
    Observation,
    ObservationSource,
    TargetCondition,
    project_ref,
    run_ref,
    world_ref,
)
from gda_kernel.contracts.context import (
    AgentTurnBrief,
    CommitmentSummary,
    GDAAwarenessSummary,
    GDAContextEnvelope,
    GoalProgress,
    ProgressSummary,
    RecentChange,
    StateSignal,
)
from gda_kernel.contracts.state import StateEntry


def test_gda_context_envelope_holds_immutable_turn_context() -> None:
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    envelope = GDAContextEnvelope(
        context_version_id="ctx-1",
        subject_ref=project_ref("123"),
        subject_name="OpenVending Ops",
        run_id=run_ref("123"),
        world_ref=world_ref("123"),
        objective=Objective(
            objective_id="objective-1",
            name="Handle supplier delay",
            goals=(
                Goal(
                    goal_id="goal-1",
                    name="Assess impact",
                    desired_state={"supplier_risk_assessed": True},
                ),
            ),
        ),
        boundary=Boundary(
            boundary_id="boundary-1",
            capability_ids=("ops.measure_supplier_risk",),
        ),
        state_entries=(
            StateEntry(
                dimension_id="runtime.health",
                value={"status": "ready"},
                schema_ref="status.readiness.v1",
                origin="observed",
                valid_from=now,
                provenance_refs=("obs:runtime-1",),
            ),
        ),
        active_commitments=(
            Commitment(
                commitment_id="commitment-1",
                objective_id="objective-1",
                capability_id="ops.measure_supplier_risk",
                status="active",
            ),
        ),
        recent_observations=(
            Observation(
                observation_id="obs-1",
                kind="communication.email.received",
                subject=project_ref("123"),
                observed_at=now,
                source=ObservationSource(kind="gmail", source_id="inbox"),
                payload={"subject": "Delay on chips order"},
                provenance_refs=("gmail:msg-1",),
            ),
        ),
        awareness=GDAAwarenessSummary(
            control_status="running",
            active_commitment_count=1,
            recent_observation_count=1,
            last_observed_at=now,
        ),
        progress=ProgressSummary(
            objective_id="objective-1",
            status="satisfied",
            total_goals=1,
            satisfied_goals=1,
            goal_progress=(
                GoalProgress(
                    goal_id="goal-1",
                    goal_name="Assess impact",
                    status="satisfied",
                ),
            ),
        ),
        metadata={"project_id": "123"},
    )

    assert envelope.context_version_id == "ctx-1"
    assert envelope.subject_ref == project_ref("123")
    assert envelope.awareness.control_status == "running"
    assert envelope.progress.status == "satisfied"
    assert envelope.state_entries[0].dimension_id == "runtime.health"
    assert envelope.active_commitments[0].status == "active"


def test_agent_turn_brief_holds_minimal_action_guiding_context() -> None:
    brief = AgentTurnBrief(
        role="worker",
        context_version_id="ctx-1",
        subject_ref=project_ref("123"),
        subject_name="OpenVending Ops",
        objective_id="objective-1",
        objective_name="Handle supplier delay",
        goal_names=("Assess impact",),
        allowed_actions=("gda_observation_admit", "gda_execution_report"),
        allowed_capability_ids=("ops.measure_supplier_risk",),
        relevant_state=(
            StateSignal(
                dimension_id="runtime.health",
                value={"status": "ready"},
            ),
        ),
        active_commitments=(
            CommitmentSummary(
                commitment_id="commitment-1",
                capability_id="ops.measure_supplier_risk",
                status="active",
            ),
        ),
        recent_changes=(
            RecentChange(
                change_type="observation",
                ref_id="obs-1",
                summary="measurement.inventory_days_remaining",
            ),
        ),
        control_status="running",
        progress=ProgressSummary(
            objective_id="objective-1",
            status="unknown",
            total_goals=1,
            unknown_goals=1,
            goal_progress=(
                GoalProgress(
                    goal_id="goal-1",
                    goal_name="Assess impact",
                    status="unknown",
                    missing_dimensions=("supplier_risk_assessed",),
                ),
            ),
        ),
    )

    assert brief.role == "worker"
    assert brief.allowed_capability_ids == ("ops.measure_supplier_risk",)
    assert brief.relevant_state[0].dimension_id == "runtime.health"
    assert brief.active_commitments[0].commitment_id == "commitment-1"
    assert brief.progress.status == "unknown"


def test_goal_normalizes_legacy_goal_maps_into_target_conditions() -> None:
    goal = Goal(
        goal_id="goal-1",
        name="Create hello file",
        desired_state={"workspace.file.exists": {"exists": True}},
        satisfaction_criteria={"workspace.file.content": {"content": "hello from agentobox"}},
    )

    assert goal.target_conditions == (
        TargetCondition(
            condition_id="goal-1:desired_state:1",
            dimension_id="workspace.file.exists",
            expected_value={"exists": True},
        ),
        TargetCondition(
            condition_id="goal-1:satisfaction_criteria:1",
            dimension_id="workspace.file.content",
            expected_value={"content": "hello from agentobox"},
        ),
    )
