from __future__ import annotations

from collections.abc import Iterable, Mapping

from gda_kernel import (
    Boundary,
    Observation,
    ObservationAdmissionError,
    ObservationSource,
    admit_observation,
    boundary_ref,
)

from gda.models import ProjectObservation
from projects.models import Project


def _observations_equivalent(record: ProjectObservation, observation: Observation) -> bool:
    return (
        record.kind == observation.kind
        and record.subject == observation.subject
        and record.observed_at == observation.observed_at
        and record.valid_at == observation.valid_at
        and record.expires_at == observation.expires_at
        and record.source_kind == observation.source.kind
        and record.source_id == observation.source.source_id
        and dict(record.payload) == dict(observation.payload)
        and tuple(record.provenance_refs) == tuple(observation.provenance_refs)
        and record.quality == observation.quality
    )


def _boundary_from_project_state(project: Project) -> Boundary | None:
    state = getattr(project, "gda_state", None)
    if state is None or not state.boundary:
        return None
    return Boundary(
        boundary_id=str(state.boundary.get("boundary_id", boundary_ref(project.id))),
        readable_scope=tuple(state.boundary.get("readable_scope", ())),
        writable_scope=tuple(state.boundary.get("writable_scope", ())),
        capability_ids=tuple(state.boundary.get("capability_ids", ())),
        budget=dict(state.boundary.get("budget", {})),
        policy=dict(state.boundary.get("policy", {})),
    )


def project_observation_to_contract(record: ProjectObservation) -> Observation:
    return Observation(
        observation_id=record.observation_id,
        kind=record.kind,
        subject=record.subject,
        observed_at=record.observed_at,
        valid_at=record.valid_at,
        expires_at=record.expires_at,
        source=ObservationSource(kind=record.source_kind, source_id=record.source_id),
        payload=dict(record.payload),
        provenance_refs=tuple(record.provenance_refs),
        quality=record.quality,
    )


def admit_project_observation(
    *,
    project: Project,
    candidate: Observation,
    boundary: Boundary | None = None,
    allowed_kinds: Iterable[str] | None = None,
    allowed_source_kinds: Iterable[str] | None = None,
    known_source_kinds: Iterable[str] | None = None,
    freshness_policy: Mapping[str, object] | None = None,
) -> ProjectObservation:
    effective_boundary = boundary or _boundary_from_project_state(project)
    existing = ProjectObservation.objects.filter(
        project=project,
        observation_id=candidate.observation_id,
    ).first()
    seen_ids = ()
    if existing is None:
        seen_ids = tuple(
            ProjectObservation.objects.filter(project=project).values_list(
                "observation_id",
                flat=True,
            )
        )
    admitted = admit_observation(
        candidate,
        boundary=effective_boundary,
        allowed_kinds=allowed_kinds,
        allowed_source_kinds=allowed_source_kinds,
        known_source_kinds=known_source_kinds,
        known_observation_ids=tuple(seen_ids),
        freshness_policy=freshness_policy,
    )
    if existing is not None:
        if _observations_equivalent(existing, admitted):
            return existing
        raise ObservationAdmissionError(
            f"observation id conflict: {candidate.observation_id}"
        )
    return ProjectObservation.objects.create(
        project=project,
        observation_id=admitted.observation_id,
        kind=admitted.kind,
        subject=admitted.subject,
        observed_at=admitted.observed_at,
        valid_at=admitted.valid_at,
        expires_at=admitted.expires_at,
        source_kind=admitted.source.kind,
        source_id=admitted.source.source_id,
        payload=admitted.payload,
        provenance_refs=list(admitted.provenance_refs),
        quality=admitted.quality,
    )


def admit_project_observations(
    *,
    project: Project,
    candidates: Iterable[Observation],
    boundary: Boundary | None = None,
    allowed_kinds: Iterable[str] | None = None,
    allowed_source_kinds: Iterable[str] | None = None,
    known_source_kinds: Iterable[str] | None = None,
    freshness_policy: Mapping[str, object] | None = None,
) -> tuple[ProjectObservation, ...]:
    created: list[ProjectObservation] = []
    for observation in candidates:
        created.append(
            admit_project_observation(
                project=project,
                candidate=observation,
                boundary=boundary,
                allowed_kinds=allowed_kinds,
                allowed_source_kinds=allowed_source_kinds,
                known_source_kinds=known_source_kinds,
                freshness_policy=freshness_policy,
            )
        )
    return tuple(created)
