from __future__ import annotations

from datetime import datetime, timezone

import pytest
from django.contrib.auth import get_user_model

from agents.models import Agent, AgentFeedback, AgentStatus
from gda.models import (
    ProjectCommitment,
    ProjectCommitmentAssignment,
    ProjectObservation,
    ProjectStateEntry,
)
from gda.services.assignment import assign_project_commitment
from gda.services.compile import compile_run_spec_for_project
from gda.services.commitments import authorize_commitment
from gda.services.dogfood import (
    DOGFOOD_ALLOWED_ACTIONS,
    DogfoodScope,
    build_gda_dogfood_turn,
    dogfood_admit_observation,
    dogfood_propose_commitment,
    dogfood_report_execution,
    record_gda_dogfood_feedback,
)
from gda.services.reduction import apply_project_state_delta
from gda.services.state import persist_run_spec_state
from gda_kernel import (
    DimensionDefinition,
    DimensionRegistry,
    State,
    StateDelta,
    StateEntry,
    StateVersion,
    project_ref,
    world_ref,
)
from projects.models import Project


pytestmark = pytest.mark.integration


def _create_agent(*, project: Project, name: str, role: str) -> Agent:
    return Agent.objects.create(
        name=name,
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        role=role,
        agent_type="claude-code",
        session_id=f"session:{name}",
    )


@pytest.mark.django_db
def test_build_gda_dogfood_turn_for_lead_uses_full_context():
    user = get_user_model().objects.create_user(username="gda-dogfood-lead", password="test")
    project = Project.objects.create(name="Dogfood Lead", owner=user)
    agent = _create_agent(project=project, name="meta-agent", role="lead")
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Stabilize release readiness",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "keep runtime healthy",
                    "desired_state": {"runtime_ready": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk", "ops.reply_supplier"),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v5", observed_at=now, source_refs=("seed:1",)),
            facts={"legacy": True},
        ),
        status="running",
    )
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="runtime.health",
        schema_ref="status.readiness.v1",
        origin="observed",
        value={"status": "ready"},
        valid_from=now,
        provenance_refs=["obs:runtime-1"],
        state_version_id="v5",
    )
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )

    turn = build_gda_dogfood_turn(agent=agent)

    assert turn.role == "lead"
    assert turn.allowed_actions == DOGFOOD_ALLOWED_ACTIONS
    assert turn.brief["brief_type"] == "gda_agent_turn_brief"
    assert turn.brief["context_version_id"] == "v5"
    assert turn.brief["role"] == "lead"
    assert turn.brief["relevant_state"] == [
        {
            "dimension_id": "runtime.health",
            "value": {"status": "ready"},
        },
    ]
    assert turn.brief["allowed_capability_ids"] == [
        "ops.measure_supplier_risk",
        "ops.reply_supplier",
    ]
    assert "boundary" not in turn.brief
    assert "recent_observations" not in turn.brief
    assert turn.context_envelope["envelope_type"] == "gda_context_envelope"
    assert turn.context_envelope["state_entries"][0]["dimension_id"] == "runtime.health"


