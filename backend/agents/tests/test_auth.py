"""Tests for agents.graphql.auth authorization helpers."""

import pytest

from agents.graphql.auth import authorize_agent, authorize_agents, authorize_project
from agents.models import Agent, AgentStatus
from projects.models import Project

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.integration]


# ---------------------------------------------------------------------------
# authorize_project
# ---------------------------------------------------------------------------


async def test_authorize_project_authenticated(auth_info, project):
    """Correct owner retrieves their project."""
    result = await authorize_project(auth_info, project.id)
    assert result.id == project.id
    assert result.name == project.name


async def test_authorize_project_unauthenticated(unauth_info, project):
    """Anonymous user raises PermissionError."""
    with pytest.raises(PermissionError, match="Authentication required"):
        await authorize_project(unauth_info, project.id)


async def test_authorize_project_wrong_owner(other_user, project):
    """User who doesn't own the project gets DoesNotExist (aget filters by owner)."""
    from conftest import _make_info

    info = _make_info(other_user)
    with pytest.raises(Project.DoesNotExist):
        await authorize_project(info, project.id)


# ---------------------------------------------------------------------------
# authorize_agent
# ---------------------------------------------------------------------------


async def test_authorize_agent_authenticated(auth_info, agent):
    """Correct owner retrieves their agent."""
    result = await authorize_agent(auth_info, agent.id)
    assert result.id == agent.id
    assert result.name == agent.name


async def test_authorize_agent_unauthenticated(unauth_info, agent):
    """Anonymous user raises PermissionError."""
    with pytest.raises(PermissionError, match="Authentication required"):
        await authorize_agent(unauth_info, agent.id)


async def test_authorize_agent_wrong_owner(other_user, agent):
    """User who doesn't own the agent's project gets DoesNotExist."""
    from conftest import _make_info

    info = _make_info(other_user)
    with pytest.raises(Agent.DoesNotExist):
        await authorize_agent(info, agent.id)


# ---------------------------------------------------------------------------
# authorize_agents
# ---------------------------------------------------------------------------


async def test_authorize_agents_all_owned(auth_info, project):
    """All agents returned when user owns all of them."""
    a1 = await Agent.objects.acreate(
        name="agent-1", project=project, runtime="docker", status=AgentStatus.IDLE,
    )
    a2 = await Agent.objects.acreate(
        name="agent-2", project=project, runtime="docker", status=AgentStatus.IDLE,
    )
    result = await authorize_agents(auth_info, [a1.id, a2.id])
    result_ids = {a.id for a in result}
    assert result_ids == {a1.id, a2.id}


async def test_authorize_agents_partial_ownership(auth_info, project, other_user):
    """PermissionError when user doesn't own all requested agents."""
    other_project = await Project.objects.acreate(name="Other Project", owner=other_user)
    owned = await Agent.objects.acreate(
        name="owned-agent", project=project, runtime="docker", status=AgentStatus.IDLE,
    )
    not_owned = await Agent.objects.acreate(
        name="foreign-agent", project=other_project, runtime="docker", status=AgentStatus.IDLE,
    )
    with pytest.raises(PermissionError, match="not found or not owned"):
        await authorize_agents(auth_info, [owned.id, not_owned.id])
