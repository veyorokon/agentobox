import pytest
from asgiref.sync import sync_to_async
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from unittest.mock import AsyncMock, patch

from agents.models import Agent, AgentStatus
from config.app_config import app_config
from projects.models import Project
from schema import schema


pytestmark = pytest.mark.integration


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_delete_project_tombstones_project_and_stops_live_agents():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="project_delete_user", password="test")
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Delete Project", owner=user
    )
    agent_a = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="team-lead", project=project, runtime="modal", status=AgentStatus.IDLE
    )
    agent_b = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="worker", project=project, runtime="modal", status=AgentStatus.RUNNING
    )
    await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="history", project=project, runtime="modal", status=AgentStatus.STOPPED
    )

    request = RequestFactory().post("/graphql")
    request.user = user

    with patch("agents.services.lifecycle.kill_agent", new_callable=AsyncMock) as mock_kill:
        mock_kill.return_value = True
        result = await schema.execute(
            """
            mutation ($id: ID!) {
                deleteProject(id: $id)
            }
            """,
            variable_values={"id": str(project.id)},
            context_value={"request": request},
        )

    assert result.errors is None
    assert result.data == {"deleteProject": True}
    assert {args.args[0] for args in mock_kill.await_args_list} == {
        str(agent_a.id),
        str(agent_b.id),
    }

    assert not await Project.objects.filter(id=project.id).aexists()

    tombstoned = await sync_to_async(Project.all_objects.get, thread_sensitive=True)(id=project.id)
    assert tombstoned.deleted_at is not None
    assert tombstoned.archived_at is not None


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_deleted_project_is_hidden_from_project_queries():
    from django.utils import timezone

    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="project_query_user", password="test")
    live = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Live Project", owner=user
    )
    deleted = await sync_to_async(Project.all_objects.create, thread_sensitive=True)(
        name="Deleted Project",
        owner=user,
        deleted_at=timezone.now(),
    )

    request = RequestFactory().post("/graphql")
    request.user = user

    result = await schema.execute(
        """
        query {
            projects {
                id
                name
            }
        }
        """,
        context_value={"request": request},
    )

    assert result.errors is None
    assert result.data == {
        "projects": [{"id": str(live.id), "name": "Live Project"}]
    }
    assert deleted.id != live.id


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_create_project_uses_haiku_for_smoke_user_team_lead():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="demo", password="test")

    request = RequestFactory().post("/graphql")
    request.user = user

    old_smoke_user = app_config.smoke_test_user
    old_test_model = app_config.test_agent_model
    app_config.smoke_test_user = "demo"
    app_config.test_agent_model = ""
    try:
        with patch("agents.services.lifecycle.spawn_team_lead", new_callable=AsyncMock) as mock_spawn:
            result = await schema.execute(
                """
                mutation ($input: CreateProjectInput!) {
                    createProject(input: $input) {
                        id
                        name
                    }
                }
                """,
                variable_values={"input": {"name": "Smoke Project", "description": ""}},
                context_value={"request": request},
            )
    finally:
        app_config.smoke_test_user = old_smoke_user
        app_config.test_agent_model = old_test_model

    assert result.errors is None
    assert result.data["createProject"]["name"] == "Smoke Project"
    mock_spawn.assert_awaited_once()
    assert mock_spawn.await_args.kwargs["model_override"] == "claude-haiku-4-5-20251001"


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_create_project_does_not_override_team_lead_model_for_normal_user():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="alice", password="test")

    request = RequestFactory().post("/graphql")
    request.user = user

    old_smoke_user = app_config.smoke_test_user
    old_test_model = app_config.test_agent_model
    app_config.smoke_test_user = "demo"
    app_config.test_agent_model = ""
    try:
        with patch("agents.services.lifecycle.spawn_team_lead", new_callable=AsyncMock) as mock_spawn:
            result = await schema.execute(
                """
                mutation ($input: CreateProjectInput!) {
                    createProject(input: $input) {
                        id
                        name
                    }
                }
                """,
                variable_values={"input": {"name": "Normal Project", "description": ""}},
                context_value={"request": request},
            )
    finally:
        app_config.smoke_test_user = old_smoke_user
        app_config.test_agent_model = old_test_model

    assert result.errors is None
    assert result.data["createProject"]["name"] == "Normal Project"
    mock_spawn.assert_awaited_once()
    assert mock_spawn.await_args.kwargs["model_override"] == ""