@pytest.mark.django_db
def test_build_gda_dogfood_turn_for_worker_scopes_context_without_changing_shape():
    user = get_user_model().objects.create_user(username="gda-dogfood-worker", password="test")
    project = Project.objects.create(name="Dogfood Worker", owner=user)
    agent = _create_agent(project=project, name="worker-agent", role="worker")
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
            "allowed_capabilities": ("ops.measure_supplier_risk", "ops.reply_supplier"),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="runtime.health",
        schema_ref="status.readiness.v1",
        origin="observed",
        value={"status": "ready"},
        valid_from=now,
        provenance_refs=["obs:runtime-1"],
        state_version_id="v1",
    )
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="release.current_candidate",
        schema_ref="ref.manifest.v1",
        origin="declared",
        value={"manifest_ref": "manifest:17"},
        valid_from=now,
        provenance_refs=["obs:release-1"],
        state_version_id="v1",
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
    ProjectObservation.objects.create(
        project=project,
        observation_id="obs-measurement-1",
        kind="measurement.inventory_days_remaining",
        subject=project_ref(project.id),
        observed_at=now,
        valid_at=now,
        source_kind="sheet",
        source_id="inventory",
        payload={"days_remaining": 3},
        provenance_refs=["artifact:inventory-1"],
        quality="exact",
    )
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-2",
        objective_id="objective-1",
        capability_id="ops.reply_supplier",
        status="active",
    )

    turn = build_gda_dogfood_turn(
        agent=agent,
        scope=DogfoodScope(
            capability_ids=("ops.measure_supplier_risk",),
            dimension_ids=("runtime.health",),
            observation_kinds=("measurement.inventory_days_remaining",),
        ),
    )

    assert turn.role == "worker"
    assert turn.brief["brief_type"] == "gda_agent_turn_brief"
    assert turn.brief["role"] == "worker"
    assert turn.brief["relevant_state"] == [
        {
            "dimension_id": "runtime.health",
            "value": {"status": "ready"},
        },
    ]
    assert turn.brief["recent_changes"] == [
        {
            "change_type": "observation",
            "ref_id": "obs-measurement-1",
            "summary": "measurement.inventory_days_remaining",
            "occurred_at": None,
        },
    ]
    assert turn.brief["active_commitments"] == [
        {
            "commitment_id": "commitment-1",
            "capability_id": "ops.measure_supplier_risk",
            "status": "active",
        },
    ]
    assert turn.brief["allowed_capability_ids"] == ["ops.measure_supplier_risk"]
    assert turn.context_envelope["envelope_type"] == "gda_context_envelope"
    assert turn.context_envelope["state_entries"] == [
        {
            "dimension_id": "runtime.health",
            "value": {"status": "ready"},
            "schema_ref": "status.readiness.v1",
            "origin": "observed",
            "valid_from": "2026-04-02T12:00:00+00:00",
            "valid_until": None,
            "provenance_refs": ["obs:runtime-1"],
        },
    ]
    assert turn.context_envelope["recent_observations"] == [
        {
            "observation_id": "obs-measurement-1",
            "kind": "measurement.inventory_days_remaining",
            "subject": project_ref(project.id),
            "observed_at": "2026-04-02T12:00:00+00:00",
            "valid_at": "2026-04-02T12:00:00+00:00",
            "expires_at": None,
            "source_kind": "sheet",
            "source_id": "inventory",
            "quality": "exact",
        },
    ]
    assert turn.context_envelope["active_commitments"] == [
        {
            "commitment_id": "commitment-1",
            "capability_id": "ops.measure_supplier_risk",
            "status": "active",
            "objective_id": "objective-1",
        },
    ]
    assert turn.context_envelope["boundary"]["capability_ids"] == ["ops.measure_supplier_risk"]
    assert turn.context_envelope["awareness"]["state_entry_count"] == 1
    assert turn.context_envelope["awareness"]["recent_observation_count"] == 1
    assert turn.context_envelope["awareness"]["active_commitment_count"] == 1


@pytest.mark.django_db
def test_build_gda_dogfood_turn_for_worker_derives_scope_from_assignment():
    user = get_user_model().objects.create_user(username="gda-dogfood-assignment", password="test")
    project = Project.objects.create(name="Dogfood Assignment", owner=user)
    worker = _create_agent(project=project, name="worker-agent", role="worker")
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
            "allowed_capabilities": ("ops.measure_supplier_risk", "ops.reply_supplier"),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="runtime.health",
        schema_ref="status.readiness.v1",
        origin="observed",
        value={"status": "ready"},
        valid_from=now,
        provenance_refs=["obs:runtime-1"],
        state_version_id="v1",
    )
    ProjectStateEntry.objects.create(
        project=project,
        dimension_id="release.current_candidate",
        schema_ref="ref.manifest.v1",
        origin="declared",
        value={"manifest_ref": "manifest:17"},
        valid_from=now,
        provenance_refs=["obs:release-1"],
        state_version_id="v1",
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
    ProjectObservation.objects.create(
        project=project,
        observation_id="obs-measurement-1",
        kind="measurement.inventory_days_remaining",
        subject="supplier:acme",
        observed_at=now,
        valid_at=now,
        source_kind="sheet",
        source_id="inventory",
        payload={"days_remaining": 3},
        provenance_refs=["artifact:inventory-1"],
        quality="exact",
    )
    commitment = ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        touched_scope=["supplier:acme"],
        status="active",
    )
    assign_project_commitment(
        project=project,
        commitment_id=commitment.commitment_id,
        agent=worker,
        dimension_ids=("runtime.health",),
        observation_kinds=("measurement.inventory_days_remaining",),
    )

    turn = build_gda_dogfood_turn(agent=worker)

    assert turn.brief["role"] == "worker"
    assert turn.brief["allowed_capability_ids"] == ["ops.measure_supplier_risk"]
    assert turn.brief["relevant_state"] == [
        {
            "dimension_id": "runtime.health",
            "value": {"status": "ready"},
        },
    ]
    assert turn.brief["active_commitments"] == [
        {
            "commitment_id": "commitment-1",
            "capability_id": "ops.measure_supplier_risk",
            "status": "active",
        },
    ]
    assert turn.brief["recent_changes"] == [
        {
            "change_type": "observation",
            "ref_id": "obs-measurement-1",
            "summary": "measurement.inventory_days_remaining",
            "occurred_at": None,
        },
    ]


