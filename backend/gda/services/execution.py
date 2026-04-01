from __future__ import annotations

from datetime import datetime

from gda_kernel import ExecutionOutcome

from gda.models import ProjectCommitment, ProjectExecution
from projects.models import Project


def project_execution_to_contract(record: ProjectExecution) -> ExecutionOutcome:
    return ExecutionOutcome(
        invocation_id=record.invocation_id,
        commitment_id=record.commitment.commitment_id if record.commitment is not None else None,
        status=record.status,
        resource_usage={str(key): float(value) for key, value in record.resource_usage.items()},
        artifact_refs=tuple(str(ref) for ref in record.artifact_refs),
        metadata=dict(record.metadata),
    )


def record_execution_outcome(
    *,
    project: Project,
    outcome: ExecutionOutcome,
    completed_at: datetime | None = None,
) -> ProjectExecution:
    commitment = None
    if outcome.commitment_id:
        commitment = ProjectCommitment.objects.filter(
            project=project,
            commitment_id=outcome.commitment_id,
        ).first()

    record, _created = ProjectExecution.objects.update_or_create(
        project=project,
        invocation_id=outcome.invocation_id,
        defaults={
            "commitment": commitment,
            "status": outcome.status,
            "resource_usage": dict(outcome.resource_usage),
            "artifact_refs": list(outcome.artifact_refs),
            "metadata": dict(outcome.metadata),
            "completed_at": completed_at,
        },
    )
    return record
