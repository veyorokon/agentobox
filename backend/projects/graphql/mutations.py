import re

import structlog
import strawberry
from strawberry import ID
from strawberry.scalars import JSON
from strawberry.types import Info

from projects.graphql.types import ProjectType

log = structlog.get_logger("projects.mutations")

VALID_THEME_KEYS = frozenset({
    "surface", "surface-raised", "surface-sunken", "surface-overlay",
    "surface-backdrop", "surface-invert",
    "text-default", "text-secondary", "text-muted", "text-disabled", "text-on-emphasis",
    "border-default", "border-subtle", "border-strong",
    "accent", "accent-hover", "accent-subtle", "text-accent",
    "info", "text-info", "text-info-hover",
    "pro", "text-pro",
    "text-link", "text-link-hover",
    "success", "text-success", "success-subtle",
    "danger", "text-danger", "danger-subtle",
    "warning", "text-warning", "warning-subtle",
    "avatar-saturation", "avatar-lightness",
    "interactive", "interactive-active", "ring-focus",
})
# Accept #RRGGBB hex, rgba(...), hsl(...), and bare values (e.g. "35%" for avatar tokens)
_TOKEN_VALUE_RE = re.compile(
    r"^(#[0-9a-fA-F]{6}|rgba?\(.+\)|hsla?\(.+\)|\d+%?)$"
)


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
        from django.utils import timezone

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

        # Spawn team-lead agent explicitly (no hidden signal side effects).
        # Runs in background via create_agent's spawn_logged_task so the
        # mutation returns immediately.
        from agents.services.lifecycle import spawn_team_lead

        try:
            await spawn_team_lead(str(project.id))
        except Exception:
            log.exception("create_project.team_lead_failed", project_id=str(project.id))
            # Preserve the failed project as a tombstone for audit/debugging,
            # but hide it from normal project queries.
            project.deleted_at = timezone.now()
            project.archived_at = project.deleted_at
            await project.asave(update_fields=["deleted_at", "archived_at"])
            raise Exception("Failed to initialize project — team lead could not be created")

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
        from django.utils import timezone

        from agents.models import Agent, AgentStatus
        from agents.services.lifecycle import kill_agent
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.aget(id=id, owner=user)

        live_statuses = {
            AgentStatus.DEPLOYING,
            AgentStatus.RUNNING,
            AgentStatus.WAITING,
            AgentStatus.IDLE,
        }
        for agent in [a async for a in Agent.objects.filter(project=project)]:
            if agent.status in live_statuses:
                await kill_agent(str(agent.id))

        project.deleted_at = timezone.now()
        if project.archived_at is None:
            project.archived_at = project.deleted_at
        await project.asave(update_fields=["deleted_at", "archived_at"])
        return True

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
            if not isinstance(value, str) or not _TOKEN_VALUE_RE.match(value):
                raise ValueError(f"Token '{key}' must be a valid CSS value (#RRGGBB, rgba(), hsl(), or percentage)")

        project = await Project.objects.aget(id=input.project_id, owner=user)
        project.theme_tokens = tokens
        await project.asave(update_fields=["theme_tokens"])

        from agents.services.relay import push_theme_to_agents
        await push_theme_to_agents(project)
        return True
