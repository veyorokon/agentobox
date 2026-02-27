import structlog

import strawberry
from asgiref.sync import sync_to_async
from strawberry import ID
from strawberry.scalars import JSON

from agents.graphql.auth import authorize_agent, authorize_agents, authorize_project
from agents.graphql.types import AgentFeedbackType, AgentType, ProjectSecretType, TeamFeedItemType, VncTokenResult

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
    mode: str = "auto"
    tags: list[str] | None = None


@strawberry.input
class RecipientInput:
    type: str   # "agent" | "tag" | "all"
    value: str = ""


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
    tags: list[str] | None = None
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
            mode=input.mode,
            tags=input.tags,
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
        """Accept frontend vocabulary (auto/plan/supervised), map to Claude Code mode."""
        from agents.services.comms import set_agent_mode

        await authorize_agent(info, agent_id)
        return await set_agent_mode(agent_id, mode)

    @strawberry.mutation
    async def send_message(
        self,
        project_id: ID,
        text: str,
        recipients: list[RecipientInput],
        info: strawberry.types.Info,
    ) -> bool:
        """Send message to resolved agents. Recipients can be agent names, tags, or 'all'."""
        from agents.models import Agent
        from agents.services.comms import send_message as _send_single, broadcast_message

        await authorize_project(info, project_id)

        # Resolve recipients to agent IDs — scoped to the given project
        agent_ids: list[str] = []
        for r in recipients:
            if r.type == "all":
                all_agents = [
                    a async for a in Agent.objects.filter(
                        project_id=project_id,
                    ).exclude(status="stopped")
                ]
                agent_ids.extend(str(a.id) for a in all_agents)
            elif r.type == "agent":
                agent = await Agent.objects.filter(
                    name=r.value, project_id=project_id,
                ).afirst()
                if agent:
                    agent_ids.append(str(agent.id))
                else:
                    log.warning("recipient_not_found", type=r.type, value=r.value)
            elif r.type == "tag":
                tagged = [
                    a async for a in Agent.objects.filter(
                        project_id=project_id, tags__contains=[r.value],
                    ).exclude(status="stopped")
                ]
                agent_ids.extend(str(a.id) for a in tagged)

        if not agent_ids:
            return False

        # Deduplicate
        agent_ids = list(dict.fromkeys(agent_ids))

        # Create user feed item
        from agents.services.feed import create_feed_item

        target_str = ", ".join(r.value for r in recipients if r.value)
        await create_feed_item(
            project_id=str(project_id),
            type="user",
            text=text,
            target=target_str or "all",
        )

        if len(agent_ids) == 1:
            return await _send_single(agent_ids[0], text)
        else:
            return await broadcast_message(agent_ids, text)

    @strawberry.mutation
    async def answer_question(self, input: AnswerQuestionInput, info: strawberry.types.Info) -> bool:
        from agents.services.comms import answer_question

        await authorize_agent(info, input.agent_id)
        return await answer_question(input.agent_id, input.tool_use_id, input.answer_text)

    @strawberry.mutation
    async def resolve_permission(
        self,
        feed_item_id: ID,
        verdict: str,
        info: strawberry.types.Info,
    ) -> TeamFeedItemType:
        """Resolve a permission prompt. verdict: 'allowed' | 'denied'."""
        from agents.models import TeamFeedItem
        from agents.services.feed import resolve_permission
        from agents.graphql.types import model_to_feed_item_type

        item = await TeamFeedItem.objects.aget(id=feed_item_id)

        # Auth: ensure user owns the project
        user = info.context["request"].user
        from projects.models import Project
        await Project.objects.aget(id=item.project_id, owner=user)

        item = await resolve_permission(item, verdict)
        return model_to_feed_item_type(item)

    @strawberry.mutation
    async def resolve_plan(
        self,
        feed_item_id: ID,
        verdict: str,
        info: strawberry.types.Info,
    ) -> TeamFeedItemType:
        """Resolve a plan proposal. verdict: 'approved' | 'rejected'."""
        from agents.models import TeamFeedItem
        from agents.services.feed import resolve_plan
        from agents.graphql.types import model_to_feed_item_type

        item = await TeamFeedItem.objects.aget(id=feed_item_id)

        user = info.context["request"].user
        from projects.models import Project
        await Project.objects.aget(id=item.project_id, owner=user)

        item = await resolve_plan(item, verdict)
        return model_to_feed_item_type(item)

    @strawberry.mutation
    async def create_vnc_token(
        self,
        agent_id: ID,
        info: strawberry.types.Info,
    ) -> VncTokenResult:
        """Generate a short-lived token for VNC proxy WebSocket auth."""
        import secrets
        from datetime import datetime, timedelta, timezone

        from django.core.cache import cache

        await authorize_agent(info, agent_id)

        token = secrets.token_urlsafe(32)
        cache_key = f"vnc_token:{token}"
        cache.set(cache_key, str(agent_id), timeout=60)

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=60)
        return VncTokenResult(token=token, expires_at=expires_at.isoformat())

    @strawberry.mutation
    async def update_agent_instructions(self, input: UpdateAgentInstructionsInput, info: strawberry.types.Info) -> AgentType:
        from agents.models import Agent, AgentStatus
        from agents.runtimes import get_runtime
        from agents.adapters import get_adapter
        from agents.services.provision import _resolve_mcp_instructions

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
                adapter = get_adapter(getattr(agent, "agent_type", "claude-code"))
                claude_md = adapter.build_instructions(
                    project_name=agent.project.name,
                    mcp_instructions=_resolve_mcp_instructions(agent.mcp_servers or None),
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
                log.exception("claude_md_write_failed", agent_name=agent.name)

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
        if input.tags is not None:
            agent.tags = input.tags

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

        update_fields = ["model", "role", "mcp_servers", "config_snapshot"]
        if input.tags is not None:
            update_fields.append("tags")
        await agent.asave(update_fields=update_fields)

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
        from agents.services.secrets import push_secrets_for_project
        await push_secrets_for_project(project)

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

