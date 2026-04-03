from __future__ import annotations

from gda.models import ProjectCommitment, ProjectObservation, ProjectState, ProjectStateEntry
from gda.services.admission import project_observation_to_contract
from gda.services.commitments import project_commitment_to_contract
from gda.services.evaluation import evaluate_objective
from gda.services.reduction import project_state_entry_to_contract
from gda_kernel import (
    Boundary,
    Goal,
    Objective,
    project_ref,
    world_ref,
)
from gda_kernel.contracts.context import GDAAwarenessSummary, GDAContextEnvelope
from projects.models import Project


ENVELOPE_METADATA_HIDDEN_KEYS = frozenset({"project_id", "project_name", "project_ref"})


def _serialize_datetime(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _public_metadata(data: dict[str, object]) -> dict[str, object]:
    return {
        key: value
        for key, value in data.items()
        if key not in ENVELOPE_METADATA_HIDDEN_KEYS
    }


def _objective_from_mapping(data: dict[str, object]) -> Objective | None:
    if not data:
        return None
    goal_rows = tuple(data.get("goals", ()))
    return Objective(
        objective_id=str(data.get("objective_id", "")),
        name=str(data.get("name", "")),
        description=str(data.get("description", "")),
        goals=tuple(
            Goal(
                goal_id=str(goal.get("goal_id", "")),
                name=str(goal.get("name", "")),
                description=str(goal.get("description", "")),
                desired_state=dict(goal.get("desired_state", {})),
                satisfaction_criteria=dict(goal.get("satisfaction_criteria", {})),
            )
            for goal in goal_rows
            if isinstance(goal, dict)
        ),
        success_criteria=dict(data.get("success_criteria", {})),
    )


def _boundary_from_mapping(data: dict[str, object]) -> Boundary | None:
    if not data:
        return None
    return Boundary(
        boundary_id=str(data.get("boundary_id", "")),
        readable_scope=tuple(str(item) for item in data.get("readable_scope", ())),
        writable_scope=tuple(str(item) for item in data.get("writable_scope", ())),
        capability_ids=tuple(str(item) for item in data.get("capability_ids", ())),
        budget=dict(data.get("budget", {})),
        policy=dict(data.get("policy", {})),
    )


def build_gda_context_envelope(*, project: Project) -> GDAContextEnvelope:
    project_state = ProjectState.objects.get(project=project)
    state_entries = tuple(
        project_state_entry_to_contract(record)
        for record in ProjectStateEntry.objects.filter(project=project).order_by("dimension_id")
    )
    recent_observations = tuple(
        project_observation_to_contract(record)
        for record in ProjectObservation.objects.filter(project=project)
        .order_by("-observed_at", "-admitted_at")[:10]
    )
    active_commitments = tuple(
        project_commitment_to_contract(record)
        for record in ProjectCommitment.objects.filter(project=project)
        .exclude(status__in=("satisfied", "failed", "canceled"))
        .order_by("-created_at")
    )
    last_observed_at = (
        recent_observations[0].observed_at if recent_observations else project_state.observed_at
    )
    objective = _objective_from_mapping(dict(project_state.objective))
    return GDAContextEnvelope(
        context_version_id=project_state.state_version_id,
        subject_ref=project_state.subject or project_ref(project.id),
        subject_name=project.name,
        run_id=project_state.run_id,
        world_ref=project_state.world_ref or world_ref(project.id),
        objective=objective,
        boundary=_boundary_from_mapping(dict(project_state.boundary)),
        state_entries=state_entries,
        active_commitments=active_commitments,
        recent_observations=recent_observations,
        awareness=GDAAwarenessSummary(
            control_status=project_state.status,
            active_commitment_count=len(active_commitments),
            recent_observation_count=len(recent_observations),
            last_observed_at=last_observed_at,
        ),
        progress=evaluate_objective(
            objective=objective,
            state_entries=state_entries,
            legacy_facts=dict(project_state.facts),
        ),
        metadata=_public_metadata(dict(project_state.metadata)),
    )


def serialize_gda_context_envelope(
    envelope: GDAContextEnvelope,
) -> dict[str, object]:
    reduced_state_entries = [
        {
            "dimension_id": entry.dimension_id,
            "value": entry.value,
            "schema_ref": entry.schema_ref,
            "origin": entry.origin,
            "valid_from": entry.valid_from.isoformat(),
            "valid_until": _serialize_datetime(entry.valid_until),
            "provenance_refs": list(entry.provenance_refs),
        }
        for entry in envelope.state_entries
    ]
    recent_observations = [
        {
            "observation_id": observation.observation_id,
            "kind": observation.kind,
            "subject": observation.subject,
            "observed_at": _serialize_datetime(observation.observed_at),
            "valid_at": _serialize_datetime(observation.valid_at),
            "expires_at": _serialize_datetime(observation.expires_at),
            "source_kind": observation.source.kind,
            "source_id": observation.source.source_id,
            "quality": observation.quality,
        }
        for observation in envelope.recent_observations
    ]
    active_commitments = [
        {
            "commitment_id": commitment.commitment_id,
            "capability_id": commitment.capability_id,
            "status": commitment.status,
            "objective_id": commitment.objective_id,
        }
        for commitment in envelope.active_commitments
    ]
    objective = envelope.objective
    boundary = envelope.boundary
    return {
        "envelope_type": "gda_context_envelope",
        "context_version_id": envelope.context_version_id,
        "subject_ref": envelope.subject_ref,
        "subject_name": envelope.subject_name,
        "run_id": envelope.run_id,
        "world_ref": envelope.world_ref,
        "objective": (
            {
                "objective_id": objective.objective_id,
                "name": objective.name,
                "description": objective.description,
                "goals": [
                    {
                        "goal_id": goal.goal_id,
                        "name": goal.name,
                        "description": goal.description,
                        "desired_state": dict(goal.desired_state),
                        "satisfaction_criteria": dict(goal.satisfaction_criteria),
                    }
                    for goal in objective.goals
                ],
                "success_criteria": dict(objective.success_criteria),
            }
            if objective is not None
            else {}
        ),
        "boundary": (
            {
                "boundary_id": boundary.boundary_id,
                "readable_scope": list(boundary.readable_scope),
                "writable_scope": list(boundary.writable_scope),
                "capability_ids": list(boundary.capability_ids),
                "budget": dict(boundary.budget),
                "policy": dict(boundary.policy),
            }
            if boundary is not None
            else {}
        ),
        "metadata": dict(envelope.metadata),
        "state_entries": reduced_state_entries,
        "recent_observations": recent_observations,
        "active_commitments": active_commitments,
        "awareness": {
            "control_status": envelope.awareness.control_status,
            "state_entry_count": len(envelope.state_entries),
            "active_commitment_count": envelope.awareness.active_commitment_count,
            "recent_observation_count": envelope.awareness.recent_observation_count,
            "last_observed_at": _serialize_datetime(envelope.awareness.last_observed_at),
        },
        "progress": {
            "objective_id": envelope.progress.objective_id,
            "status": envelope.progress.status,
            "total_goals": envelope.progress.total_goals,
            "satisfied_goals": envelope.progress.satisfied_goals,
            "unknown_goals": envelope.progress.unknown_goals,
            "failed_goals": envelope.progress.failed_goals,
            "goal_progress": [
                {
                    "goal_id": goal.goal_id,
                    "goal_name": goal.goal_name,
                    "status": goal.status,
                    "missing_dimensions": list(goal.missing_dimensions),
                    "failed_dimensions": list(goal.failed_dimensions),
                }
                for goal in envelope.progress.goal_progress
            ],
        },
    }
