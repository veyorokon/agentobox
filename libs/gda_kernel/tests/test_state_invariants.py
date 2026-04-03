from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gda_kernel import (
    DimensionDefinition,
    DimensionRegistry,
    StateContractError,
    StateDelta,
    StateEntry,
    apply_state_delta,
)


def test_dimension_ids_are_treated_as_opaque_exact_identifiers() -> None:
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="trade.floor",
                schema_ref="estimate.scalar.v1",
                owner_ref="world://trading",
            ),
            DimensionDefinition(
                dimension_id="trade.floor_assessment",
                schema_ref="estimate.scalar.v1",
                owner_ref="world://trading",
            ),
        )
    )
    entries = (
        StateEntry(
            dimension_id="trade.floor",
            value={"score": 0.42},
            schema_ref="estimate.scalar.v1",
            origin="estimated",
            valid_from=now,
        ),
        StateEntry(
            dimension_id="trade.floor_assessment",
            value={"score": 0.77},
            schema_ref="estimate.scalar.v1",
            origin="derived",
            valid_from=now,
        ),
    )

    result = apply_state_delta(
        entries,
        StateDelta(removes=("trade.floor",)),
        registry=registry,
    )

    assert tuple(entry.dimension_id for entry in result) == ("trade.floor_assessment",)
    assert result[0].value == {"score": 0.77}


def test_schema_version_is_checked_exactly_not_by_family_name() -> None:
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="runtime.health",
                schema_ref="status.readiness.v2",
                owner_ref="world://ops",
            ),
        )
    )

    with pytest.raises(StateContractError, match="schema mismatch"):
        registry.validate_entry(
            StateEntry(
                dimension_id="runtime.health",
                value={"status": "ready"},
                schema_ref="status.readiness.v1",
                origin="observed",
                valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            )
        )


def test_unregistered_remove_is_rejected_at_the_contract_boundary() -> None:
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="game.loop.playable",
                schema_ref="status.playable_build.v1",
                owner_ref="world://game",
            ),
        )
    )

    with pytest.raises(StateContractError, match="unregistered dimension"):
        apply_state_delta(
            (),
            StateDelta(removes=("game.loop.secret_internal_flag",)),
            registry=registry,
        )


def test_owner_ref_is_registry_metadata_not_runtime_semantics() -> None:
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="show.pilot.script_status",
                schema_ref="status.script_revision.v1",
                owner_ref="world://tv-room-a",
            ),
        )
    )

    result = apply_state_delta(
        (),
        StateDelta(
            upserts=(
                StateEntry(
                    dimension_id="show.pilot.script_status",
                    value={"status": "revised"},
                    schema_ref="status.script_revision.v1",
                    origin="declared",
                    valid_from=now,
                    provenance_refs=("artifact:draft-5",),
                ),
            )
        ),
        registry=registry,
    )

    assert len(result) == 1
    assert result[0].dimension_id == "show.pilot.script_status"
    assert registry.require("show.pilot.script_status").owner_ref == "world://tv-room-a"
