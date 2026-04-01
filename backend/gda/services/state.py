from __future__ import annotations

from gda_kernel import Boundary, Goal, Objective, RunSpec, State, StateVersion

from gda.models import ProjectState
from projects.models import Project


def _serialize_goal(goal: Goal) -> dict[str, object]:
    return {
        "goal_id": goal.goal_id,
        "name": goal.name,
        "description": goal.description,
        "desired_state": dict(goal.desired_state),
        "satisfaction_criteria": dict(goal.satisfaction_criteria),
    }


def _serialize_objective(objective: Objective) -> dict[str, object]:
    return {
        "objective_id": objective.objective_id,
        "name": objective.name,
        "description": objective.description,
        "goals": [_serialize_goal(goal) for goal in objective.goals],
        "success_criteria": dict(objective.success_criteria),
    }


def _serialize_boundary(boundary: Boundary) -> dict[str, object]:
    return {
        "boundary_id": boundary.boundary_id,
        "readable_scope": list(boundary.readable_scope),
        "writable_scope": list(boundary.writable_scope),
        "capability_ids": list(boundary.capability_ids),
        "budget": dict(boundary.budget),
        "policy": dict(boundary.policy),
    }


def _serialize_state(state: State) -> dict[str, object]:
    return {
        "subject": state.subject,
        "state_version_id": state.version.version_id,
        "observed_at": state.version.observed_at,
        "source_refs": list(state.version.source_refs),
        "facts": dict(state.facts),
    }


def project_state_to_contract(record: ProjectState) -> State:
    observed_at = record.observed_at
    if observed_at is None:
        raise ValueError("ProjectState.observed_at must be set to build a State contract")
    return State(
        subject=record.subject or record.world_ref,
        version=StateVersion(
            version_id=record.state_version_id,
            observed_at=observed_at,
            source_refs=tuple(record.source_refs),
        ),
        facts=dict(record.facts),
    )


def persist_run_spec_state(
    *,
    project: Project,
    run_spec: RunSpec,
    state: State | None = None,
    status: str = "ready",
) -> ProjectState:
    effective_state = state or State(
        subject=run_spec.world_ref,
        version=StateVersion(version_id="v1", observed_at=run_spec.as_of),
        facts={},
    )
    serialized_state = _serialize_state(effective_state)
    record, _created = ProjectState.objects.update_or_create(
        project=project,
        defaults={
            "world_ref": run_spec.world_ref,
            "run_id": run_spec.run_id,
            "evaluator_profile": run_spec.evaluator_profile,
            "status": status,
            "subject": str(serialized_state["subject"]),
            "state_version_id": str(serialized_state["state_version_id"]),
            "observed_at": serialized_state["observed_at"],
            "source_refs": serialized_state["source_refs"],
            "facts": serialized_state["facts"],
            "objective": _serialize_objective(run_spec.objective),
            "boundary": _serialize_boundary(run_spec.boundary),
            "metadata": dict(run_spec.metadata),
        },
    )
    return record
