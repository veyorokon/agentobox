from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from datetime import datetime

from gda_kernel.contracts import Boundary, Observation, ObservationFreshnessPolicy


class ObservationAdmissionError(ValueError):
    """Raised when a proposed observation cannot be admitted canonically."""


def _resolve_freshness_policy(
    *,
    boundary: Boundary | None,
    freshness_policy: ObservationFreshnessPolicy | Mapping[str, object] | None,
) -> ObservationFreshnessPolicy:
    if freshness_policy is None:
        raw_policy = boundary.policy if boundary is not None else {}
        candidate = raw_policy.get("observation_freshness", {}) if isinstance(raw_policy, Mapping) else {}
        return ObservationFreshnessPolicy.from_mapping(candidate) if candidate else ObservationFreshnessPolicy()
    if isinstance(freshness_policy, ObservationFreshnessPolicy):
        return freshness_policy
    return ObservationFreshnessPolicy.from_mapping(freshness_policy)


def admit_observation(
    candidate: Observation,
    *,
    as_of: datetime | None = None,
    now: datetime | None = None,
    boundary: Boundary | None = None,
    allowed_kinds: Iterable[str] | None = None,
    allowed_source_kinds: Iterable[str] | None = None,
    known_source_kinds: Iterable[str] | None = None,
    known_observation_ids: Iterable[str] | None = None,
    seen_observation_ids: Collection[str] | None = None,
    freshness_policy: ObservationFreshnessPolicy | Mapping[str, object] | None = None,
) -> Observation:
    if not candidate.observation_id:
        raise ObservationAdmissionError("observation_id required")
    if not candidate.kind:
        raise ObservationAdmissionError("kind required")
    if not candidate.subject:
        raise ObservationAdmissionError("subject required")
    if not candidate.source.kind:
        raise ObservationAdmissionError("source.kind required")
    if not candidate.source.source_id:
        raise ObservationAdmissionError("source.source_id required")

    duplicate_ids = set(known_observation_ids or ())
    if seen_observation_ids is not None:
        duplicate_ids.update(seen_observation_ids)
    if candidate.observation_id in duplicate_ids:
        raise ObservationAdmissionError(f"duplicate observation_id {candidate.observation_id!r}")

    if allowed_kinds is not None and candidate.kind not in set(allowed_kinds):
        raise ObservationAdmissionError(f"observation kind {candidate.kind!r} not allowed")

    source_kinds = (
        set(allowed_source_kinds)
        if allowed_source_kinds is not None
        else (set(known_source_kinds) if known_source_kinds is not None else None)
    )
    if source_kinds is not None and candidate.source.kind not in source_kinds:
        raise ObservationAdmissionError(f"observation source kind {candidate.source.kind!r} not allowed")

    policy = _resolve_freshness_policy(boundary=boundary, freshness_policy=freshness_policy)
    effective_as_of = as_of or now or candidate.observed_at
    if effective_as_of.tzinfo is None:
        raise ObservationAdmissionError("admission comparison time must be timezone-aware")
    if policy.require_provenance and not candidate.provenance_refs:
        raise ObservationAdmissionError("provenance required")
    if policy.reject_future and candidate.effective_at > effective_as_of:
        raise ObservationAdmissionError("future observations are not allowed")
    if policy.reject_expired and candidate.is_expired_at(effective_as_of):
        raise ObservationAdmissionError("expired observations are not allowed")
    return candidate


def admit_observations(
    candidates: Iterable[Observation],
    *,
    as_of: datetime | None = None,
    now: datetime | None = None,
    boundary: Boundary | None = None,
    allowed_kinds: Iterable[str] | None = None,
    allowed_source_kinds: Iterable[str] | None = None,
    known_source_kinds: Iterable[str] | None = None,
    known_observation_ids: Iterable[str] | None = None,
    seen_observation_ids: Collection[str] | None = None,
    freshness_policy: ObservationFreshnessPolicy | Mapping[str, object] | None = None,
) -> tuple[Observation, ...]:
    admitted: list[Observation] = []
    seen_ids = set(known_observation_ids or ())
    if seen_observation_ids is not None:
        seen_ids.update(seen_observation_ids)
    for candidate in candidates:
        admitted_candidate = admit_observation(
            candidate,
            as_of=as_of,
            now=now,
            boundary=boundary,
            allowed_kinds=allowed_kinds,
            allowed_source_kinds=allowed_source_kinds,
            known_source_kinds=known_source_kinds,
            known_observation_ids=seen_ids,
            freshness_policy=freshness_policy,
        )
        admitted.append(admitted_candidate)
        seen_ids.add(admitted_candidate.observation_id)
    return tuple(admitted)
