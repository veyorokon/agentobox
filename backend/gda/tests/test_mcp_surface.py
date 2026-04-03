from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

import pytest
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model

from gda.models import ProjectCommitment, ProjectObservation, ProjectStateEntry
from gda.services.compile import compile_run_spec_for_project
from gda.services.mcp_surface import (
    admit_gda_observation_for_agent,
    get_gda_context_for_agent,
    list_gda_active_commitments_for_agent,
    list_gda_recent_observations_for_agent,
    propose_gda_commitment_for_agent,
    report_gda_execution_for_agent,
)
from gda.services.state import persist_run_spec_state
from gda_kernel import State, StateVersion, agent_ref, project_ref, world_ref
from projects.models import Project


pytestmark = pytest.mark.integration


def _agent_for(project: Project, *, name: str = "meta-agent") -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), name=name, project_id=project.id)


@pytest.mark.django_db
def test_get_gda_context_for_agent_reads_canonical_project_state():
    user = get_user_model().objects.create_user(username="gda-mcp-context", password="test")
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
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v1", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_delay_detected": True},
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
        state_version_id="v1",
    )
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )

    context = async_to_sync(get_gda_context_for_agent)(_agent_for(project))

    assert context["envelope_type"] == "gda_context_envelope"
    assert context["context_version_id"] == "v1"
    assert context["subject_name"] == "OpenVending Ops"
    assert "project_name" not in context
    assert "project_id" not in context
    assert "facts" not in context
    assert "reduced_state_entries" not in context
    assert "state_version_id" not in context
    assert context["state_entries"] == [
        {
            "dimension_id": "runtime.health",
            "value": {"status": "ready"},
            "schema_ref": "status.readiness.v1",
            "origin": "observed",
            "valid_from": "2026-03-31T12:00:00+00:00",
            "valid_until": None,
            "provenance_refs": ["obs:runtime-1"],
        },
    ]
    assert context["active_commitments"][0]["capability_id"] == "ops.measure_supplier_risk"


@pytest.mark.django_db
def test_list_gda_recent_observations_for_agent_reads_recent_canonical_observations():
    user = get_user_model().objects.create_user(username="gda-mcp-observation-list", password="test")
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
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
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

    observations = async_to_sync(list_gda_recent_observations_for_agent)(_agent_for(project))

    assert observations == [
        {
            "observation_id": "obs-email-1",
            "kind": "communication.email.received",
            "subject": project_ref(project.id),
            "observed_at": "2026-03-31T12:00:00+00:00",
            "valid_at": "2026-03-31T12:00:00+00:00",
            "expires_at": None,
            "source_kind": "gmail",
            "source_id": "inbox",
            "quality": "exact",
        },
    ]


@pytest.mark.django_db
def test_list_gda_active_commitments_for_agent_reads_active_canonical_commitments():
    user = get_user_model().objects.create_user(username="gda-mcp-commitment-list", password="test")
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
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
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
        status="satisfied",
    )

    commitments = async_to_sync(list_gda_active_commitments_for_agent)(_agent_for(project))

    assert commitments == [
        {
            "commitment_id": "commitment-1",
            "capability_id": "ops.measure_supplier_risk",
            "status": "active",
            "objective_id": "objective-1",
        },
    ]


@pytest.mark.django_db
def test_admit_gda_observation_for_agent_persists_agent_sourced_observation():
    user = get_user_model().objects.create_user(username="gda-mcp-observation", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)

    agent = _agent_for(project, name="meta-agent")
    result = async_to_sync(admit_gda_observation_for_agent)(
        agent,
        observation_id="obs-risk-1",
        kind="analysis.risk_flagged",
        payload={"risk": "supplier_delay"},
        provenance_refs=["artifact:risk-note"],
    )

    record = ProjectObservation.objects.get(project=project, observation_id="obs-risk-1")
    assert result["ok"] is True
    assert record.source_kind == "agent"
    assert record.source_id == agent_ref(agent.id)
    assert record.quality == "derived"


@pytest.mark.django_db
def test_propose_gda_commitment_for_agent_persists_proposed_commitment():
    user = get_user_model().objects.create_user(username="gda-mcp-commitment", password="test")
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
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    result = async_to_sync(propose_gda_commitment_for_agent)(
        _agent_for(project),
        capability_id="ops.measure_supplier_risk",
        arguments={"metric": "supplier_risk"},
        expected_observation={"kind": "measurement.sampled", "required": True},
        expected_outcome={"status": "ok", "required": True},
        commitment_id="commitment-risk-1",
    )

    record = ProjectCommitment.objects.get(project=project, commitment_id="commitment-risk-1")
    assert result["ok"] is True
    assert record.status == "proposed"
    assert record.capability_id == "ops.measure_supplier_risk"


@pytest.mark.django_db
def test_report_gda_execution_for_agent_records_execution_and_satisfies_commitment():
    user = get_user_model().objects.create_user(username="gda-mcp-execution", password="test")
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
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-risk-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
        expected_observation={"kind": "measurement.sampled", "required": True},
        expected_outcome={"status": "ok", "required": True},
    )

    agent = _agent_for(project, name="worker-1")
    result = async_to_sync(report_gda_execution_for_agent)(
        agent,
        invocation_id="invoke-risk-1",
        commitment_id="commitment-risk-1",
        status="ok",
        artifact_refs=["artifact:risk-report"],
        observations=[
            {
                "observation_id": "obs-measurement-1",
                "kind": "measurement.sampled",
                "payload": {"metric": "supplier_risk", "value": 0.8},
                "provenance_refs": ["artifact:risk-report"],
            },
        ],
        completed_at="2026-03-31T12:05:00Z",
    )

    commitment = ProjectCommitment.objects.get(project=project, commitment_id="commitment-risk-1")
    observation = ProjectObservation.objects.get(project=project, observation_id="obs-measurement-1")
    assert result["ok"] is True
    assert result["execution"]["status"] == "ok"
    assert result["commitment"]["status"] == "satisfied"
    assert commitment.status == "satisfied"
    assert observation.source_kind == "agent"
    assert observation.source_id == agent_ref(agent.id)


@pytest.mark.django_db
def test_report_gda_execution_for_agent_forces_canonical_agent_source_identity():
    user = get_user_model().objects.create_user(username="gda-mcp-source", password="test")
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
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    agent = _agent_for(project, name="worker-1")
    async_to_sync(report_gda_execution_for_agent)(
        agent,
        invocation_id="invoke-spoof-1",
        status="ok",
        observations=[
            {
                "observation_id": "obs-spoof-1",
                "kind": "measurement.sampled",
                "source_kind": "monitor",
                "source_id": "deploy-health",
                "payload": {"metric": "supplier_risk", "value": 0.8},
            },
        ],
        completed_at="2026-03-31T12:05:00Z",
    )

    observation = ProjectObservation.objects.get(project=project, observation_id="obs-spoof-1")
    assert observation.source_kind == "agent"
    assert observation.source_id == agent_ref(agent.id)
    assert observation.payload["reported_source"] == {
        "kind": "monitor",
        "source_id": "deploy-health",
    }
