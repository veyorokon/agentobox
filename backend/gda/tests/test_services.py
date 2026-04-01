from __future__ import annotations

from datetime import datetime, timezone

import pytest
from django.contrib.auth import get_user_model

from gda.models import ProjectCommitment, ProjectExecution, ProjectObservation
from gda.services.admission import (
    admit_project_observation,
    admit_project_observations,
    project_observation_to_contract,
)
from gda.services.commitments import (
    persist_commitment_proposal,
    project_commitment_to_contract,
)
from gda.services.compile import compile_run_spec_for_project
from gda.services.control_step import build_control_context, run_control_step
from gda.services.execution import (
    project_execution_to_contract,
    record_execution_outcome,
)
from gda.services.state import persist_run_spec_state, project_state_to_contract
from gda_kernel import (
    CommitmentProposal,
    ExecutionOutcome,
    Observation,
    ObservationAdmissionError,
    ObservationSource,
    State,
    StateVersion,
)
from projects.models import Project


pytestmark = pytest.mark.integration


@pytest.mark.django_db
def test_compile_run_spec_for_project_compiles_project_into_kernel_run_spec():
    user = get_user_model().objects.create_user(username="gda-compile", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)

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
            "budget": {"steps": 3},
        },
        now=datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc),
        world_ref=f"project://{project.id}",
    )

    assert run_spec.run_id == f"run:{project.id}"
    assert run_spec.objective.name == "Handle supplier delay"
    assert run_spec.metadata["project_id"] == str(project.id)
    assert run_spec.metadata["project_name"] == "OpenVending Ops"


@pytest.mark.django_db
def test_persist_run_spec_state_writes_canonical_project_state():
    user = get_user_model().objects.create_user(username="gda-state", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
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
            "budget": {"steps": 3},
        },
        now=now,
        world_ref=f"project://{project.id}",
    )

    record = persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=f"project://{project.id}",
            version=StateVersion(version_id="v3", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_risk_assessed": False},
        ),
        status="running",
    )

    assert record.run_id == f"run:{project.id}"
    assert record.status == "running"
    assert record.objective["name"] == "Handle supplier delay"
    assert record.boundary["capability_ids"] == ["ops.measure_supplier_risk"]
    assert project_state_to_contract(record).facts["supplier_risk_assessed"] is False


@pytest.mark.django_db
def test_admit_project_observation_persists_canonical_record():
    user = get_user_model().objects.create_user(username="gda-admit", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    record = admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-email-1",
            subject=f"project://{project.id}",
            kind="communication.email.received",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="gmail", source_id="inbox"),
            payload={"subject": "Delay on chips order"},
            provenance_refs=("gmail:msg-1",),
        ),
        known_source_kinds=("gmail",),
        freshness_policy={"require_provenance": True},
    )

    assert ProjectObservation.objects.filter(project=project).count() == 1
    assert record.kind == "communication.email.received"
    assert project_observation_to_contract(record).source.kind == "gmail"


@pytest.mark.django_db
def test_admit_project_observations_keeps_conflicting_evidence_with_distinct_ids():
    user = get_user_model().objects.create_user(username="gda-conflict", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    records = admit_project_observations(
        project=project,
        candidates=(
            Observation(
                observation_id="obs-build",
                subject=f"project://{project.id}",
                kind="runtime.build_succeeded",
                observed_at=observed_at,
                valid_at=observed_at,
                source=ObservationSource(kind="subagent", source_id="builder"),
                payload={"claim": "build succeeded"},
                provenance_refs=("artifact:build-log",),
                quality="derived",
            ),
            Observation(
                observation_id="obs-health",
                subject=f"project://{project.id}",
                kind="runtime.healthcheck_failed",
                observed_at=observed_at,
                valid_at=observed_at,
                source=ObservationSource(kind="monitor", source_id="deploy-health"),
                payload={"claim": "healthcheck failed"},
                provenance_refs=("monitor:healthcheck-1",),
                quality="exact",
            ),
        ),
    )

    assert len(records) == 2
    assert {record.source_kind for record in records} == {"subagent", "monitor"}


@pytest.mark.django_db
def test_admit_project_observation_rejects_duplicate_observation_ids():
    user = get_user_model().objects.create_user(username="gda-duplicate", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-1",
            subject=f"project://{project.id}",
            kind="user.steering",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="user", source_id="chat"),
            payload={"message": "Assess supplier risk."},
            provenance_refs=("chat:1",),
        ),
    )

    with pytest.raises(ObservationAdmissionError, match="duplicate"):
        admit_project_observation(
            project=project,
            candidate=Observation(
                observation_id="obs-1",
                subject=f"project://{project.id}",
                kind="user.steering",
                observed_at=observed_at,
                valid_at=observed_at,
                source=ObservationSource(kind="user", source_id="chat"),
                payload={"message": "Assess supplier risk again."},
                provenance_refs=("chat:2",),
            ),
        )


