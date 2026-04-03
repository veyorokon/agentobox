from __future__ import annotations

from typing import Any

import strawberry
from strawberry.scalars import JSON

from gda.services.live_overview import build_gda_live_overview
from projects.models import Project


@strawberry.type
class GDAOverviewObjectiveType:
    objective_id: str
    name: str
    description: str


@strawberry.type
class GDAOverviewAwarenessType:
    control_status: str
    state_entry_count: int
    active_commitment_count: int
    recent_observation_count: int
    last_observed_at: str | None


@strawberry.type
class GDAOverviewGoalProgressType:
    goal_id: str
    goal_name: str
    status: str
    missing_dimensions: list[str]
    failed_dimensions: list[str]


@strawberry.type
class GDAOverviewProgressType:
    objective_id: str
    status: str
    total_goals: int
    satisfied_goals: int
    unknown_goals: int
    failed_goals: int
    goal_progress: list[GDAOverviewGoalProgressType]


@strawberry.type
class GDAOverviewStateEntryType:
    dimension_id: str
    value: JSON
    schema_ref: str
    origin: str
    valid_from: str | None
    valid_until: str | None


@strawberry.type
class GDAOverviewCommitmentType:
    commitment_id: str
    capability_id: str
    status: str
    objective_id: str
    assignment_agent_ref: str | None
    assignment_agent_name: str | None


@strawberry.type
class GDAOverviewObservationType:
    observation_id: str
    kind: str
    subject: str
    observed_at: str | None
    source_kind: str
    source_id: str
    quality: str


@strawberry.type
class GDAOverviewExecutionType:
    invocation_id: str
    status: str
    commitment_id: str | None
    created_at: str | None
    completed_at: str | None


@strawberry.type
class GDAOverviewType:
    context_version_id: str
    subject_ref: str
    subject_name: str
    world_ref: str
    objective: GDAOverviewObjectiveType | None
    awareness: GDAOverviewAwarenessType
    progress: GDAOverviewProgressType
    state_entries: list[GDAOverviewStateEntryType]
    active_commitments: list[GDAOverviewCommitmentType]
    recent_observations: list[GDAOverviewObservationType]
    recent_executions: list[GDAOverviewExecutionType]


def _goal_progress_from_mapping(goal: dict[str, Any]) -> GDAOverviewGoalProgressType:
    return GDAOverviewGoalProgressType(
        goal_id=str(goal.get("goal_id") or ""),
        goal_name=str(goal.get("goal_name") or ""),
        status=str(goal.get("status") or ""),
        missing_dimensions=[str(item) for item in goal.get("missing_dimensions", [])],
        failed_dimensions=[str(item) for item in goal.get("failed_dimensions", [])],
    )


def build_gda_overview_type(project: Project) -> GDAOverviewType | None:
    data = build_gda_live_overview(project=project)
    if data is None:
        return None

    objective = data.get("objective")
    awareness = dict(data.get("awareness") or {})
    progress = dict(data.get("progress") or {})

    return GDAOverviewType(
        context_version_id=str(data.get("context_version_id") or ""),
        subject_ref=str(data.get("subject_ref") or ""),
        subject_name=str(data.get("subject_name") or ""),
        world_ref=str(data.get("world_ref") or ""),
        objective=(
            GDAOverviewObjectiveType(
                objective_id=str(objective.get("objective_id") or ""),
                name=str(objective.get("name") or ""),
                description=str(objective.get("description") or ""),
            )
            if isinstance(objective, dict)
            else None
        ),
        awareness=GDAOverviewAwarenessType(
            control_status=str(awareness.get("control_status") or ""),
            state_entry_count=int(awareness.get("state_entry_count") or 0),
            active_commitment_count=int(awareness.get("active_commitment_count") or 0),
            recent_observation_count=int(awareness.get("recent_observation_count") or 0),
            last_observed_at=(
                str(awareness.get("last_observed_at"))
                if awareness.get("last_observed_at") is not None
                else None
            ),
        ),
        progress=GDAOverviewProgressType(
            objective_id=str(progress.get("objective_id") or ""),
            status=str(progress.get("status") or ""),
            total_goals=int(progress.get("total_goals") or 0),
            satisfied_goals=int(progress.get("satisfied_goals") or 0),
            unknown_goals=int(progress.get("unknown_goals") or 0),
            failed_goals=int(progress.get("failed_goals") or 0),
            goal_progress=[
                _goal_progress_from_mapping(item)
                for item in progress.get("goal_progress", [])
                if isinstance(item, dict)
            ],
        ),
        state_entries=[
            GDAOverviewStateEntryType(
                dimension_id=str(item.get("dimension_id") or ""),
                value=item.get("value"),
                schema_ref=str(item.get("schema_ref") or ""),
                origin=str(item.get("origin") or ""),
                valid_from=str(item.get("valid_from")) if item.get("valid_from") is not None else None,
                valid_until=str(item.get("valid_until")) if item.get("valid_until") is not None else None,
            )
            for item in data.get("state_entries", [])
            if isinstance(item, dict)
        ],
        active_commitments=[
            GDAOverviewCommitmentType(
                commitment_id=str(item.get("commitment_id") or ""),
                capability_id=str(item.get("capability_id") or ""),
                status=str(item.get("status") or ""),
                objective_id=str(item.get("objective_id") or ""),
                assignment_agent_ref=(
                    str(item.get("assignment_agent_ref"))
                    if item.get("assignment_agent_ref") is not None
                    else None
                ),
                assignment_agent_name=(
                    str(item.get("assignment_agent_name"))
                    if item.get("assignment_agent_name") is not None
                    else None
                ),
            )
            for item in data.get("active_commitments", [])
            if isinstance(item, dict)
        ],
        recent_observations=[
            GDAOverviewObservationType(
                observation_id=str(item.get("observation_id") or ""),
                kind=str(item.get("kind") or ""),
                subject=str(item.get("subject") or ""),
                observed_at=str(item.get("observed_at")) if item.get("observed_at") is not None else None,
                source_kind=str(item.get("source_kind") or ""),
                source_id=str(item.get("source_id") or ""),
                quality=str(item.get("quality") or ""),
            )
            for item in data.get("recent_observations", [])
            if isinstance(item, dict)
        ],
        recent_executions=[
            GDAOverviewExecutionType(
                invocation_id=str(item.get("invocation_id") or ""),
                status=str(item.get("status") or ""),
                commitment_id=str(item.get("commitment_id")) if item.get("commitment_id") is not None else None,
                created_at=str(item.get("created_at")) if item.get("created_at") is not None else None,
                completed_at=str(item.get("completed_at")) if item.get("completed_at") is not None else None,
            )
            for item in data.get("recent_executions", [])
            if isinstance(item, dict)
        ],
    )
