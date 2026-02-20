import structlog
from agents.models import Agent
from projects.models import Project

log = structlog.get_logger("agents.auth")


async def authorize_project(info, project_id) -> "Project":
    """Verify the request user owns the project. Raises on auth failure."""
    user = info.context["request"].user
    if not user.is_authenticated:
        raise PermissionError("Authentication required")
    return await Project.objects.aget(id=project_id, owner=user)


async def authorize_agent(info, agent_id) -> "Agent":
    """Verify the request user owns the agent's project. Raises on auth failure."""
    user = info.context["request"].user
    if not user.is_authenticated:
        raise PermissionError("Authentication required")
    return await Agent.objects.select_related("project").aget(
        id=agent_id, project__owner=user
    )


async def authorize_agents(info, agent_ids) -> list["Agent"]:
    """Verify the request user owns all agents. Returns list of agents."""
    user = info.context["request"].user
    if not user.is_authenticated:
        raise PermissionError("Authentication required")
    unique_ids = list({str(aid) for aid in agent_ids})
    agents = [
        a async for a in Agent.objects.select_related("project").filter(
            id__in=unique_ids, project__owner=user
        )
    ]
    if len(agents) != len(unique_ids):
        raise PermissionError("One or more agents not found or not owned by user")
    return agents