@pytest.mark.django_db
def test_record_execution_outcome_persists_and_links_commitment():
    user = get_user_model().objects.create_user(username="gda-exec", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    commitment = ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )

    record = record_execution_outcome(
        project=project,
        outcome=ExecutionOutcome(
            invocation_id="invoke-1",
            commitment_id="commitment-1",
            status="ok",
            resource_usage={"tokens": 42.0},
            artifact_refs=("artifact:risk-report",),
            metadata={"executor": "meta-agent"},
        ),
        completed_at=datetime(2026, 3, 31, 12, 5, tzinfo=timezone.utc),
    )

    assert ProjectExecution.objects.filter(project=project).count() == 1
    assert record.commitment_id == commitment.id
    outcome = project_execution_to_contract(record)
    assert outcome.commitment_id == "commitment-1"
    assert outcome.resource_usage["tokens"] == 42.0


@pytest.mark.django_db
def test_persist_commitment_proposal_writes_canonical_commitment():
    user = get_user_model().objects.create_user(username="gda-commit", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
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
        world_ref=f"project://{project.id}",
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    record = persist_commitment_proposal(
        project=project,
        proposal=CommitmentProposal(
            capability_id="ops.measure_supplier_risk",
            arguments={"metric": "supplier_risk"},
            touched_scope=(f"project://{project.id}",),
            expected_observation={"kind": "measurement.sampled", "required": True},
            expected_outcome={"status": "ok", "required": True},
        ),
        commitment_id="commitment-1",
        status="active",
        opened_at=now,
    )

    assert record.capability_id == "ops.measure_supplier_risk"
    commitment = project_commitment_to_contract(record)
    assert commitment.status == "active"
    assert commitment.expected_observation["kind"] == "measurement.sampled"


@pytest.mark.django_db
def test_run_control_step_builds_context_from_canonical_state_and_records_commitment():
    user = get_user_model().objects.create_user(username="gda-loop", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
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
        world_ref=f"project://{project.id}",
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=f"project://{project.id}",
            version=StateVersion(version_id="v2", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_delay_detected": True},
        ),
        status="running",
    )
    admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-email-1",
            subject=f"project://{project.id}",
            kind="communication.email.received",
            observed_at=now,
            valid_at=now,
            source=ObservationSource(kind="gmail", source_id="inbox"),
            payload={"subject": "Delay on chips order"},
            provenance_refs=("gmail:msg-1",),
        ),
    )

    context = build_control_context(project=project)
    assert context["facts"]["supplier_delay_detected"] is True
    assert len(context["recent_observations"]) == 1

    created = run_control_step(
        project=project,
        proposer=lambda ctx: CommitmentProposal(
            capability_id="ops.measure_supplier_risk",
            arguments={"metric": "supplier_risk"},
            touched_scope=(ctx["world_ref"],),
            expected_observation={"kind": "measurement.sampled", "required": True},
            expected_outcome={"status": "ok", "required": True},
        ),
        commitment_id_factory=lambda project: f"commitment:{project.id}:1",
        opened_at=now,
    )

    assert created is not None
    assert created.commitment_id == f"commitment:{project.id}:1"
    assert created.status == "active"
