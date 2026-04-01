from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gda_kernel import Observation, ObservationSource, admit_observation, compile_project_to_run_spec


pytestmark = pytest.mark.unit


def test_gda_kernel_compile_seam_is_importable_from_backend() -> None:
    run_spec = compile_project_to_run_spec(
        project={"id": "project-1"},
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
            "budget": {"steps": 3},
        },
        now=datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc),
        world_ref="project://openvending",
    )

    assert run_spec.objective.name == "Handle supplier delay"
    assert run_spec.boundary.capability_ids == ("ops.measure_supplier_risk",)
    assert run_spec.metadata["project_id"] == "project-1"


def test_gda_kernel_observation_admission_accepts_typed_candidate() -> None:
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    observation = admit_observation(
        Observation(
            observation_id="obs-1",
            subject="project://openvending",
            kind="communication.email.received",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="gmail", source_id="inbox"),
            payload={"subject": "Delay on chips order"},
            provenance_refs=("gmail:msg-1",),
        ),
        freshness_policy={"require_provenance": True},
        allowed_kinds=("communication.email.received",),
        known_source_kinds=("gmail",),
    )

    assert observation.kind == "communication.email.received"
    assert observation.source.kind == "gmail"
