import re

import structlog
import strawberry
from strawberry import ID
from strawberry.scalars import JSON
from strawberry.types import Info

from projects.graphql.types import ProjectType

log = structlog.get_logger("projects.mutations")

VALID_THEME_KEYS = frozenset({
    "background", "foreground", "surface", "accent", "muted-foreground", "destructive",
})
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


from agents.utils import sanitize_name as _sanitize_name


@strawberry.input
class CreateProjectInput:
    name: str
    description: str = ""


@strawberry.input
class UpdateProjectInput:
    id: ID
    name: str | None = None
    description: str | None = None
    settings: JSON | None = None


@strawberry.input
class SetProjectThemeInput:
    project_id: ID
    tokens: JSON


@strawberry.type
class ProjectMutation:
    @strawberry.mutation
    async def create_project(
        self, input: CreateProjectInput, info: Info
    ) -> ProjectType:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        name = _sanitize_name(input.name)
        if not name:
            raise ValueError("Project name cannot be empty")

        project = await Project.objects.acreate(
            name=name,
            description=input.description,
            owner=user,
        )

        # Team-lead auto-deploy is handled by the post_save signal in
        # projects/signals.py — no need to duplicate here. The signal
        # fires from acreate() above and schedules the agent creation
        # asynchronously so the mutation returns immediately.

        return project

    @strawberry.mutation
    async def update_project(
        self, input: UpdateProjectInput, info: Info
    ) -> ProjectType:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.aget(id=input.id, owner=user)
        update_fields: list[str] = []

        if input.name is not None:
            name = _sanitize_name(input.name)
            if not name:
                raise ValueError("Project name cannot be empty")
            project.name = name
            update_fields.append("name")

        if input.description is not None:
            project.description = input.description
            update_fields.append("description")

        if input.settings is not None:
            if not isinstance(input.settings, dict):
                raise ValueError("settings must be a JSON object")
            project.settings = input.settings
            update_fields.append("settings")

        if update_fields:
            await project.asave(update_fields=update_fields)
        return project

    @strawberry.mutation
    async def archive_project(self, id: ID, info: Info) -> ProjectType:
        from django.utils import timezone

        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.aget(id=id, owner=user)
        project.archived_at = timezone.now()
        await project.asave(update_fields=["archived_at"])
        return project

    @strawberry.mutation
    async def unarchive_project(self, id: ID, info: Info) -> ProjectType:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.aget(id=id, owner=user)
        project.archived_at = None
        await project.asave(update_fields=["archived_at"])
        return project

    @strawberry.mutation
    async def delete_project(self, id: ID, info: Info) -> bool:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        deleted, _ = await Project.objects.filter(id=id, owner=user).adelete()
        return deleted > 0

    @strawberry.mutation
    async def stop_all_agents(self, project_id: ID, info: Info) -> int:
        from agents.models import Agent, AgentStatus
        from agents.services.lifecycle import kill_agent

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        agents = Agent.objects.filter(
            project_id=project_id,
            project__owner=user,
            status__in=[
                AgentStatus.RUNNING,
                AgentStatus.DEPLOYING,
                AgentStatus.IDLE,
            ],
        )

        count = 0
        async for agent in agents:
            stopped = await kill_agent(str(agent.id))
            if stopped:
                count += 1
        return count

    @strawberry.mutation
    async def set_project_theme(self, input: SetProjectThemeInput, info: Info) -> bool:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        tokens = input.tokens
        if not isinstance(tokens, dict):
            raise ValueError("tokens must be a JSON object")

        invalid_keys = set(tokens.keys()) - VALID_THEME_KEYS
        if invalid_keys:
            raise ValueError(f"Invalid token keys: {invalid_keys}")

        for key, value in tokens.items():
            if not isinstance(value, str) or not _HEX_RE.match(value):
                raise ValueError(f"Token '{key}' must be a #RRGGBB hex string")

        project = await Project.objects.aget(id=input.project_id, owner=user)
        project.theme_tokens = tokens
        await project.asave(update_fields=["theme_tokens"])

        await _push_theme_for_project(project)
        return True


async def _push_theme_for_project(project) -> None:
    """Push theme tokens to all running agents in a project. Best-effort."""
    from agents.models import Agent, AgentStatus
    from agents.runtimes import get_runtime
    from agents.services.provision import write_theme_files

    running_agents = [
        a async for a in Agent.objects.filter(
            project=project,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
        ).exclude(sandbox_id="")
    ]

    for agent in running_agents:
        try:
            runtime = get_runtime(agent.runtime)
            await write_theme_files(runtime, agent.sandbox_id, project.theme_tokens)
        except Exception:
            log.exception("theme_push_failed", agent_name=agent.name, sandbox_id=agent.sandbox_id)
