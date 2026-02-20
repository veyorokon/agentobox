import structlog

import strawberry
from asgiref.sync import sync_to_async
from strawberry import ID
from strawberry.scalars import JSON

from agents.graphql.auth import authorize_agent, authorize_agents, authorize_project
from agents.graphql.types import AgentFeedbackType, AgentType, ProjectSecretType

log = structlog.get_logger("agents.mutations")


@strawberry.input
class VolumeMountInput:
    name: str
    mount_path: str
    host_path: str = ""
    read_only: bool = False


@strawberry.input
class CreateAgentInput:
    project_id: ID
    name: str
    runtime: str = "modal"
    model: str = "claude-sonnet-4-5-20250929"
    mcp_servers: JSON | None = None
    workspace_path: str = ""
    volume_mounts: list[VolumeMountInput] | None = None
    instructions: str = ""
    role: str = "worker"


@strawberry.input
class SendMessageInput:
    agent_id: ID
    message: str = ""
    content: JSON | None = None  # ContentBlock[] — takes precedence over message


@strawberry.input
class BroadcastMessageInput:
    agent_ids: list[ID]
    message: str = ""
    content: JSON | None = None  # ContentBlock[] — takes precedence over message


@strawberry.input
class AnswerQuestionInput:
    agent_id: ID
    tool_use_id: str
    answer_text: str


@strawberry.input
class UpdateAgentInstructionsInput:
    agent_id: ID
    instructions: str


@strawberry.input
class RateFeedbackInput:
    agent_id: ID
    message_id: ID | None = None
    rating: int
    comment: str = ""


@strawberry.input
class UpdateAgentConfigInput:
    agent_id: ID
    model: str | None = None
    role: str | None = None
    mcp_registry_names: list[str] | None = None
    mcp_custom_servers: JSON | None = None


@strawberry.input
class SetSecretInput:
    project_id: ID
    key: str
    value: str


@strawberry.input
class ScopeSecretInput:
    project_id: ID
    key: str
    agent_ids: list[ID]  # empty = all agents (unscoped)


