import pytest
from asgiref.sync import sync_to_async
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from unittest.mock import AsyncMock, patch

from agents.models import Agent, AgentStatus
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
