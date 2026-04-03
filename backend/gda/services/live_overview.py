from __future__ import annotations

from gda.models import (
    ProjectCommitmentAssignment,
    ProjectExecution,
    ProjectState,
)
from gda.services.context_envelope import build_gda_context_envelope
from gda_kernel import agent_ref
from projects.models import Project


def _serialize_datetime(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def build_gda_live_overview(*, project: Project) -> dict[str, object] | None:
    if not ProjectState.objects.filter(project=project).exists():
        return None

    envelope = build_gda_context_envelope(project=project)
    assignments = {
        assignment.commitment.commitment_id: assignment
        for assignment in ProjectCommitmentAssignment.objects.filter(project=project)
        .select_related("commitment", "agent")
    }
    recent_executions = ProjectExecution.objects.filter(project=project).select_related("commitment").order_by(
        "-created_at"
    )[:10]
    objective = envelope.objective

    return {
        "context_version_id": envelope.context_version_id,
        "subject_ref": envelope.subject_ref,
        "subject_name": envelope.subject_name,
        "world_ref": envelope.world_ref,
        "objective": (
            {
                "objective_id": objective.objective_id,
                "name": objective.name,
                "description": objective.description,
            }
            if objective is not None
            else None
        ),
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
        "state_entries": [
            {
                "dimension_id": entry.dimension_id,
                "value": entry.value,
                "schema_ref": entry.schema_ref,
                "origin": entry.origin,
                "valid_from": _serialize_datetime(entry.valid_from),
                "valid_until": _serialize_datetime(entry.valid_until),
            }
            for entry in envelope.state_entries
        ],
        "active_commitments": [
            {
                "commitment_id": commitment.commitment_id,
                "capability_id": commitment.capability_id,
                "status": commitment.status,
                "objective_id": commitment.objective_id,
                "assignment_agent_ref": (
                    agent_ref(assignments[commitment.commitment_id].agent_id)
                    if commitment.commitment_id in assignments
                    else None
                ),
                "assignment_agent_name": (
                    assignments[commitment.commitment_id].agent.name
                    if commitment.commitment_id in assignments
                    else None
                ),
            }
            for commitment in envelope.active_commitments
        ],
        "recent_observations": [
            {
                "observation_id": observation.observation_id,
                "kind": observation.kind,
                "subject": observation.subject,
                "observed_at": _serialize_datetime(observation.observed_at),
                "source_kind": observation.source.kind,
                "source_id": observation.source.source_id,
                "quality": observation.quality,
            }
            for observation in envelope.recent_observations
        ],
        "recent_executions": [
            {
                "invocation_id": execution.invocation_id,
                "status": execution.status,
                "commitment_id": execution.commitment.commitment_id if execution.commitment is not None else None,
                "created_at": _serialize_datetime(execution.created_at),
                "completed_at": _serialize_datetime(execution.completed_at),
            }
            for execution in recent_executions
        ],
    }
