from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

from gda_kernel import ExecutionOutcome, Observation

from gda.models import ProjectCommitment, ProjectExecution, ProjectObservation
from gda.services.admission import admit_project_observations
from gda.services.commitments import update_commitment_status
from gda.services.execution import record_execution_outcome
from projects.models import Project


@dataclass(frozen=True, slots=True)
class RuntimeCompletionResult:
    execution: ProjectExecution
    observations: tuple[ProjectObservation, ...]
    commitment: ProjectCommitment | None


def _is_required(expectation: Mapping[str, object] | None) -> bool:
    if not expectation:
        return False
    return bool(expectation.get("required", False))


def _expected_status(expectation: Mapping[str, object] | None) -> str | None:
    if not expectation:
        return None
    value = expectation.get("status")
    return str(value) if value is not None else None


def _expected_observation_kind(expectation: Mapping[str, object] | None) -> str | None:
    if not expectation:
        return None
    value = expectation.get("kind")
    return str(value) if value is not None else None


def _resolve_commitment_transition(
    *,
    commitment: ProjectCommitment,
    outcome: ExecutionOutcome,
    admitted_observations: tuple[ProjectObservation, ...],
    completed_at: datetime | None,
) -> ProjectCommitment:
    expected_outcome = dict(commitment.expected_outcome)
    expected_observation = dict(commitment.expected_observation)
    required_outcome = _is_required(expected_outcome)
    required_observation = _is_required(expected_observation)
    expected_status = _expected_status(expected_outcome)
    expected_kind = _expected_observation_kind(expected_observation)

    if required_outcome and expected_status is not None and outcome.status != expected_status:
        return update_commitment_status(
            project=commitment.project,
            commitment_id=commitment.commitment_id,
            status="failed",
            close_reason=f"outcome_status_mismatch:{expected_status}",
            closed_at=completed_at,
        )

    if outcome.status != "ok" and not required_outcome:
        return update_commitment_status(
            project=commitment.project,
            commitment_id=commitment.commitment_id,
            status="failed",
            close_reason=f"execution_status:{outcome.status}",
            closed_at=completed_at,
        )

    if required_observation and expected_kind is not None:
        matched = any(observation.kind == expected_kind for observation in admitted_observations)
        if not matched:
            return update_commitment_status(
                project=commitment.project,
                commitment_id=commitment.commitment_id,
                status="failed",
                close_reason=f"missing_observation:{expected_kind}",
                closed_at=completed_at,
            )

    return update_commitment_status(
        project=commitment.project,
        commitment_id=commitment.commitment_id,
        status="satisfied",
        close_reason="completed",
        closed_at=completed_at,
    )


def process_runtime_completion(
    *,
    project: Project,
    outcome: ExecutionOutcome,
    observations: Iterable[Observation] = (),
    completed_at: datetime | None = None,
    allowed_kinds: Iterable[str] | None = None,
    allowed_source_kinds: Iterable[str] | None = None,
    known_source_kinds: Iterable[str] | None = None,
    freshness_policy: Mapping[str, object] | None = None,
) -> RuntimeCompletionResult:
    execution = record_execution_outcome(
        project=project,
        outcome=outcome,
        completed_at=completed_at,
    )
    admitted_observations = admit_project_observations(
        project=project,
        candidates=tuple(observations),
        allowed_kinds=allowed_kinds,
        allowed_source_kinds=allowed_source_kinds,
        known_source_kinds=known_source_kinds,
        freshness_policy=freshness_policy,
    )

    commitment = None
    if outcome.commitment_id:
        matched = ProjectCommitment.objects.filter(
            project=project,
            commitment_id=outcome.commitment_id,
        ).first()
        if matched is not None:
            commitment = _resolve_commitment_transition(
                commitment=matched,
                outcome=outcome,
                admitted_observations=admitted_observations,
                completed_at=completed_at,
            )

    return RuntimeCompletionResult(
        execution=execution,
        observations=admitted_observations,
        commitment=commitment,
    )
