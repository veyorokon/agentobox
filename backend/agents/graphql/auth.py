import structlog
from agents.models import Agent
from projects.models import Project

log = structlog.get_logger("agents.auth")


async def _get_user(info):
    """Extract authenticated user from Strawberry info context.

    Three auth paths in priority order:
    1. HTTP request.user — set by TokenAuthMiddleware (Bearer/ApiKey header)
    2. WS scope["user"] — set by AuthMiddlewareStack (session cookies)
    3. WS connectionParams — Bearer token sent via graphql-ws connection_init

    Path 3 exists because browsers can't set custom headers on WebSocket
    connections. The dashboard sends the Bearer token in connectionParams
    instead, and Strawberry stores it in context["connection_params"].
    """
    request = info.context["request"]

    # HTTP: Django request has .user set by TokenAuthMiddleware
    if hasattr(request, "user") and request.user.is_authenticated:
        return request.user

    # WS: check scope["user"] from AuthMiddlewareStack (session auth)
    if hasattr(request, "scope"):
        scope_user = request.scope.get("user")
        if scope_user and scope_user.is_authenticated:
            return scope_user

    # WS: check connectionParams Bearer token (graphql-ws protocol)
    params = info.context.get("connection_params") or {}
    auth_header = params.get("authorization", "")
    if auth_header.startswith("Bearer "):
        from accounts.auth import adecode_token

        return await adecode_token(auth_header[7:])

    return None


async def authorize_project(info, project_id) -> "Project":
    """Verify the request user owns the project. Raises on auth failure."""
    user = await _get_user(info)
    if not user or not user.is_authenticated:
        raise PermissionError("Authentication required")
    return await Project.objects.aget(id=project_id, owner=user)


async def authorize_agent(info, agent_id) -> "Agent":
    """Verify the request user owns the agent's project. Raises on auth failure."""
    user = await _get_user(info)
    if not user or not user.is_authenticated:
        raise PermissionError("Authentication required")
    return await Agent.objects.select_related("project").aget(
        id=agent_id, project__owner=user
    )


async def authorize_agents(info, agent_ids) -> list["Agent"]:
    """Verify the request user owns all agents. Returns list of agents."""
    user = await _get_user(info)
    if not user or not user.is_authenticated:
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
