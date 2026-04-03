from __future__ import annotations

from datetime import datetime

from gda_kernel import ExecutionOutcome

from gda.models import ProjectCommitment, ProjectExecution
from projects.models import Project


class ExecutionConflictError(ValueError):
    """Raised when an invocation id is reused with conflicting canonical content."""


def _executions_equivalent(
    record: ProjectExecution,
    *,
    commitment: ProjectCommitment | None,
    outcome: ExecutionOutcome,
    completed_at: datetime | None,
) -> bool:
    return (
        record.commitment_id == (commitment.id if commitment is not None else None)
        and record.status == outcome.status
        and dict(record.resource_usage) == dict(outcome.resource_usage)
        and tuple(str(ref) for ref in record.artifact_refs) == tuple(outcome.artifact_refs)
        and dict(record.metadata) == dict(outcome.metadata)
        and record.completed_at == completed_at
    )


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

    existing = ProjectExecution.objects.filter(
        project=project,
        invocation_id=outcome.invocation_id,
    ).first()
    if existing is not None:
        if _executions_equivalent(
            existing,
            commitment=commitment,
            outcome=outcome,
            completed_at=completed_at,
        ):
            return existing
        raise ExecutionConflictError(
            f"execution invocation conflict: {outcome.invocation_id}"
        )

    record = ProjectExecution.objects.create(
        project=project,
        commitment=commitment,
        invocation_id=outcome.invocation_id,
        status=outcome.status,
        resource_usage=dict(outcome.resource_usage),
        artifact_refs=list(outcome.artifact_refs),
        metadata=dict(outcome.metadata),
        completed_at=completed_at,
    )
    return record