@strawberry.type
class AgentMutation:
    @strawberry.mutation
    async def create_agent(self, input: CreateAgentInput, info: strawberry.types.Info) -> AgentType:
        from agents.services.lifecycle import create_agent
        from agents.services.provision import resolve_mcp_servers

        await authorize_project(info, input.project_id)

        # mcp_servers can be a list of names (resolved via registry) or a full dict
        mcp_config = None
        if input.mcp_servers:
            if isinstance(input.mcp_servers, list):
                mcp_config = resolve_mcp_servers(input.mcp_servers)
            elif isinstance(input.mcp_servers, dict):
                mcp_config = input.mcp_servers

        # Convert VolumeMountInput list to dicts for JSONField storage
        vm_dicts = None
        if input.volume_mounts:
            vm_dicts = [
                {
                    "name": vm.name,
                    "mount_path": vm.mount_path,
                    "host_path": vm.host_path,
                    "read_only": vm.read_only,
                }
                for vm in input.volume_mounts
            ]

        return await create_agent(
            project_id=input.project_id,
            name=input.name,
            runtime_name=input.runtime,
            model=input.model,
            mcp_servers=mcp_config,
            workspace_path=input.workspace_path,
            instructions=input.instructions,
            role=input.role,
            volume_mounts=vm_dicts,
        )

    @strawberry.mutation
    async def kill_agent(self, agent_id: ID, info: strawberry.types.Info) -> bool:
        from agents.services.lifecycle import kill_agent

        await authorize_agent(info, agent_id)
        return await kill_agent(agent_id)

    @strawberry.mutation
    async def remove_agent(self, agent_id: ID, info: strawberry.types.Info) -> bool:
        from agents.services.lifecycle import remove_agent

        await authorize_agent(info, agent_id)
        return await remove_agent(agent_id)

    @strawberry.mutation
    async def hard_restart_agent(self, agent_id: ID, info: strawberry.types.Info) -> AgentType:
        from agents.services.lifecycle import hard_restart_agent

        await authorize_agent(info, agent_id)
        return await hard_restart_agent(agent_id)

    @strawberry.mutation
    async def interrupt_agent(self, agent_id: ID, info: strawberry.types.Info) -> bool:
        from agents.services.comms import interrupt_agent

        await authorize_agent(info, agent_id)
        return await interrupt_agent(agent_id)

    @strawberry.mutation
    async def restart_agent(self, agent_id: ID, info: strawberry.types.Info) -> bool:
        from agents.services.comms import restart_agent

        await authorize_agent(info, agent_id)
        return await restart_agent(agent_id)

    @strawberry.mutation
    async def clear_agent_session(self, agent_id: ID, info: strawberry.types.Info) -> bool:
        from agents.services.comms import clear_agent_session

        await authorize_agent(info, agent_id)
        return await clear_agent_session(agent_id)

    @strawberry.mutation
    async def set_agent_mode(self, agent_id: ID, mode: str, info: strawberry.types.Info) -> AgentType:
        from agents.services.comms import set_agent_mode

        await authorize_agent(info, agent_id)
        return await set_agent_mode(agent_id, mode)

    @strawberry.mutation
    async def send_message(self, input: SendMessageInput, info: strawberry.types.Info) -> bool:
        from agents.services.comms import send_message

        await authorize_agent(info, input.agent_id)
        return await send_message(input.agent_id, input.message, input.content)

    @strawberry.mutation
    async def broadcast_message(self, input: BroadcastMessageInput, info: strawberry.types.Info) -> bool:
        from agents.services.comms import broadcast_message

        await authorize_agents(info, input.agent_ids)
        return await broadcast_message(
            [str(aid) for aid in input.agent_ids],
            input.message,
            input.content,
        )

    @strawberry.mutation
    async def answer_question(self, input: AnswerQuestionInput, info: strawberry.types.Info) -> bool:
        from agents.services.comms import answer_question

        await authorize_agent(info, input.agent_id)
        return await answer_question(input.agent_id, input.tool_use_id, input.answer_text)

    @strawberry.mutation
    async def update_agent_instructions(self, input: UpdateAgentInstructionsInput, info: strawberry.types.Info) -> AgentType:
        from agents.models import Agent, AgentStatus
        from agents.runtimes import get_runtime
        from agents.services.provision import _build_claude_md

        agent = await authorize_agent(info, input.agent_id)
        agent.instructions = input.instructions
        await agent.asave(update_fields=["instructions"])

        # Rewrite CLAUDE.md on the running container if it has a sandbox
        if agent.sandbox_id:
            try:
                # Build team roster (same as provisioning)
                all_agents = await sync_to_async(
                    lambda: list(
                        Agent.objects.filter(project=agent.project)
                        .exclude(status=AgentStatus.STOPPED)
                    ),
                    thread_sensitive=False,
                )()
                team_members = [
                    {"name": a.name, "role": a.role, "instructions": a.instructions or ""}
                    for a in all_agents
                ]

                team_name = agent.project.name.lower().replace(" ", "-")
                runtime = get_runtime(agent.runtime)
                claude_md = _build_claude_md(
                    agent.project,
                    mcp_servers=agent.mcp_servers or None,
                    workspace_path=agent.workspace_path,
                    instructions=input.instructions,
                    agent_role=agent.role,
                    agent_name=agent.name,
                    team_members=team_members,
                    team_name=team_name,
                )
                await runtime.write_file(
                    agent.sandbox_id,
                    claude_md.encode("utf-8"),
                    "/home/agent/CLAUDE.md",
                )
            except Exception:
                log.warning("claude_md_write_failed", agent=agent.name, exc_info=True)

        return agent

    @strawberry.mutation
    async def rate_agent(self, input: RateFeedbackInput, info: strawberry.types.Info) -> AgentFeedbackType | None:
        from agents.models import Agent, AgentFeedback

        if input.rating not in (1, 2, 3):
            raise ValueError("rating must be 1, 2, or 3")

        agent = await authorize_agent(info, input.agent_id)

        # Toggle: if same agent+rating exists, delete it (undo)
        existing = await AgentFeedback.objects.filter(agent=agent).afirst()
        if existing:
            if existing.rating == input.rating:
                await existing.adelete()
                return None  # Toggled off
            # Different rating — update in place
            existing.rating = input.rating
            existing.comment = input.comment
            await existing.asave(update_fields=["rating", "comment"])
            return existing

        return await AgentFeedback.objects.acreate(
            agent=agent,
            session_id=agent.session_id,
            rating=input.rating,
            comment=input.comment,
        )

    @strawberry.mutation
    async def update_agent_config(self, input: UpdateAgentConfigInput, info: strawberry.types.Info) -> AgentType:
        from agents.models import Agent
        from agents.services.lifecycle import hard_restart_agent
        from agents.services.provision import resolve_mcp_servers

        agent = await authorize_agent(info, input.agent_id)

        if input.model is not None:
            agent.model = input.model
        if input.role is not None:
            agent.role = input.role

        # Merge registry MCPs + custom MCPs
        mcp_servers = agent.mcp_servers or {}
        if input.mcp_registry_names is not None or input.mcp_custom_servers is not None:
            resolved = {}
            if input.mcp_registry_names is not None:
                resolved = resolve_mcp_servers(input.mcp_registry_names)
            if input.mcp_custom_servers and isinstance(input.mcp_custom_servers, dict):
                resolved.update(input.mcp_custom_servers)
            mcp_servers = resolved
        agent.mcp_servers = mcp_servers

        # Update config_snapshot so hard_restart picks up new values
        config = agent.config_snapshot or {}
        config["model"] = agent.model
        config["role"] = agent.role
        config["mcp_servers"] = agent.mcp_servers
        agent.config_snapshot = config

        await agent.asave(update_fields=[
            "model", "role", "mcp_servers", "config_snapshot",
        ])

        return await hard_restart_agent(str(agent.id))

    # --- Project Secrets ---

    @strawberry.mutation
    async def set_secret(self, input: SetSecretInput, info: strawberry.types.Info) -> ProjectSecretType:
        """Create or update a project secret (upsert by project + key)."""
        from agents.models import ProjectSecret
        from agents.services.secrets import encrypt_value
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.aget(id=input.project_id, owner=user)

        secret, created = await ProjectSecret.objects.aupdate_or_create(
            project=project,
            key=input.key,
            defaults={"encrypted_value": encrypt_value(input.value)},
        )

        # Push secrets to all running agents (both create and update)
        await _push_secrets_for_project(project)

        return secret

    @strawberry.mutation
    async def delete_secret(self, project_id: ID, key: str, info: strawberry.types.Info) -> bool:
        """Delete a project secret by key."""
        from agents.models import ProjectSecret

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        try:
            secret = await ProjectSecret.objects.aget(
                project_id=project_id, project__owner=user, key=key,
            )
            await secret.adelete()
            return True
        except ProjectSecret.DoesNotExist:
            return False

    @strawberry.mutation
    async def scope_secret(self, input: ScopeSecretInput, info: strawberry.types.Info) -> ProjectSecretType:
        """Set which agents a secret is restricted to. Empty = all agents."""
        from agents.models import Agent, ProjectSecret

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        secret = await ProjectSecret.objects.aget(
            project_id=input.project_id, project__owner=user, key=input.key,
        )

        if input.agent_ids:
            unique_ids = list({str(aid) for aid in input.agent_ids})
            agents = [
                a async for a in Agent.objects.filter(
                    id__in=unique_ids,
                    project_id=input.project_id,
                    project__owner=user,
                )
            ]
            if len(agents) != len(unique_ids):
                raise PermissionError("One or more agents not found or not owned by user")
            await secret.scoped_agents.aset(agents)
        else:
            await secret.scoped_agents.aclear()

        return secret

async def _push_secrets_for_project(project) -> None:
    """Push merged secrets to all running agents in a project."""
    from agents.models import Agent, AgentStatus
    from agents.runtimes import get_runtime
    from agents.services.lifecycle import resolve_agent_secrets
    from agents.services.provision import push_secrets_to_agent

    import structlog
    op_log = structlog.get_logger("agents.secrets")

    running_agents = [
        a async for a in Agent.objects.filter(
            project=project,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
        ).exclude(sandbox_id="")
    ]

    for agent in running_agents:
        try:
            secret_envs = await resolve_agent_secrets(agent, op_log)
            if secret_envs:
                runtime = get_runtime(agent.runtime)
                await push_secrets_to_agent(
                    runtime, agent.sandbox_id, agent, secret_envs,
                )
        except Exception:
            op_log.warning("secret_push_failed", agent=agent.name, exc_info=True)
