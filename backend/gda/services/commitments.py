from __future__ import annotations

from datetime import datetime

from gda_kernel import Commitment, CommitmentProposal

from gda.models import ProjectCommitment, ProjectState
from projects.models import Project


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
