from __future__ import annotations

from datetime import datetime, timezone

import pytest
from asgiref.sync import sync_to_async
from django.contrib.auth import get_user_model
from django.test import RequestFactory

from agents.models import Agent
from gda.models import ProjectExecution, ProjectObservation, ProjectStateEntry
from gda.services.assignment import assign_project_commitment
from gda.services.commitments import authorize_commitment, persist_commitment_proposal
from gda.services.compile import compile_run_spec_for_project
from gda.services.state import persist_run_spec_state
from gda_kernel import CommitmentProposal, State, StateVersion, project_ref, world_ref
from projects.models import Project
from schema import schema


pytestmark = pytest.mark.integration


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_project_query_exposes_gda_overview_projection():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="gda-graphql-user", password="test")
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="GDA GraphQL Project",
        owner=user,
    )
    worker = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        project=project,
        name="worker-agent",
        runtime="docker",
        status="idle",
        desired_status="deployed",
        role="worker",
        agent_type="claude-code",
        workspace_path="/workspace/agentobox",
        session_id="session:worker-agent",
        model="claude-sonnet-4-6",
        mode="auto",
        attention_level="none",
        task="",
        instructions="",
    )

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
    await sync_to_async(persist_run_spec_state, thread_sensitive=True)(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v1", observed_at=now, source_refs=("seed://test",)),
            facts={},
        ),
        status="running",
    )
    proposal = CommitmentProposal(
        capability_id="ops.check_runtime_health",
        arguments={"check": "runtime.health"},
        touched_scope=(project_ref(project.id),),
        expected_observation={"kind": "runtime.health.changed", "required": True},
        expected_outcome={"status": "ok", "required": True},
    )
    await sync_to_async(persist_commitment_proposal, thread_sensitive=True)(
        project=project,
        proposal=proposal,
        commitment_id="commitment-runtime-1",
        status="proposed",
        opened_at=now,
    )
    await sync_to_async(authorize_commitment, thread_sensitive=True)(
        project=project,
        commitment_id="commitment-runtime-1",
        activated_at=now,
    )
    await sync_to_async(assign_project_commitment, thread_sensitive=True)(
        project=project,
        commitment_id="commitment-runtime-1",
        agent=worker,
        dimension_ids=("runtime.health",),
        observation_kinds=("runtime.health.changed",),
    )
    await sync_to_async(ProjectStateEntry.objects.create, thread_sensitive=True)(
        project=project,
        dimension_id="runtime.health",
        schema_ref="status.runtime_health.v1",
        origin="observed",
        value={"status": "ready"},
        valid_from=now,
        state_version_id="v2",
    )
    await sync_to_async(ProjectObservation.objects.create, thread_sensitive=True)(
        project=project,
        observation_id="observation-runtime-1",
        kind="runtime.health.changed",
        subject=project_ref(project.id),
        observed_at=now,
        source_kind="agent",
        source_id=f"agent://{worker.id}",
        payload={"status": "ready"},
        quality="exact",
    )
    await sync_to_async(ProjectExecution.objects.create, thread_sensitive=True)(
        project=project,
        commitment_id=None,
        commitment=await sync_to_async(project.gda_commitments.get, thread_sensitive=True)(
            commitment_id="commitment-runtime-1"
        ),
        invocation_id="invocation-runtime-1",
        status="ok",
        completed_at=now,
    )

    request = RequestFactory().post("/graphql")
    request.user = user

    result = await schema.execute(
        """
        query ($id: ID!) {
          project(id: $id) {
            id
            gdaOverview {
              contextVersionId
              worldRef
              objective {
                name
              }
              awareness {
                controlStatus
                stateEntryCount
                activeCommitmentCount
              }
              progress {
                status
                totalGoals
                satisfiedGoals
                goalProgress {
                  goalId
                  goalName
                  status
                }
              }
              activeCommitments {
                commitmentId
                capabilityId
                assignmentAgentName
              }
              recentObservations {
                observationId
                kind
                sourceKind
              }
              recentExecutions {
                invocationId
                status
                commitmentId
              }
              stateEntries {
                dimensionId
                origin
                value
              }
            }
          }
        }
        """,
        variable_values={"id": str(project.id)},
        context_value={"request": request},
    )

    assert result.errors is None
    overview = result.data["project"]["gdaOverview"]
    assert overview["objective"]["name"] == "Restore runtime readiness"
    assert overview["awareness"]["controlStatus"] == "running"
    assert overview["awareness"]["stateEntryCount"] == 1
    assert overview["progress"]["status"] == "satisfied"
    assert overview["progress"]["satisfiedGoals"] == 1
    assert overview["activeCommitments"][0]["assignmentAgentName"] == "worker-agent"
    assert overview["recentObservations"][0]["observationId"] == "observation-runtime-1"
    assert overview["recentExecutions"][0]["invocationId"] == "invocation-runtime-1"
    assert overview["stateEntries"][0]["dimensionId"] == "runtime.health"