@pytest.mark.django_db
def test_dogfood_admit_observation_refreshes_turn_context():
    user = get_user_model().objects.create_user(username="gda-dogfood-refresh", password="test")
    project = Project.objects.create(name="Dogfood Refresh", owner=user)
    agent = _create_agent(project=project, name="meta-agent", role="lead")
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={"title": "Watch runtime health", "goals": ()},
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    write_result = dogfood_admit_observation(
        agent=agent,
        observation_id="obs-runtime-1",
        kind="runtime.health.changed",
        payload={"status": "ready"},
        provenance_refs=["artifact:healthcheck"],
        observed_at="2026-04-02T12:00:00+00:00",
        valid_at="2026-04-02T12:00:00+00:00",
    )

    assert write_result.result["ok"] is True
    assert write_result.next_turn.role == "lead"
    assert write_result.next_turn.brief["recent_changes"][0]["ref_id"] == "obs-runtime-1"
    assert write_result.next_turn.context_envelope["recent_observations"][0]["observation_id"] == "obs-runtime-1"
    assert write_result.next_turn.context_envelope["awareness"]["recent_observation_count"] == 1
    assert write_result.next_turn.brief["progress"]["status"] == "idle"
    assert write_result.change_summary == {
        "summary_type": "gda_dogfood_change_summary",
        "result_kind": "observation_admitted",
        "changed_observation_ids": ["obs-runtime-1"],
        "changed_commitment_ids": [],
        "control_status": "running",
        "progress_status": "idle",
        "recent_change_refs": ["obs-runtime-1"],
    }


@pytest.mark.django_db
def test_assign_project_commitment_persists_canonical_assignment():
    user = get_user_model().objects.create_user(username="gda-dogfood-assign-model", password="test")
    project = Project.objects.create(name="Dogfood Assignment Model", owner=user)
    worker = _create_agent(project=project, name="worker-agent", role="worker")
    commitment = ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        touched_scope=["supplier:acme"],
        status="active",
    )

    assignment = assign_project_commitment(
        project=project,
        commitment_id=commitment.commitment_id,
        agent=worker,
        dimension_ids=("runtime.health",),
        observation_kinds=("measurement.inventory_days_remaining",),
    )

    stored = ProjectCommitmentAssignment.objects.get(id=assignment.id)
    assert stored.project == project
    assert stored.commitment == commitment
    assert stored.agent == worker
    assert stored.dimension_ids == ["runtime.health"]
    assert stored.observation_kinds == ["measurement.inventory_days_remaining"]


@pytest.mark.django_db
def test_record_gda_dogfood_feedback_persists_agent_feedback():
    user = get_user_model().objects.create_user(username="gda-dogfood-feedback", password="test")
    project = Project.objects.create(name="Dogfood Feedback", owner=user)
    agent = _create_agent(project=project, name="meta-agent", role="lead")

    feedback = record_gda_dogfood_feedback(
        agent=agent,
        rating=4,
        comment="Context was clean; commitment proposal needed one less required field.",
    )

    stored = AgentFeedback.objects.get(id=feedback.id)
    assert stored.agent == agent
    assert stored.session_id == "session:meta-agent"
    assert stored.rating == 4


