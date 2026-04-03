from __future__ import annotations

from gda_kernel.contracts.context import (
    AgentTurnBrief,
    CommitmentSummary,
    GDAContextEnvelope,
    GoalProgress,
    ProgressSummary,
    RecentChange,
    StateSignal,
)


def build_agent_turn_brief(
    *,
    envelope: GDAContextEnvelope,
    role: str,
    allowed_actions: tuple[str, ...],
) -> AgentTurnBrief:
    objective = envelope.objective
    return AgentTurnBrief(
        role=role,
        context_version_id=envelope.context_version_id,
        subject_ref=envelope.subject_ref,
        subject_name=envelope.subject_name,
        objective_id=objective.objective_id if objective is not None else "",
        objective_name=objective.name if objective is not None else "",
        goal_names=tuple(goal.name for goal in (objective.goals if objective is not None else ())),
        allowed_actions=allowed_actions,
        allowed_capability_ids=tuple(envelope.boundary.capability_ids if envelope.boundary is not None else ()),
        relevant_state=tuple(
            StateSignal(
                dimension_id=entry.dimension_id,
                value=entry.value,
            )
            for entry in envelope.state_entries
        ),
        active_commitments=tuple(
            CommitmentSummary(
                commitment_id=commitment.commitment_id,
                capability_id=commitment.capability_id,
                status=commitment.status,
            )
            for commitment in envelope.active_commitments
        ),
        recent_changes=tuple(
            RecentChange(
                change_type="observation",
                ref_id=observation.observation_id,
                summary=observation.kind,
                occurred_at=observation.observed_at,
            )
            for observation in envelope.recent_observations[:3]
        ),
        control_status=envelope.awareness.control_status,
        progress=envelope.progress,
    )


def build_agent_turn_brief_from_context(
    *,
    context: dict[str, object],
    role: str,
    allowed_actions: tuple[str, ...],
) -> AgentTurnBrief:
    objective = dict(context.get("objective") or {})
    return AgentTurnBrief(
        role=role,
        context_version_id=str(context.get("context_version_id") or ""),
        subject_ref=str(context.get("subject_ref") or ""),
        subject_name=str(context.get("subject_name") or ""),
        objective_id=str(objective.get("objective_id") or ""),
        objective_name=str(objective.get("name") or ""),
        goal_names=tuple(
            str(goal.get("name") or "")
            for goal in objective.get("goals", [])
            if isinstance(goal, dict)
        ),
        allowed_actions=allowed_actions,
        allowed_capability_ids=tuple(
            str(item)
            for item in dict(context.get("boundary") or {}).get("capability_ids", [])
        ),
        relevant_state=tuple(
            StateSignal(
                dimension_id=str(entry.get("dimension_id") or ""),
                value=entry.get("value"),
            )
            for entry in context.get("state_entries", [])
            if isinstance(entry, dict)
        ),
        active_commitments=tuple(
            CommitmentSummary(
                commitment_id=str(entry.get("commitment_id") or ""),
                capability_id=str(entry.get("capability_id") or ""),
                status=str(entry.get("status") or ""),
            )
            for entry in context.get("active_commitments", [])
            if isinstance(entry, dict)
        ),
        recent_changes=tuple(
            RecentChange(
                change_type="observation",
                ref_id=str(entry.get("observation_id") or ""),
                summary=str(entry.get("kind") or ""),
                occurred_at=None,
            )
            for entry in list(context.get("recent_observations", []))[:3]
            if isinstance(entry, dict)
        ),
        control_status=str(dict(context.get("awareness") or {}).get("control_status") or ""),
        progress=ProgressSummary(
            objective_id=str(dict(context.get("progress") or {}).get("objective_id") or ""),
            status=str(dict(context.get("progress") or {}).get("status") or "idle"),
            total_goals=int(dict(context.get("progress") or {}).get("total_goals") or 0),
            satisfied_goals=int(dict(context.get("progress") or {}).get("satisfied_goals") or 0),
            unknown_goals=int(dict(context.get("progress") or {}).get("unknown_goals") or 0),
            failed_goals=int(dict(context.get("progress") or {}).get("failed_goals") or 0),
            goal_progress=tuple(
                GoalProgress(
                    goal_id=str(goal.get("goal_id") or ""),
                    goal_name=str(goal.get("goal_name") or ""),
                    status=str(goal.get("status") or ""),
                    missing_dimensions=tuple(
                        str(item) for item in goal.get("missing_dimensions", [])
                    ),
                    failed_dimensions=tuple(
                        str(item) for item in goal.get("failed_dimensions", [])
                    ),
                )
                for goal in dict(context.get("progress") or {}).get("goal_progress", [])
                if isinstance(goal, dict)
            ),
        ),
    )


def serialize_agent_turn_brief(brief: AgentTurnBrief) -> dict[str, object]:
    return {
        "brief_type": "gda_agent_turn_brief",
        "role": brief.role,
        "context_version_id": brief.context_version_id,
        "subject_ref": brief.subject_ref,
        "subject_name": brief.subject_name,
        "objective": {
            "objective_id": brief.objective_id,
            "name": brief.objective_name,
            "goal_names": list(brief.goal_names),
        }
        if brief.objective_id
        else {},
        "allowed_actions": list(brief.allowed_actions),
        "allowed_capability_ids": list(brief.allowed_capability_ids),
        "relevant_state": [
            {
                "dimension_id": item.dimension_id,
                "value": item.value,
            }
            for item in brief.relevant_state
        ],
        "active_commitments": [
            {
                "commitment_id": item.commitment_id,
                "capability_id": item.capability_id,
                "status": item.status,
            }
            for item in brief.active_commitments
        ],
        "recent_changes": [
            {
                "change_type": item.change_type,
                "ref_id": item.ref_id,
                "summary": item.summary,
                "occurred_at": item.occurred_at.isoformat() if item.occurred_at is not None else None,
            }
            for item in brief.recent_changes
        ],
        "control_status": brief.control_status,
        "progress": {
            "objective_id": brief.progress.objective_id,
            "status": brief.progress.status,
            "total_goals": brief.progress.total_goals,
            "satisfied_goals": brief.progress.satisfied_goals,
            "unknown_goals": brief.progress.unknown_goals,
            "failed_goals": brief.progress.failed_goals,
            "goal_progress": [
                {
                    "goal_id": goal.goal_id,
                    "goal_name": goal.goal_name,
                    "status": goal.status,
                    "missing_dimensions": list(goal.missing_dimensions),
                    "failed_dimensions": list(goal.failed_dimensions),
                }
                for goal in brief.progress.goal_progress
            ],
        },
    }
