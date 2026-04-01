from __future__ import annotations

from collections.abc import Iterable, Mapping

from gda_kernel import (
    Boundary,
    Observation,
    ObservationSource,
    admit_observation,
    admit_observations,
)

from gda.models import ProjectObservation
from projects.models import Project


def _boundary_from_project_state(project: Project) -> Boundary | None:
    state = getattr(project, "gda_state", None)
    if state is None or not state.boundary:
        return None
    return Boundary(
        boundary_id=str(state.boundary.get("boundary_id", f"boundary:{project.id}")),
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
    seen_ids = ProjectObservation.objects.filter(project=project).values_list(
        "observation_id",
        flat=True,
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
    effective_boundary = boundary or _boundary_from_project_state(project)
    seen_ids = tuple(
        ProjectObservation.objects.filter(project=project).values_list(
            "observation_id",
            flat=True,
        )
    )
    admitted = admit_observations(
        candidates,
        boundary=effective_boundary,
        allowed_kinds=allowed_kinds,
        allowed_source_kinds=allowed_source_kinds,
        known_source_kinds=known_source_kinds,
        known_observation_ids=seen_ids,
        freshness_policy=freshness_policy,
    )
    created: list[ProjectObservation] = []
    for observation in admitted:
        created.append(
            ProjectObservation.objects.create(
                project=project,
                observation_id=observation.observation_id,
                kind=observation.kind,
                subject=observation.subject,
                observed_at=observation.observed_at,
                valid_at=observation.valid_at,
                expires_at=observation.expires_at,
                source_kind=observation.source.kind,
                source_id=observation.source.source_id,
                payload=observation.payload,
                provenance_refs=list(observation.provenance_refs),
                quality=observation.quality,
            )
        )
    return tuple(created)
