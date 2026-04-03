from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gda_kernel import (
    Assessment,
    DimensionDefinition,
    DimensionRegistry,
    StateContractError,
    StateDelta,
    StateEntry,
    apply_state_delta,
)


SCENARIO_MATRIX = (
    (
        "game_creation",
        DimensionDefinition(
            dimension_id="game.loop.playable",
            schema_ref="status.playable_build.v1",
            owner_ref="world://game",
        ),
        StateEntry(
            dimension_id="game.loop.playable",
            value={"playable": True, "build_ref": "artifact:build-17"},
            schema_ref="status.playable_build.v1",
            origin="observed",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("obs:build-17",),
        ),
    ),
    (
        "robotics",
        DimensionDefinition(
            dimension_id="robot.pose",
            schema_ref="measurement.pose_2d.v1",
            owner_ref="world://robotics",
        ),
        StateEntry(
            dimension_id="robot.pose",
            value={"x": 1.2, "y": 4.9, "heading_deg": 90},
            schema_ref="measurement.pose_2d.v1",
            origin="observed",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("obs:lidar-12",),
        ),
    ),
    (
        "digital_art",
        DimensionDefinition(
            dimension_id="art.direction.style_alignment",
            schema_ref="estimate.alignment_score.v1",
            owner_ref="world://art",
        ),
        StateEntry(
            dimension_id="art.direction.style_alignment",
            value={"score": 0.74, "reference_set": ["ref:1", "ref:2"]},
            schema_ref="estimate.alignment_score.v1",
            origin="estimated",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("artifact:moodboard-4",),
        ),
    ),
    (
        "tv_show",
        DimensionDefinition(
            dimension_id="show.pilot.script_status",
            schema_ref="status.script_revision.v1",
            owner_ref="world://tv",
        ),
        StateEntry(
            dimension_id="show.pilot.script_status",
            value={"status": "revised"},
            schema_ref="status.script_revision.v1",
            origin="declared",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("artifact:draft-5",),
        ),
    ),
    (
        "scientific_lab",
        DimensionDefinition(
            dimension_id="experiment.batch_12.qc_status",
            schema_ref="status.qc_pass_fail.v1",
            owner_ref="world://lab",
        ),
        StateEntry(
            dimension_id="experiment.batch_12.qc_status",
            value={"status": "passed"},
            schema_ref="status.qc_pass_fail.v1",
            origin="observed",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("obs:qc-7",),
        ),
    ),
    (
        "comedy_tour",
        DimensionDefinition(
            dimension_id="tour.route_efficiency",
            schema_ref="estimate.route_efficiency.v1",
            owner_ref="world://tour",
        ),
        StateEntry(
            dimension_id="tour.route_efficiency",
            value={"score": 0.83, "fuel_cost_estimate": 4200},
            schema_ref="estimate.route_efficiency.v1",
            origin="derived",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("artifact:route-plan-2",),
        ),
    ),
    (
        "sentient_whales",
        DimensionDefinition(
            dimension_id="corridor.alpha.treaty_status",
            schema_ref="status.treaty_lifecycle.v1",
            owner_ref="world://cetacean-diplomacy",
        ),
        StateEntry(
            dimension_id="corridor.alpha.treaty_status",
            value={"status": "pending_ratification"},
            schema_ref="status.treaty_lifecycle.v1",
            origin="declared",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("artifact:treaty-draft-1",),
        ),
    ),
    (
        "theme_park",
        DimensionDefinition(
            dimension_id="ride.coaster_7.operational_status",
            schema_ref="status.ride_ops.v1",
            owner_ref="world://theme-park",
        ),
        StateEntry(
            dimension_id="ride.coaster_7.operational_status",
            value={"status": "closed_weather"},
            schema_ref="status.ride_ops.v1",
            origin="observed",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("obs:weather-closure-3",),
        ),
    ),
    (
        "film_editing",
        DimensionDefinition(
            dimension_id="edit.cut_v5.lock_status",
            schema_ref="status.edit_lock.v1",
            owner_ref="world://film",
        ),
        StateEntry(
            dimension_id="edit.cut_v5.lock_status",
            value={"status": "picture_lock_pending"},
            schema_ref="status.edit_lock.v1",
            origin="declared",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("artifact:edit-note-8",),
        ),
    ),
    (
        "dragon_breeding",
        DimensionDefinition(
            dimension_id="lineage.obsidian.temperament_stability",
            schema_ref="estimate.lineage_trait_score.v1",
            owner_ref="world://mythical-beasts",
        ),
        StateEntry(
            dimension_id="lineage.obsidian.temperament_stability",
            value={"score": 0.41, "generation_window": 3},
            schema_ref="estimate.lineage_trait_score.v1",
            origin="derived",
            valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            provenance_refs=("artifact:lineage-study-14",),
        ),
    ),
)