@pytest.mark.django_db
def test_dogfood_demo_loop_smoke_moves_progress_after_reduction():
    user = get_user_model().objects.create_user(username="gda-dogfood-smoke", password="test")
    project = Project.objects.create(name="Dogfood Smoke", owner=user)
    lead = _create_agent(project=project, name="meta-agent", role="lead")
    worker = _create_agent(project=project, name="worker-agent", role="worker")
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)

    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Restore runtime readiness",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "runtime is ready",
                    "desired_state": {"runtime.health": {"status": "ready"}},
                },
            ),
            "allowed_capabilities": ("ops.check_runtime_health",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v1", observed_at=now, source_refs=("seed:1",)),
            facts={},
        ),
        status="running",
    )

    lead_turn_before = build_gda_dogfood_turn(agent=lead)
    assert lead_turn_before.brief["progress"]["status"] == "unknown"
    assert lead_turn_before.brief["progress"]["goal_progress"] == [
        {
            "goal_id": "goal-1",
            "goal_name": "runtime is ready",
            "status": "unknown",
            "missing_dimensions": ["runtime.health"],
            "failed_dimensions": [],
        },
    ]

    proposed = dogfood_propose_commitment(
        agent=lead,
        capability_id="ops.check_runtime_health",
        arguments={"check": "runtime.health"},
        touched_scope=[project_ref(project.id)],
        expected_observation={"kind": "runtime.health.changed", "required": True},
        expected_outcome={"status": "ok", "required": True},
        commitment_id="commitment-runtime-1",
        role="lead",
    )
    assert proposed.result["ok"] is True
    assert proposed.change_summary["changed_commitment_ids"] == ["commitment-runtime-1"]
    authorize_commitment(
        project=project,
        commitment_id="commitment-runtime-1",
        activated_at=now,
    )

    assign_project_commitment(
        project=project,
        commitment_id="commitment-runtime-1",
        agent=worker,
        dimension_ids=("runtime.health",),
        observation_kinds=("runtime.health.changed",),
    )

    worker_turn = build_gda_dogfood_turn(agent=worker)
    assert worker_turn.brief["allowed_capability_ids"] == ["ops.check_runtime_health"]
    assert worker_turn.brief["active_commitments"] == [
        {
            "commitment_id": "commitment-runtime-1",
            "capability_id": "ops.check_runtime_health",
            "status": "active",
        },
    ]
    assert worker_turn.brief["progress"]["status"] == "unknown"

    execution = dogfood_report_execution(
        agent=worker,
        invocation_id="invoke-runtime-1",
        commitment_id="commitment-runtime-1",
        status="ok",
        artifact_refs=["artifact:healthcheck"],
        observations=[
            {
                "observation_id": "obs-runtime-1",
                "kind": "runtime.health.changed",
                "subject": project_ref(project.id),
                "payload": {"status": "ready"},
                "provenance_refs": ["artifact:healthcheck"],
            },
        ],
        completed_at="2026-04-02T12:05:00Z",
        role="worker",
    )
    assert execution.result["ok"] is True
    assert execution.change_summary["changed_observation_ids"] == ["obs-runtime-1"]

    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="runtime.health",
                schema_ref="status.readiness.v1",
                owner_ref=world_ref(project.id),
            ),
        )
    )
    apply_project_state_delta(
        project=project,
        delta=StateDelta(
            upserts=(
                StateEntry(
                    dimension_id="runtime.health",
                    value={"status": "ready"},
                    schema_ref="status.readiness.v1",
                    origin="observed",
                    valid_from=now,
                    provenance_refs=("observation://obs-runtime-1",),
                ),
            ),
        ),
        registry=registry,
        version=StateVersion(version_id="v2", observed_at=now, source_refs=("observation://obs-runtime-1",)),
    )

    lead_turn_after = build_gda_dogfood_turn(agent=lead)
    assert lead_turn_after.brief["progress"]["status"] == "satisfied"
    assert lead_turn_after.brief["progress"]["satisfied_goals"] == 1
    assert lead_turn_after.brief["relevant_state"] == [
        {
            "dimension_id": "runtime.health",
            "value": {"status": "ready"},
        },
    ]


