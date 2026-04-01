from __future__ import annotations

from datetime import datetime

from gda_kernel import Commitment, CommitmentProposal

from gda.models import ProjectCommitment, ProjectState
from projects.models import Project

TERMINAL_COMMITMENT_STATUSES = {"satisfied", "failed", "canceled"}


class CommitmentAuthorizationError(ValueError):
    """Raised when a proposed commitment cannot be authorized mechanically."""


def project_commitment_to_contract(record: ProjectCommitment) -> Commitment:
    return Commitment(
        commitment_id=record.commitment_id,
        objective_id=record.objective_id,
        capability_id=record.capability_id,
        arguments=dict(record.arguments),
        touched_scope=tuple(str(item) for item in record.touched_scope),
        status=record.status,
        expected_observation=dict(record.expected_observation),
        expected_outcome=dict(record.expected_outcome),
        opened_at=record.opened_at,
        closed_at=record.closed_at,
        close_reason=record.close_reason or None,
    )


def update_commitment_status(
    *,
    project: Project,
    commitment_id: str,
    status: str,
    close_reason: str | None = None,
    closed_at: datetime | None = None,
) -> ProjectCommitment:
    record = ProjectCommitment.objects.get(project=project, commitment_id=commitment_id)
    record.status = status
    if status in TERMINAL_COMMITMENT_STATUSES:
        record.closed_at = closed_at
        if close_reason is not None:
            record.close_reason = close_reason
    elif close_reason is not None:
        record.close_reason = close_reason
    record.save(update_fields=["status", "closed_at", "close_reason", "updated_at"])
    return record


def _allowed_capability_ids(project: Project) -> tuple[str, ...]:
    project_state = ProjectState.objects.filter(project=project).first()
    if project_state is None:
        raise CommitmentAuthorizationError(
            "project has no canonical ProjectState to authorize commitments against",
        )
    boundary = dict(project_state.boundary)
    return tuple(str(item) for item in boundary.get("capability_ids", ()))


def authorize_commitment(
    *,
    project: Project,
    commitment_id: str,
    activated_at: datetime | None = None,
) -> ProjectCommitment:
    record = ProjectCommitment.objects.get(project=project, commitment_id=commitment_id)
    allowed_capability_ids = _allowed_capability_ids(project)
    if allowed_capability_ids and record.capability_id not in allowed_capability_ids:
        raise CommitmentAuthorizationError(
            f"capability {record.capability_id!r} is not authorized by project boundary",
        )
    record.status = "active"
    if activated_at is not None and record.opened_at is None:
        record.opened_at = activated_at
        update_fields = ["status", "opened_at", "updated_at"]
    else:
        update_fields = ["status", "updated_at"]
    record.save(update_fields=update_fields)
    return record


def persist_commitment_proposal(
    *,
    project: Project,
    proposal: CommitmentProposal,
    commitment_id: str,
    objective_id: str | None = None,
    status: str = "proposed",
    opened_at: datetime | None = None,
) -> ProjectCommitment:
    if objective_id is None:
        project_state = ProjectState.objects.filter(project=project).first()
        if project_state is None:
            raise ValueError("project has no canonical ProjectState to derive objective_id from")
        objective_id = str(project_state.objective.get("objective_id", f"objective:{project.id}"))

    record, _created = ProjectCommitment.objects.update_or_create(
        project=project,
        commitment_id=commitment_id,
        defaults={
            "objective_id": objective_id,
            "capability_id": proposal.capability_id,
            "arguments": dict(proposal.arguments),
            "touched_scope": list(proposal.touched_scope),
            "status": status,
            "expected_observation": dict(proposal.expected_observation),
            "expected_outcome": dict(proposal.expected_outcome),
            "opened_at": opened_at,
        },
    )
    return record
