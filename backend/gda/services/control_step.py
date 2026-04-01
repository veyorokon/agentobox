from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from gda_kernel import CommitmentProposal

from gda.models import ProjectCommitment, ProjectObservation, ProjectState
from gda.services.commitments import persist_commitment_proposal
from projects.models import Project


def build_control_context(*, project: Project) -> dict[str, object]:
    project_state = ProjectState.objects.get(project=project)
    recent_observations = tuple(
        ProjectObservation.objects.filter(project=project)
        .order_by("-observed_at", "-admitted_at")[:10]
        .values(
            "observation_id",
            "kind",
            "subject",
            "source_kind",
            "source_id",
            "quality",
        )
    )
    active_commitments = tuple(
        ProjectCommitment.objects.filter(project=project)
        .exclude(status__in=("satisfied", "breached", "expired", "canceled", "superseded"))
        .order_by("-created_at")
        .values("commitment_id", "capability_id", "status")
    )
    return {
        "project_id": str(project.id),
        "project_name": project.name,
        "run_id": project_state.run_id,
        "world_ref": project_state.world_ref,
        "status": project_state.status,
        "state_version_id": project_state.state_version_id,
        "facts": dict(project_state.facts),
        "objective": dict(project_state.objective),
        "boundary": dict(project_state.boundary),
        "metadata": dict(project_state.metadata),
        "recent_observations": recent_observations,
        "active_commitments": active_commitments,
    }


def run_control_step(
    *,
    project: Project,
    proposer: Callable[[dict[str, object]], CommitmentProposal | None],
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
        else f"commitment:{project.id}:{context['state_version_id']}"
    )
    return persist_commitment_proposal(
        project=project,
        proposal=proposal,
        commitment_id=commitment_id,
        status="active",
        opened_at=opened_at,
    )