@pytest.mark.django_db
def test_dogfood_file_goal_smoke_moves_progress_after_reduction():
    user = get_user_model().objects.create_user(username="gda-dogfood-file", password="test")
    project = Project.objects.create(name="Dogfood File Smoke", owner=user)
    lead = _create_agent(project=project, name="meta-agent", role="lead")
    worker = _create_agent(project=project, name="worker-agent", role="worker")
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    file_subject_ref = "file:///workspace/hello.txt"

    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Create hello file",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "hello file exists",
                    "desired_state": {
                        "workspace.file.exists": {"exists": True},
                    },
                },
                {
                    "goal_id": "goal-2",
                    "name": "hello file content matches",
                    "desired_state": {
                        "workspace.file.content": {"content": "hello from agentobox"},
                    },
                },
            ),
            "allowed_capabilities": ("workspace.write_file",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v1", observed_at=now, source_refs=("seed:file",)),
            facts={},
        ),
        status="running",
    )

    lead_turn_before = build_gda_dogfood_turn(agent=lead)
    assert lead_turn_before.brief["progress"]["status"] == "unknown"
    assert lead_turn_before.brief["progress"]["unknown_goals"] == 2

    proposed = dogfood_propose_commitment(
        agent=lead,
        capability_id="workspace.write_file",
        arguments={"path": "/workspace/hello.txt", "content": "hello from agentobox"},
        touched_scope=[file_subject_ref],
        expected_observation={
            "kind": "workspace.file.changed",
            "required": True,
            "subject": file_subject_ref,
        },
        expected_outcome={"status": "ok", "required": True},
        commitment_id="commitment-file-1",
        role="lead",
    )
    assert proposed.result["ok"] is True
    authorize_commitment(
        project=project,
        commitment_id="commitment-file-1",
        activated_at=now,
    )
    assign_project_commitment(
        project=project,
        commitment_id="commitment-file-1",
        agent=worker,
        dimension_ids=("workspace.file.exists", "workspace.file.content"),
        observation_kinds=("workspace.file.changed",),
    )

    worker_turn = build_gda_dogfood_turn(agent=worker)
    assert worker_turn.brief["allowed_capability_ids"] == ["workspace.write_file"]
    assert worker_turn.brief["active_commitments"] == [
        {
            "commitment_id": "commitment-file-1",
            "capability_id": "workspace.write_file",
            "status": "active",
        },
    ]

    execution = dogfood_report_execution(
        agent=worker,
        invocation_id="invoke-file-1",
        commitment_id="commitment-file-1",
        status="ok",
        artifact_refs=[file_subject_ref],
        observations=[
            {
                "observation_id": "obs-file-1",
                "kind": "workspace.file.changed",
                "subject": file_subject_ref,
                "payload": {"path": "/workspace/hello.txt", "content": "hello from agentobox"},
                "provenance_refs": [file_subject_ref],
            },
        ],
        completed_at="2026-04-02T12:05:00Z",
        role="worker",
    )
    assert execution.result["ok"] is True
    assert execution.change_summary["changed_observation_ids"] == ["obs-file-1"]

    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="workspace.file.exists",
                schema_ref="status.file_exists.v1",
                owner_ref=world_ref(project.id),
            ),
            DimensionDefinition(
                dimension_id="workspace.file.content",
                schema_ref="measurement.file_content.v1",
                owner_ref=world_ref(project.id),
            ),
        )
    )
    apply_project_state_delta(
        project=project,
        delta=StateDelta(
            upserts=(
                StateEntry(
                    dimension_id="workspace.file.exists",
                    value={"exists": True},
                    schema_ref="status.file_exists.v1",
                    origin="observed",
                    valid_from=now,
                    provenance_refs=("observation://obs-file-1",),
                ),
                StateEntry(
                    dimension_id="workspace.file.content",
                    value={"content": "hello from agentobox"},
                    schema_ref="measurement.file_content.v1",
                    origin="observed",
                    valid_from=now,
                    provenance_refs=("observation://obs-file-1",),
                ),
            ),
        ),
        registry=registry,
        version=StateVersion(version_id="v2", observed_at=now, source_refs=("observation://obs-file-1",)),
    )

    lead_turn_after = build_gda_dogfood_turn(agent=lead)
    assert lead_turn_after.brief["progress"]["status"] == "satisfied"
    assert lead_turn_after.brief["progress"]["satisfied_goals"] == 2
    assert lead_turn_after.brief["relevant_state"] == [
        {
            "dimension_id": "workspace.file.content",
            "value": {"content": "hello from agentobox"},
        },
        {
            "dimension_id": "workspace.file.exists",
            "value": {"exists": True},
        },
    ]
