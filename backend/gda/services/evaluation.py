from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from gda_kernel import Goal, Objective, TargetCondition
from gda_kernel.contracts.state import StateEntry


@dataclass(frozen=True, slots=True)
class GoalEvaluationResult:
    goal_id: str
    goal_name: str
    status: str
    missing_dimensions: tuple[str, ...] = ()
    failed_dimensions: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ObjectiveEvaluationResult:
    objective_id: str
    status: str
    total_goals: int
    satisfied_goals: int
    unknown_goals: int
    failed_goals: int
    goal_progress: tuple[GoalEvaluationResult, ...] = ()


def _matches_expected(*, actual: object, expected: object) -> bool:
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        for key, expected_value in expected.items():
            if key not in actual:
                return False
            if not _matches_expected(actual=actual[key], expected=expected_value):
                return False
        return True
    if isinstance(expected, (list, tuple)):
        return actual == expected
    return actual == expected


def _condition_matches(*, actual: object, condition: TargetCondition) -> bool:
    operator = condition.operator or "eq"
    if operator == "eq":
        return _matches_expected(actual=actual, expected=condition.expected_value)
    if operator == "neq":
        return not _matches_expected(actual=actual, expected=condition.expected_value)
    if operator == "contains":
        if isinstance(actual, str) and isinstance(condition.expected_value, str):
            return condition.expected_value in actual
        if isinstance(actual, (list, tuple, set)):
            return condition.expected_value in actual
        if isinstance(actual, dict) and isinstance(condition.expected_value, str):
            return condition.expected_value in actual
        return False
    if operator == "gte":
        return bool(actual >= condition.expected_value)
    if operator == "gt":
        return bool(actual > condition.expected_value)
    if operator == "lte":
        return bool(actual <= condition.expected_value)
    if operator == "lt":
        return bool(actual < condition.expected_value)
    raise ValueError(f"unsupported target condition operator: {operator}")


def _state_value(
    *,
    dimension_id: str,
    by_dimension: dict[str, StateEntry],
    legacy_facts: dict[str, object],
) -> tuple[bool, object]:
    entry = by_dimension.get(dimension_id)
    if entry is not None:
        return True, entry.value
    if dimension_id in legacy_facts:
        return True, legacy_facts[dimension_id]
    return False, None


def evaluate_goal(
    *,
    goal: Goal,
    by_dimension: dict[str, StateEntry],
    legacy_facts: dict[str, object],
) -> GoalEvaluationResult:
    missing: list[str] = []
    failed: list[str] = []
    for condition in goal.target_conditions:
        present, actual = _state_value(
            dimension_id=str(condition.dimension_id),
            by_dimension=by_dimension,
            legacy_facts=legacy_facts,
        )
        if not present:
            missing.append(str(condition.dimension_id))
            continue
        if not _condition_matches(actual=actual, condition=condition):
            failed.append(str(condition.dimension_id))
    if failed:
        status = "unsatisfied"
    elif missing:
        status = "unknown"
    else:
        status = "satisfied"
    return GoalEvaluationResult(
        goal_id=goal.goal_id,
        goal_name=goal.name,
        status=status,
        missing_dimensions=tuple(missing),
        failed_dimensions=tuple(failed),
    )


def evaluate_objective(
    *,
    objective: Objective | None,
    state_entries: tuple[StateEntry, ...],
    legacy_facts: dict[str, object],
) -> ObjectiveEvaluationResult:
    if objective is None:
        return ObjectiveEvaluationResult(
            objective_id="",
            status="idle",
            total_goals=0,
            satisfied_goals=0,
            unknown_goals=0,
            failed_goals=0,
            goal_progress=(),
        )

    by_dimension = {entry.dimension_id: entry for entry in state_entries}
    goal_progress = tuple(
        evaluate_goal(goal=goal, by_dimension=by_dimension, legacy_facts=legacy_facts)
        for goal in objective.goals
    )
    satisfied_goals = sum(1 for result in goal_progress if result.status == "satisfied")
    unknown_goals = sum(1 for result in goal_progress if result.status == "unknown")
    failed_goals = sum(1 for result in goal_progress if result.status == "unsatisfied")
    total_goals = len(goal_progress)

    if total_goals == 0:
        status = "idle"
    elif failed_goals:
        status = "in_progress"
    elif unknown_goals:
        status = "unknown"
    elif satisfied_goals == total_goals:
        status = "satisfied"
    else:
        status = "in_progress"

    return ObjectiveEvaluationResult(
        objective_id=objective.objective_id,
        status=status,
        total_goals=total_goals,
        satisfied_goals=satisfied_goals,
        unknown_goals=unknown_goals,
        failed_goals=failed_goals,
        goal_progress=goal_progress,
    )
