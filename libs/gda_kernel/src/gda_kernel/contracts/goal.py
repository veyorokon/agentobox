from __future__ import annotations

from dataclasses import dataclass, field

from gda_kernel.contracts.target_condition import TargetCondition


def _mapping_to_target_conditions(
    *,
    goal_id: str,
    source_name: str,
    conditions: dict[str, object],
) -> tuple[TargetCondition, ...]:
    return tuple(
        TargetCondition(
            condition_id=f"{goal_id}:{source_name}:{index}",
            dimension_id=str(dimension_id),
            expected_value=expected_value,
        )
        for index, (dimension_id, expected_value) in enumerate(conditions.items(), start=1)
    )


@dataclass(frozen=True, slots=True)
class Goal:
    goal_id: str
    name: str
    description: str = ""
    desired_state: dict[str, object] = field(default_factory=dict)
    satisfaction_criteria: dict[str, object] = field(default_factory=dict)
    target_conditions: tuple[TargetCondition, ...] = ()

    def __post_init__(self) -> None:
        desired_state = {str(key): value for key, value in self.desired_state.items()}
        satisfaction_criteria = {str(key): value for key, value in self.satisfaction_criteria.items()}
        target_conditions = tuple(self.target_conditions)
        if not target_conditions:
            target_conditions = (
                _mapping_to_target_conditions(
                    goal_id=self.goal_id,
                    source_name="desired_state",
                    conditions=desired_state,
                )
                + _mapping_to_target_conditions(
                    goal_id=self.goal_id,
                    source_name="satisfaction_criteria",
                    conditions=satisfaction_criteria,
                )
            )
        object.__setattr__(self, "desired_state", desired_state)
        object.__setattr__(self, "satisfaction_criteria", satisfaction_criteria)
        object.__setattr__(self, "target_conditions", target_conditions)
