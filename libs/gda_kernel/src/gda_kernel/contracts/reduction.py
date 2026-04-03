from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Protocol

from gda_kernel.contracts.assessment import Assessment
from gda_kernel.contracts.execution import ExecutionOutcome
from gda_kernel.contracts.observation import Observation
from gda_kernel.contracts.state import StateEntry


class StateContractError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class DimensionDefinition:
    dimension_id: str
    schema_ref: str
    owner_ref: str


@dataclass(frozen=True, slots=True)
class StateDelta:
    upserts: tuple[StateEntry, ...] = ()
    removes: tuple[str, ...] = ()


class DimensionRegistry:
    def __init__(self, definitions: Iterable[DimensionDefinition]) -> None:
        ordered = tuple(definitions)
        by_id: dict[str, DimensionDefinition] = {}
        for definition in ordered:
            if definition.dimension_id in by_id:
                raise StateContractError(
                    f"duplicate dimension definition: {definition.dimension_id}"
                )
            by_id[definition.dimension_id] = definition
        self._definitions = ordered
        self._by_id = by_id

    def require(self, dimension_id: str) -> DimensionDefinition:
        try:
            return self._by_id[dimension_id]
        except KeyError as exc:
            raise StateContractError(
                f"unregistered dimension: {dimension_id}"
            ) from exc

    def validate_entry(self, entry: StateEntry) -> None:
        definition = self.require(entry.dimension_id)
        if definition.schema_ref != entry.schema_ref:
            raise StateContractError(
                "schema mismatch for "
                f"{entry.dimension_id}: expected {definition.schema_ref}, got {entry.schema_ref}"
            )
        if entry.valid_until is not None and entry.valid_until <= entry.valid_from:
            raise StateContractError(
                f"invalid validity window for {entry.dimension_id}"
            )

    def validate_assessment(self, assessment: Assessment) -> None:
        definition = self.require(assessment.dimension_id)
        if definition.schema_ref != assessment.schema_ref:
            raise StateContractError(
                "schema mismatch for "
                f"{assessment.dimension_id}: expected {definition.schema_ref}, got {assessment.schema_ref}"
            )
        valid_from = assessment.effective_from
        if assessment.valid_until is not None and assessment.valid_until <= valid_from:
            raise StateContractError(
                f"invalid validity window for {assessment.dimension_id}"
            )

    @property
    def definitions(self) -> tuple[DimensionDefinition, ...]:
        return self._definitions


@dataclass(frozen=True, slots=True)
class ReductionContext:
    state_entries: tuple[StateEntry, ...] = ()
    observations: tuple[Observation, ...] = ()
    executions: tuple[ExecutionOutcome, ...] = ()
    assessments: tuple[Assessment, ...] = ()


@dataclass(frozen=True, slots=True)
class EvaluationContext:
    state_entries: tuple[StateEntry, ...] = ()
    observations: tuple[Observation, ...] = ()
    executions: tuple[ExecutionOutcome, ...] = ()
    assessments: tuple[Assessment, ...] = ()


class Reducer(Protocol):
    def reduce(
        self,
        context: ReductionContext,
        *,
        registry: DimensionRegistry,
    ) -> StateDelta: ...


class Evaluator(Protocol):
    def evaluate(
        self,
        context: EvaluationContext,
        *,
        registry: DimensionRegistry,
    ) -> Mapping[str, object]: ...


def apply_state_delta(
    entries: Iterable[StateEntry],
    delta: StateDelta,
    *,
    registry: DimensionRegistry,
) -> tuple[StateEntry, ...]:
    current: dict[str, StateEntry] = {}
    for entry in entries:
        registry.validate_entry(entry)
        if entry.dimension_id in current:
            raise StateContractError(
                f"duplicate state entry: {entry.dimension_id}"
            )
        current[entry.dimension_id] = entry

    for dimension_id in delta.removes:
        registry.require(dimension_id)
        current.pop(dimension_id, None)

    for entry in delta.upserts:
        registry.validate_entry(entry)
        current[entry.dimension_id] = entry

    return tuple(current[dimension_id] for dimension_id in sorted(current))
