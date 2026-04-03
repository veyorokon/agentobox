from __future__ import annotations

from agents.models import Agent

from gda.models import ProjectCommitment, ProjectCommitmentAssignment
from projects.models import Project


def assign_project_commitment(
    *,
    project: Project,
    commitment_id: str,
    agent: Agent,
    dimension_ids: tuple[str, ...] | list[str] = (),
    observation_kinds: tuple[str, ...] | list[str] = (),
) -> ProjectCommitmentAssignment:
    if str(agent.project_id) != str(project.id):
        raise ValueError("agent must belong to the same project as the assignment")

    commitment = ProjectCommitment.objects.get(project=project, commitment_id=commitment_id)
    assignment, _created = ProjectCommitmentAssignment.objects.update_or_create(
        project=project,
        commitment=commitment,
        defaults={
            "agent": agent,
            "dimension_ids": [str(item) for item in dimension_ids],
            "observation_kinds": [str(item) for item in observation_kinds],
        },
    )
    return assignment


def list_active_assignments_for_agent(*, agent: Agent) -> tuple[ProjectCommitmentAssignment, ...]:
    return tuple(
        ProjectCommitmentAssignment.objects.select_related("commitment")
        .filter(
            project_id=agent.project_id,
            agent=agent,
            commitment__status__in=("proposed", "active"),
        )
        .order_by("assigned_at")
    )
