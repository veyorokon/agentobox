import structlog
import strawberry
from strawberry import ID
from strawberry.scalars import JSON
from strawberry.types import Info

from agents.utils import sanitize_name as _sanitize_name
from agents.services.themes import VALID_THEME_KEYS, is_valid_theme_value
from projects.graphql.types import ProjectType

log = structlog.get_logger("projects.mutations")
DEFAULT_TEST_AGENT_MODEL = "claude-haiku-4-5-20251001"


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
    theme: str | None = None
    mode: str | None = None
    overrides: JSON | None = None
    tokens: JSON | None = None


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
        from config.app_config import app_config

        model_override = ""
        if user.username == app_config.smoke_test_user:
            model_override = app_config.test_agent_model.strip() or DEFAULT_TEST_AGENT_MODEL

        try:
            await spawn_team_lead(str(project.id), model_override=model_override)
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
        from agents.services.utils import terminate_sandbox
        from projects.models import Project
        from projects.services.state_volume import delete_project_state_volume

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
            elif agent.sandbox_id:
                await terminate_sandbox(
                    agent,
                    log.bind(project_id=str(project.id), agent_id=str(agent.id), operation="project_delete_cleanup"),
                )

        await delete_project_state_volume(str(project.id))

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

        project = await Project.objects.aget(id=input.project_id, owner=user)
        overrides = input.overrides if isinstance(input.overrides, dict) else None
        tokens = input.tokens if isinstance(input.tokens, dict) else None

        for bucket in (overrides or {}, tokens or {}):
            invalid_keys = set(bucket.keys()) - VALID_THEME_KEYS
            if invalid_keys:
                raise ValueError(f"Invalid token keys: {invalid_keys}")
            for key, value in bucket.items():
                if not is_valid_theme_value(value):
                    raise ValueError(
                        f"Token '{key}' must be a non-empty CSS value without ';', '{{', or '}}'"
                    )

        project.set_theme_document(
            theme=input.theme,
            mode=input.mode,
            overrides=overrides,
            tokens=tokens,
        )
        await project.asave(update_fields=["theme_document", "theme_tokens"])

        from agents.services.relay import push_theme_to_agents
        await push_theme_to_agents(project)
        return True
