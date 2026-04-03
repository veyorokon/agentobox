from __future__ import annotations

from datetime import datetime

from gda_kernel import Commitment, CommitmentProposal, objective_ref

from gda.models import ProjectCommitment, ProjectState
from projects.models import Project

TERMINAL_COMMITMENT_STATUSES = {"satisfied", "failed", "canceled"}
ALLOWED_COMMITMENT_TRANSITIONS = {
    "proposed": {"proposed", "active", "canceled"},
    "active": {"active", "satisfied", "failed", "canceled"},
    "satisfied": {"satisfied"},
    "failed": {"failed"},
    "canceled": {"canceled"},
}


class CommitmentAuthorizationError(ValueError):
    """Raised when a proposed commitment cannot be authorized mechanically."""


class CommitmentConflictError(ValueError):
    """Raised when a commitment id is reused or transitioned incompatibly."""


def _commitments_equivalent(
    record: ProjectCommitment,
    *,
    objective_id: str,
    proposal: CommitmentProposal,
    status: str,
    opened_at: datetime | None,
) -> bool:
    status_equivalent = record.status == status or (
        status == "proposed" and record.status == "active"
    )
    return (
        record.objective_id == objective_id
        and record.capability_id == proposal.capability_id
        and dict(record.arguments) == dict(proposal.arguments)
        and tuple(str(item) for item in record.touched_scope) == tuple(proposal.touched_scope)
        and status_equivalent
        and dict(record.expected_observation) == dict(proposal.expected_observation)
        and dict(record.expected_outcome) == dict(proposal.expected_outcome)
        and record.opened_at == opened_at
    )


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
    allowed_transitions = ALLOWED_COMMITMENT_TRANSITIONS.get(record.status, set())
    if status not in allowed_transitions:
        raise CommitmentConflictError(
            f"invalid commitment transition: {record.status} -> {status}"
        )
    expected_closed_at = closed_at if status in TERMINAL_COMMITMENT_STATUSES else record.closed_at
    expected_close_reason = close_reason if close_reason is not None else record.close_reason
    if (
        record.status == status
        and record.closed_at == expected_closed_at
        and record.close_reason == expected_close_reason
    ):
        return record
    record.status = status
    if status in TERMINAL_COMMITMENT_STATUSES:
        if record.closed_at is not None and closed_at is not None and record.closed_at != closed_at:
            raise CommitmentConflictError(
                f"terminal commitment {commitment_id} closed_at conflict"
            )
        if record.close_reason and close_reason is not None and record.close_reason != close_reason:
            raise CommitmentConflictError(
                f"terminal commitment {commitment_id} close_reason conflict"
            )
        if record.closed_at is None:
            record.closed_at = closed_at
        if close_reason is not None and not record.close_reason:
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
    if record.status == "active":
        return record
    if record.status in TERMINAL_COMMITMENT_STATUSES:
        raise CommitmentConflictError(
            f"cannot authorize terminal commitment {commitment_id} from status {record.status}"
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
        objective_id = str(project_state.objective.get("objective_id", objective_ref(project.id)))

    existing = ProjectCommitment.objects.filter(
        project=project,
        commitment_id=commitment_id,
    ).first()
    if existing is not None:
        if _commitments_equivalent(
            existing,
            objective_id=objective_id,
            proposal=proposal,
            status=status,
            opened_at=opened_at,
        ):
            return existing
        raise CommitmentConflictError(f"commitment id conflict: {commitment_id}")

    record = ProjectCommitment.objects.create(
        project=project,
        commitment_id=commitment_id,
        objective_id=objective_id,
        capability_id=proposal.capability_id,
        arguments=dict(proposal.arguments),
        touched_scope=list(proposal.touched_scope),
        status=status,
        expected_observation=dict(proposal.expected_observation),
        expected_outcome=dict(proposal.expected_outcome),
        opened_at=opened_at,
    )
    return record
