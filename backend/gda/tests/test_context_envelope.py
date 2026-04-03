from __future__ import annotations

from datetime import datetime, timezone

import pytest
from django.contrib.auth import get_user_model

from gda.models import ProjectCommitment, ProjectObservation, ProjectStateEntry
from gda.services.compile import compile_run_spec_for_project
from gda.services.context_envelope import build_gda_context_envelope, serialize_gda_context_envelope
from gda.services.state import persist_run_spec_state
from gda_kernel import State, StateVersion, project_ref, world_ref
from gda_kernel.contracts.context import GDAContextEnvelope
from projects.models import Project


pytestmark = pytest.mark.integration


@pytest.mark.django_db
def test_build_gda_context_envelope_includes_canonical_state_and_awareness():
    user = get_user_model().objects.create_user(username="gda-envelope", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
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
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v3", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_delay_detected": True},
        ),
        status="running",
    )
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="release.current_candidate",
        schema_ref="ref.manifest.v1",
        origin="declared",
        value={"manifest_ref": "manifest:17"},
        valid_from=now,
        provenance_refs=["obs:release-1"],
        state_version_id="v3",
    )
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="runtime.health",
        schema_ref="status.readiness.v1",
        origin="observed",
        value={"status": "ready"},
        valid_from=now,
        provenance_refs=["obs:runtime-1"],
        state_version_id="v3",
    )
    ProjectObservation.objects.create(
        project=project,
        observation_id="obs-email-1",
        kind="communication.email.received",
        subject=project_ref(project.id),
        observed_at=now,
        valid_at=now,
        source_kind="gmail",
        source_id="inbox",
        payload={"subject": "Delay on chips order"},
        provenance_refs=["gmail:msg-1"],
        quality="exact",
    )
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )

    envelope = build_gda_context_envelope(project=project)

    assert isinstance(envelope, GDAContextEnvelope)
    assert envelope.context_version_id == "v3"
    assert envelope.subject_ref == project_ref(project.id)
    assert envelope.subject_name == "OpenVending Ops"
    assert envelope.objective is not None
    assert envelope.objective.objective_id.startswith("objective://")
    assert envelope.boundary is not None
    assert envelope.boundary.capability_ids == ("ops.measure_supplier_risk",)
    assert envelope.world_ref == world_ref(project.id)
    assert envelope.state_entries[0].dimension_id == "release.current_candidate"
    assert envelope.state_entries[1].dimension_id == "runtime.health"
    assert envelope.recent_observations[0].observation_id == "obs-email-1"
    assert envelope.active_commitments[0].commitment_id == "commitment-1"
    assert envelope.awareness.active_commitment_count == 1
    assert envelope.awareness.recent_observation_count == 1
    assert envelope.awareness.control_status == "running"
    assert envelope.awareness.last_observed_at == now
    assert envelope.progress.status == "unknown"
    assert envelope.progress.total_goals == 1
    assert envelope.progress.unknown_goals == 1
    assert envelope.progress.goal_progress[0].missing_dimensions == ("supplier_risk_assessed",)
    assert envelope.metadata == {}

    serialized = serialize_gda_context_envelope(envelope)

    assert serialized["envelope_type"] == "gda_context_envelope"
    assert serialized["context_version_id"] == "v3"
    assert serialized["subject_ref"] == project_ref(project.id)
    assert serialized["subject_name"] == "OpenVending Ops"
    assert serialized["world_ref"] == world_ref(project.id)
    assert serialized["objective"]["objective_id"].startswith("objective://")
    assert serialized["boundary"]["capability_ids"] == ["ops.measure_supplier_risk"]
    assert serialized["state_entries"][0]["dimension_id"] == "release.current_candidate"
    assert serialized["state_entries"][1]["dimension_id"] == "runtime.health"
    assert serialized["recent_observations"][0]["observation_id"] == "obs-email-1"
    assert serialized["metadata"] == {}
    assert "project_name" not in serialized
    assert "project_id" not in serialized
    assert "facts" not in serialized
    assert "reduced_state_entries" not in serialized
    assert "state_version_id" not in serialized
    assert serialized["active_commitments"][0]["commitment_id"] == "commitment-1"
    assert serialized["awareness"]["state_entry_count"] == 2
    assert serialized["awareness"]["recent_observation_count"] == 1
    assert serialized["awareness"]["active_commitment_count"] == 1
    assert serialized["awareness"]["control_status"] == "running"
    assert serialized["awareness"]["last_observed_at"] == "2026-04-02T12:00:00+00:00"
    assert serialized["progress"] == {
        "objective_id": envelope.objective.objective_id,
        "status": "unknown",
        "total_goals": 1,
        "satisfied_goals": 0,
        "unknown_goals": 1,
        "failed_goals": 0,
        "goal_progress": [
            {
                "goal_id": "goal-1",
                "goal_name": "assess supplier impact",
                "status": "unknown",
                "missing_dimensions": ["supplier_risk_assessed"],
                "failed_dimensions": [],
            },
        ],
    }
