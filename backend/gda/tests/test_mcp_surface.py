from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model

from gda.models import ProjectCommitment, ProjectObservation
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
from gda_kernel import State, StateVersion
from projects.models import Project


pytestmark = pytest.mark.integration


def _agent_for(project: Project, *, name: str = "meta-agent") -> SimpleNamespace:
    return SimpleNamespace(name=name, project_id=project.id)


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
        world_ref=f"project://{project.id}",
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=f"project://{project.id}",
            version=StateVersion(version_id="v1", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_delay_detected": True},
        ),
        status="running",
    )
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )

    context = async_to_sync(get_gda_context_for_agent)(_agent_for(project))

    assert context["project_name"] == "OpenVending Ops"
    assert context["facts"]["supplier_delay_detected"] is True
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
        world_ref=f"project://{project.id}",
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    ProjectObservation.objects.create(
        project=project,
        observation_id="obs-email-1",
        kind="communication.email.received",
        subject=f"project://{project.id}",
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
            "subject": f"project://{project.id}",
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
        world_ref=f"project://{project.id}",
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
        },
    ]


@pytest.mark.django_db
def test_admit_gda_observation_for_agent_persists_agent_sourced_observation():
    user = get_user_model().objects.create_user(username="gda-mcp-observation", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)

    result = async_to_sync(admit_gda_observation_for_agent)(
        _agent_for(project, name="meta-agent"),
        observation_id="obs-risk-1",
        kind="analysis.risk_flagged",
        payload={"risk": "supplier_delay"},
        provenance_refs=["artifact:risk-note"],
    )

    record = ProjectObservation.objects.get(project=project, observation_id="obs-risk-1")
    assert result["ok"] is True
    assert record.source_kind == "agent"
    assert record.source_id == "meta-agent"
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
        world_ref=f"project://{project.id}",
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
        world_ref=f"project://{project.id}",
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

    result = async_to_sync(report_gda_execution_for_agent)(
        _agent_for(project, name="worker-1"),
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
    assert observation.source_id == "worker-1"


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
        world_ref=f"project://{project.id}",
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    async_to_sync(report_gda_execution_for_agent)(
        _agent_for(project, name="worker-1"),
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
    assert observation.source_id == "worker-1"
    assert observation.payload["reported_source"] == {
        "kind": "monitor",
        "source_id": "deploy-health",
    }
