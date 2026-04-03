from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TargetCondition:
    dimension_id: str
    expected_value: object
    operator: str = "eq"
    subject_ref: str = ""
    condition_id: str = ""
