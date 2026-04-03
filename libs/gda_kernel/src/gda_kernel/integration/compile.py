from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime

from gda_kernel.contracts import (
    Boundary,
    Goal,
    Objective,
    RunSpec,
    TargetCondition,
    boundary_ref,
    goal_ref,
    objective_ref,
    project_ref,
    run_ref,
)


class CompileError(ValueError):
    """Raised when host-side input cannot be compiled into kernel contracts."""


_MISSING = object()


def _get_value(source: object, *names: str, default: object = _MISSING) -> object:
    if isinstance(source, Mapping):
        for name in names:
            if name in source:
                return source[name]
    else:
        for name in names:
            if hasattr(source, name):
                return getattr(source, name)
    if default is _MISSING:
        raise CompileError(f"missing required field: one of {names!r}")
    return default


def _get_first_present(*candidates: tuple[object, tuple[str, ...]], default: object = _MISSING) -> object:
    for source, names in candidates:
        try:
            return _get_value(source, *names)
        except CompileError:
            continue
    if default is _MISSING:
        field_sets = ", ".join(repr(names) for _, names in candidates)
        raise CompileError(f"missing required field from candidates: {field_sets}")
    return default


def _as_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return (value,)
    return tuple(str(item) for item in value)


def _coerce_mapping(value: object, *, field_name: str) -> dict[str, object]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise CompileError(f"{field_name} must be a mapping when provided")
    return {str(key): item for key, item in value.items()}


def _coerce_metadata(value: object) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise CompileError("metadata must be a mapping when provided")
    return {str(key): str(item) for key, item in value.items()}


def _coerce_target_condition(raw_condition: object, *, goal_id: str, index: int) -> TargetCondition:
    if isinstance(raw_condition, TargetCondition):
        return raw_condition
    if not isinstance(raw_condition, Mapping):
        raise CompileError("target_conditions entries must be TargetCondition objects or mappings")
    dimension_id = str(_get_value(raw_condition, "dimension_id", "dimension_ref"))
    return TargetCondition(
        condition_id=str(
            _get_value(
                raw_condition,
                "condition_id",
                "id",
                default=f"{goal_id}:condition:{index}",
            )
        ),
        dimension_id=dimension_id,
        subject_ref=str(_get_value(raw_condition, "subject_ref", default="")),
        operator=str(_get_value(raw_condition, "operator", default="eq")),
        expected_value=_get_value(raw_condition, "expected_value", "expected", "value"),
    )


def _coerce_target_conditions(raw_conditions: object, *, goal_id: str) -> tuple[TargetCondition, ...]:
    if raw_conditions is None:
        return ()
    if not isinstance(raw_conditions, Sequence) or isinstance(raw_conditions, (str, bytes)):
        raise CompileError("target_conditions must be a sequence of TargetCondition objects or condition-like mappings")
    return tuple(
        _coerce_target_condition(condition, goal_id=goal_id, index=index)
        for index, condition in enumerate(raw_conditions, start=1)
    )


def _coerce_goal(raw_goal: object, *, index: int, project_id: str) -> Goal:
    if isinstance(raw_goal, Goal):
        return raw_goal
    goal_id = str(
        _get_value(
            raw_goal,
            "goal_id",
            "id",
            default=goal_ref(f"{project_id}:{index}"),
        )
    )
    name = str(_get_value(raw_goal, "name", default=goal_id))
    description = str(_get_value(raw_goal, "description", default=""))
    desired_state = _coerce_mapping(_get_value(raw_goal, "desired_state", default={}), field_name="desired_state")
    satisfaction_criteria = _coerce_mapping(
        _get_value(raw_goal, "satisfaction_criteria", default={}),
        field_name="satisfaction_criteria",
    )
    target_conditions = _coerce_target_conditions(
        _get_value(raw_goal, "target_conditions", default=()),
        goal_id=goal_id,
    )
    return Goal(
        goal_id=goal_id,
        name=name,
        description=description,
        desired_state=desired_state,
        satisfaction_criteria=satisfaction_criteria,
        target_conditions=target_conditions,
    )


def _coerce_goals(raw_goals: object, *, project_id: str) -> tuple[Goal, ...]:
    if raw_goals is None:
        return ()
    if not isinstance(raw_goals, Sequence) or isinstance(raw_goals, (str, bytes)):
        raise CompileError("goals must be a sequence of Goal objects or goal-like mappings")
    return tuple(
        _coerce_goal(goal, index=index, project_id=project_id)
        for index, goal in enumerate(raw_goals, start=1)
    )


def compile_project_to_run_spec(
    *,
    project: object,
    task_bundle: object,
    now: datetime,
    world_ref: str,
) -> RunSpec:
    if now.tzinfo is None:
        raise CompileError("now must be timezone-aware")

    project_id = str(_get_first_present((project, ("project_id", "id"))))
    capability_ids = _as_tuple(
        _get_first_present(
            (task_bundle, ("allowed_capabilities", "capability_ids")),
            (project, ("allowed_capabilities", "capability_ids")),
            default=(),
        )
    )
    metadata = _coerce_metadata(
        _get_first_present(
            (task_bundle, ("metadata",)),
            (project, ("metadata",)),
            default={},
        )
    )
    metadata["project_ref"] = project_ref(project_id)
    objective = Objective(
        objective_id=str(_get_value(task_bundle, "objective_id", default=objective_ref(project_id))),
        name=str(_get_value(task_bundle, "title", "name")),
        description=str(_get_value(task_bundle, "description", default="")),
        goals=_coerce_goals(_get_value(task_bundle, "goals", default=()), project_id=project_id),
        success_criteria=_coerce_mapping(
            _get_value(task_bundle, "success_criteria", default={}),
            field_name="success_criteria",
        ),
    )
    boundary = Boundary(
        boundary_id=str(_get_value(task_bundle, "boundary_id", default=boundary_ref(project_id))),
        readable_scope=_as_tuple(_get_value(task_bundle, "readable_scope", default=(world_ref,))),
        writable_scope=_as_tuple(_get_value(task_bundle, "writable_scope", default=())),
        capability_ids=capability_ids,
        budget=_coerce_mapping(_get_value(task_bundle, "budget", default={}), field_name="budget"),
        policy=_coerce_mapping(_get_value(task_bundle, "policy", default={}), field_name="policy"),
    )
    return RunSpec(
        run_id=str(_get_value(task_bundle, "run_id", default=run_ref(project_id))),
        objective=objective,
        boundary=boundary,
        world_ref=world_ref,
        as_of=now,
        evaluator_profile=str(_get_value(task_bundle, "evaluator_profile", default="default")),
        capability_ids=capability_ids,
        metadata=metadata,
    )
