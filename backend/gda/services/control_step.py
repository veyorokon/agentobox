from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from gda_kernel import CommitmentProposal, commitment_ref
from gda_kernel.contracts.context import GDAContextEnvelope

from gda.models import ProjectCommitment
from gda.services.context_envelope import build_gda_context_envelope
from gda.services.commitments import authorize_commitment, persist_commitment_proposal
from projects.models import Project


def build_control_context(*, project: Project) -> GDAContextEnvelope:
    return build_gda_context_envelope(project=project)


def run_control_step(
    *,
    project: Project,
    proposer: Callable[[GDAContextEnvelope], CommitmentProposal | None],
    commitment_id_factory: Callable[[Project], str] | None = None,
    opened_at: datetime | None = None,
) -> ProjectCommitment | None:
    context = build_control_context(project=project)
    proposal = proposer(context)
    if proposal is None:
        return None
    commitment_id = (
        commitment_id_factory(project)
        if commitment_id_factory is not None
        else commitment_ref(f"{project.id}:{context.context_version_id}")
    )
    persist_commitment_proposal(
        project=project,
        proposal=proposal,
        commitment_id=commitment_id,
        status="proposed",
        opened_at=opened_at,
    )
    return authorize_commitment(
        project=project,
        commitment_id=commitment_id,
        activated_at=opened_at,
    )
