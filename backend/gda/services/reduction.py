from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from django.db import transaction

from gda.models import ProjectState, ProjectStateEntry
from gda_kernel import (
    DimensionRegistry,
    StateDelta,
    StateVersion,
    apply_state_delta,
)
from gda_kernel.contracts.state import StateEntry
from projects.models import Project


def project_state_entry_to_contract(record: ProjectStateEntry) -> StateEntry:
    return StateEntry(
        dimension_id=record.dimension_id,
        value=record.value,
        schema_ref=record.schema_ref,
        origin=record.origin,
        valid_from=record.valid_from,
        valid_until=record.valid_until,
        provenance_refs=tuple(str(item) for item in record.provenance_refs),
    )


def list_project_state_entries(*, project: Project) -> tuple[StateEntry, ...]:
    records = ProjectStateEntry.objects.filter(project=project).order_by("dimension_id")
    return tuple(project_state_entry_to_contract(record) for record in records)


@transaction.atomic
def apply_project_state_delta(
    *,
    project: Project,
    delta: StateDelta,
    registry: DimensionRegistry,
    version: StateVersion,
) -> tuple[ProjectStateEntry, ...]:
    current_records = tuple(
        ProjectStateEntry.objects.select_for_update()
        .filter(project=project)
        .order_by("dimension_id")
    )
    current_entries = tuple(project_state_entry_to_contract(record) for record in current_records)
    next_entries = apply_state_delta(current_entries, delta, registry=registry)

    by_dimension = {record.dimension_id: record for record in current_records}
    next_ids = {entry.dimension_id for entry in next_entries}

    for dimension_id, record in by_dimension.items():
        if dimension_id not in next_ids:
            record.delete()

    persisted: list[ProjectStateEntry] = []
    for entry in next_entries:
        record, _created = ProjectStateEntry.objects.update_or_create(
            project=project,
            dimension_id=entry.dimension_id,
            defaults={
                "schema_ref": entry.schema_ref,
                "origin": entry.origin,
                "value": entry.value,
                "valid_from": entry.valid_from,
                "valid_until": entry.valid_until,
                "provenance_refs": list(entry.provenance_refs),
                "state_version_id": version.version_id,
            },
        )
        persisted.append(record)

    ProjectState.objects.filter(project=project).update(
        state_version_id=version.version_id,
        observed_at=version.observed_at,
        source_refs=list(version.source_refs),
    )

    return tuple(persisted)