def test_dimension_registry_rejects_duplicate_definitions() -> None:
    with pytest.raises(StateContractError, match="duplicate dimension definition"):
        DimensionRegistry(
            (
                DimensionDefinition(
                    dimension_id="runtime.health",
                    schema_ref="status.readiness.v1",
                    owner_ref="world://ops",
                ),
                DimensionDefinition(
                    dimension_id="runtime.health",
                    schema_ref="status.readiness.v1",
                    owner_ref="world://ops",
                ),
            )
        )


def test_dimension_registry_rejects_unregistered_state_entry() -> None:
    registry = DimensionRegistry(())

    with pytest.raises(StateContractError, match="unregistered dimension"):
        registry.validate_entry(
            StateEntry(
                dimension_id="runtime.health",
                value={"status": "ready"},
                schema_ref="status.readiness.v1",
                origin="observed",
                valid_from=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            )
        )


def test_dimension_registry_rejects_schema_mismatch_for_assessment() -> None:
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="research.signal.replication_strength",
                schema_ref="estimate.score_sample.v1",
                owner_ref="world://research",
            ),
        )
    )

    with pytest.raises(StateContractError, match="schema mismatch"):
        registry.validate_assessment(
            Assessment(
                assessment_id="assessment-1",
                dimension_id="research.signal.replication_strength",
                value={"score": 0.62, "sample_size": 4},
                schema_ref="estimate.other.v1",
                origin="estimated",
                assessed_at=datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc),
            )
        )


def test_apply_state_delta_is_deterministic_and_registry_validated() -> None:
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="runtime.health",
                schema_ref="status.readiness.v1",
                owner_ref="world://ops",
            ),
            DimensionDefinition(
                dimension_id="release.current_candidate",
                schema_ref="ref.manifest.v1",
                owner_ref="world://delivery",
            ),
        )
    )
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    entries = (
        StateEntry(
            dimension_id="runtime.health",
            value={"status": "booting"},
            schema_ref="status.readiness.v1",
            origin="observed",
            valid_from=now,
            provenance_refs=("obs:runtime-1",),
        ),
    )
    delta = StateDelta(
        upserts=(
            StateEntry(
                dimension_id="release.current_candidate",
                value={"manifest_ref": "manifest:17"},
                schema_ref="ref.manifest.v1",
                origin="declared",
                valid_from=now,
                provenance_refs=("obs:release-1",),
            ),
            StateEntry(
                dimension_id="runtime.health",
                value={"status": "ready"},
                schema_ref="status.readiness.v1",
                origin="observed",
                valid_from=now,
                provenance_refs=("obs:runtime-2",),
            ),
        ),
    )

    first = apply_state_delta(entries, delta, registry=registry)
    second = apply_state_delta(entries, delta, registry=registry)

    assert first == second
    assert tuple(entry.dimension_id for entry in first) == (
        "release.current_candidate",
        "runtime.health",
    )
    assert first[1].value == {"status": "ready"}


def test_apply_state_delta_rejects_duplicate_existing_dimension_entries() -> None:
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="runtime.health",
                schema_ref="status.readiness.v1",
                owner_ref="world://ops",
            ),
        )
    )
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    entries = (
        StateEntry(
            dimension_id="runtime.health",
            value={"status": "booting"},
            schema_ref="status.readiness.v1",
            origin="observed",
            valid_from=now,
        ),
        StateEntry(
            dimension_id="runtime.health",
            value={"status": "ready"},
            schema_ref="status.readiness.v1",
            origin="observed",
            valid_from=now,
        ),
    )

    with pytest.raises(StateContractError, match="duplicate state entry"):
        apply_state_delta(entries, StateDelta(), registry=registry)


@pytest.mark.parametrize(
    ("scenario_name", "definition", "entry"),
    SCENARIO_MATRIX,
    ids=[scenario[0] for scenario in SCENARIO_MATRIX],
)
def test_general_state_contract_accepts_wildly_different_domains(
    scenario_name: str,
    definition: DimensionDefinition,
    entry: StateEntry,
) -> None:
    registry = DimensionRegistry((definition,))

    result = apply_state_delta((), StateDelta(upserts=(entry,)), registry=registry)

    assert len(result) == 1
    assert result[0] == entry
    assert result[0].dimension_id == definition.dimension_id
    assert result[0].schema_ref == definition.schema_ref
