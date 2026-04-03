from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from agents.models import Agent
from gda.models import ProjectCommitment, ProjectCommitmentAssignment, ProjectState
from projects.models import Project


pytestmark = pytest.mark.integration


@pytest.mark.django_db
def test_seed_gda_demo_creates_reproducible_demo_project(capsys):
    call_command(
        "seed_gda_demo",
        "--username",
        "demo",
        "--password",
        "demo",
        "--project-name",
        "gda-demo-test",
        "--reset",
        "--no-deploy",
    )

    user = get_user_model().objects.get(username="demo")
    project = Project.objects.get(name="gda-demo-test", owner=user)
    lead = Agent.objects.get(project=project, name="meta-agent")
    worker = Agent.objects.get(project=project, name="worker-agent")
    state = ProjectState.objects.get(project=project)
    commitment = ProjectCommitment.objects.get(project=project, commitment_id="commitment-runtime-1")
    assignment = ProjectCommitmentAssignment.objects.get(project=project, commitment=commitment)

    assert lead.role == "lead"
    assert worker.role == "worker"
    assert state.status == "running"
    assert state.world_ref == f"world://{project.id}"
    assert state.subject == f"project://{project.id}"
    assert state.objective["goals"][0]["target_conditions"] == [
        {
            "condition_id": "goal-1:condition:1",
            "dimension_id": "runtime.health",
            "subject_ref": "",
            "operator": "eq",
            "expected_value": {"status": "ready"},
        }
    ]
    assert commitment.status == "active"
    assert commitment.capability_id == "ops.check_runtime_health"
    assert assignment.agent == worker
    assert assignment.dimension_ids == ["runtime.health"]
    assert assignment.observation_kinds == ["runtime.health.changed"]

    out = capsys.readouterr().out
    assert "Seeded GDA demo project" in out
    assert "commitment=commitment-runtime-1" in out


@pytest.mark.django_db
def test_seed_gda_demo_creates_file_scenario(capsys):
    call_command(
        "seed_gda_demo",
        "--username",
        "demo-file",
        "--password",
        "demo",
        "--project-name",
        "gda-file-demo-test",
        "--scenario",
        "file",
        "--reset",
        "--no-deploy",
    )

    user = get_user_model().objects.get(username="demo-file")
    project = Project.objects.get(name="gda-file-demo-test", owner=user)
    lead = Agent.objects.get(project=project, name="meta-agent")
    worker = Agent.objects.get(project=project, name="worker-agent")
    state = ProjectState.objects.get(project=project)
    commitment = ProjectCommitment.objects.get(project=project, commitment_id="commitment-file-1")
    assignment = ProjectCommitmentAssignment.objects.get(project=project, commitment=commitment)

    assert lead.role == "lead"
    assert worker.role == "worker"
    assert state.status == "running"
    assert commitment.status == "active"
    assert commitment.capability_id == "workspace.write_file"
    assert commitment.touched_scope == ["file:///workspace/hello.txt"]
    assert state.objective["goals"][0]["target_conditions"] == [
        {
            "condition_id": "goal-1:condition:1",
            "dimension_id": "workspace.file.exists",
            "subject_ref": "file:///workspace/hello.txt",
            "operator": "eq",
            "expected_value": {"exists": True},
        }
    ]
    assert state.objective["goals"][1]["target_conditions"] == [
        {
            "condition_id": "goal-2:condition:1",
            "dimension_id": "workspace.file.content",
            "subject_ref": "file:///workspace/hello.txt",
            "operator": "eq",
            "expected_value": {"content": "hello from agentobox"},
        }
    ]
    assert assignment.agent == worker
    assert assignment.dimension_ids == ["workspace.file.exists", "workspace.file.content"]
    assert assignment.observation_kinds == ["workspace.file.changed"]

    out = capsys.readouterr().out
    assert "scenario=file" in out
    assert "commitment=commitment-file-1" in out
