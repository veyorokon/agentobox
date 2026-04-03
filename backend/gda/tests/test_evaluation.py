from __future__ import annotations

from datetime import datetime, timezone

import pytest
from django.contrib.auth import get_user_model

from gda.models import ProjectStateEntry
from gda.services.compile import compile_run_spec_for_project
from gda.services.evaluation import evaluate_objective
from gda.services.reduction import project_state_entry_to_contract
from gda.services.state import persist_run_spec_state
from gda_kernel import State, StateVersion, project_ref, world_ref
from projects.models import Project


pytestmark = pytest.mark.integration


@pytest.mark.django_db
def test_evaluate_objective_uses_desired_state_and_satisfaction_criteria():
    user = get_user_model().objects.create_user(username="gda-eval", password="test")
    project = Project.objects.create(name="Goal Eval", owner=user)
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
                {
                    "goal_id": "goal-2",
                    "name": "keep runtime ready",
                    "satisfaction_criteria": {"runtime.health": {"status": "ready"}},
                },
            ),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v2", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_risk_assessed": True},
        ),
        status="running",
    )
    entry = ProjectStateEntry.objects.create(
        project=project,
        dimension_id="runtime.health",
        schema_ref="status.readiness.v1",
        origin="observed",
        value={"status": "ready"},
        valid_from=now,
        provenance_refs=["obs:runtime-1"],
        state_version_id="v2",
    )

    summary = evaluate_objective(
        objective=run_spec.objective,
        state_entries=tuple(),
        legacy_facts={},
    )
    assert summary.status == "unknown"

    hydrated_summary = evaluate_objective(
        objective=run_spec.objective,
        state_entries=(
            project_state_entry_to_contract(entry),
        ),
        legacy_facts={"supplier_risk_assessed": True},
    )

    assert hydrated_summary.status == "satisfied"
    assert hydrated_summary.total_goals == 2
    assert hydrated_summary.satisfied_goals == 2
    assert hydrated_summary.failed_goals == 0
    assert hydrated_summary.unknown_goals == 0


@pytest.mark.django_db
def test_evaluate_objective_uses_explicit_target_conditions():
    user = get_user_model().objects.create_user(username="gda-eval-explicit", password="test")
    project = Project.objects.create(name="Goal Eval Explicit", owner=user)
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Create hello file",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "hello file exists",
                    "target_conditions": (
                        {
                            "dimension_id": "workspace.file.exists",
                            "subject_ref": "file:///workspace/hello.txt",
                            "operator": "eq",
                            "expected_value": {"exists": True},
                        },
                    ),
                },
            ),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v2", observed_at=now, source_refs=("seed:1",)),
            facts={},
        ),
        status="running",
    )
    entry = ProjectStateEntry.objects.create(
        project=project,
        dimension_id="workspace.file.exists",
        schema_ref="workspace.file.status.v1",
        origin="observed",
        value={"exists": True},
        valid_from=now,
        provenance_refs=["obs:file-1"],
        state_version_id="v2",
    )

    summary = evaluate_objective(
        objective=run_spec.objective,
        state_entries=(project_state_entry_to_contract(entry),),
        legacy_facts={},
    )

    assert summary.status == "satisfied"
    assert summary.goal_progress[0].status == "satisfied"
