"""
Agent lifecycle management: create, kill, remove, hard-restart.

Orchestrates the full agent lifecycle from DB record creation through
container provisioning to teardown. create_agent creates the Agent row
immediately (so the dashboard sees it) then spawns _provision_agent as
a monitored background task for the slow container work.

Key invariants:
- _provision_agent runs detached from the HTTP request — all DB writes
  use sync_to_async(thread_sensitive=False) to avoid the dead
  CurrentThreadExecutor problem.
- hard_restart uses select_for_update()+transaction.atomic() to prevent
  concurrent restarts from orphaning containers.
- config_snapshot preserves creation-time config so restarts reprovision
  identically. session_id is captured for --resume context preservation.
- resolve_agent_secrets applies project-level secret scoping: a secret
  goes to an agent if it has no scoped_agents (default-all) or the agent
  is in its scoped set.

Container provisioning sequence:
    create container → symlink .claude to volume → write secrets →
    provision_workspace → write .relay_env → save relay_token →
    relay self-starts (polls for .relay_env) → spawn tmux log tail
"""
import json
import secrets

import structlog
from asgiref.sync import sync_to_async
from config.app_config import app_config
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from agents.errors import (
    ERR_LIFECYCLE_LOG_CAPTURE_FAILED,
    ERR_LIFECYCLE_PROVISION_CLEANUP_FAILED,
    ERR_LIFECYCLE_PROVISION_FAILED,
    ERR_LIFECYCLE_PROVISION_ORPHANED,
    ERR_LIFECYCLE_RELAY_SHUTDOWN_FAILED,
    ERR_LIFECYCLE_SECRET_DECRYPT_FAILED,
    ERR_LIFECYCLE_TERMINATE_FAILED,
)
from agents.models import (
    Agent,
    AgentLifecycleAttempt,
    AgentLifecycleAttemptStatus,
    DesiredStatus,
    AgentLifecycleKind,
    AgentStatus,
    IllegalTransitionError,
    StreamEvent,
    VALID_TRANSITIONS,
)
from agents.runtimes import get_runtime
from agents.runtimes.base import VolumeMount
from agents.schemas import ConfigSnapshot
from agents.services.broadcast import broadcast_agent_update
from agents.services.provision import provision_workspace
from agents.services.runtime_segments import (
    record_runtime_segment,
    record_runtime_segment_sync,
)
from agents.services.utils import create_stream_event, spawn_logged_task, terminate_sandbox
from agents.adapters import get_adapter
from agents.utils import sanitize_name as _sanitize_name

CONTAINER_WORKSPACE = "/home/agent/workspace"
ERR_LIFECYCLE_STUCK_DEPLOY = "ERR-LIFECYCLE-STUCK-DEPLOY"
ERR_LIFECYCLE_RUNTIME_DEAD = "ERR-LIFECYCLE-RUNTIME-DEAD"

log = structlog.get_logger("abox.lifecycle")




def _runtime_executor(agent_type: str, override: str = "") -> str:
    if override:
        return override
    if agent_type == "claude-code":
        return "claude_code"
    raise ValueError(f"unsupported agent executor for agent_type={agent_type!r}")


def transition_agent_status(agent: Agent, new_status: str, *, reason: str = "", force: bool = False) -> Agent:
    """Enforce the lifecycle state machine when changing agent status.

    Checks VALID_TRANSITIONS[agent.status] contains new_status. If illegal
    and force=False, raises IllegalTransitionError. If legal (or forced),
    updates agent.status and logs the transition.

    Args:
        agent: Agent instance (must have current status loaded).
        new_status: Target AgentStatus value.
        reason: Optional context for the transition log.
        force: Skip validation (for recovery paths like reconciler fixing stuck states).

    Returns:
        The agent with updated status (caller must still save).
    """
    old_status = agent.status

    if not force:
        valid = VALID_TRANSITIONS.get(old_status, set())
        if new_status not in valid:
            raise IllegalTransitionError(agent.id, old_status, new_status)

    agent.status = new_status
    log.info(
        "lifecycle.status_transition",
        agent_id=str(agent.id),
        previous_status=old_status,
        next_status=new_status,
        reason=reason,
        forced=force,
    )
    return agent


def _resolve_api_key(model: str, secret_envs: dict[str, str] | None) -> str:
    """Resolve API key for the model's provider.

    Priority:
      1. Project secret matching the provider's conventional key name
      2. Global ANTHROPIC_API_KEY from settings (Anthropic only)
      3. Empty string (caller must validate — see _provision_agent)
    """
    from agents.adapters.claude_code.registries import PROVIDER_SECRET_KEYS

    provider = model.split("/", 1)[0] if "/" in model else "anthropic"
    key_name = PROVIDER_SECRET_KEYS.get(provider, "")
    if secret_envs and key_name and key_name in secret_envs:
        return secret_envs[key_name]
    if provider == "anthropic":
        return app_config.anthropic_api_key
    return ""



async def create_agent(
    project_id: str,
    name: str,
    runtime_name: str,
    model: str = "claude-sonnet-4-5-20250929",
    mcp_servers: dict | None = None,
    workspace_path: str = "",
    instructions: str = "",
    role: str = "worker",
    volume_mounts: list[dict] | None = None,
    mode: str = "auto",
    tags: list[str] | None = None,
    agent_type: str = "claude-code",
    triggers: list | None = None,
) -> Agent:
    """Create agent record immediately, provision container in background."""
    from projects.models import Project

    name = _sanitize_name(name)
    if not name:
        raise ValueError("Agent name cannot be empty")

    # Reject container-internal paths — Docker bind mounts need host paths
    if workspace_path and not workspace_path.startswith("/"):
        raise ValueError(f"workspace_path must be an absolute host path, got: {workspace_path}")
    if workspace_path and workspace_path.startswith(("/workspace", "/home/agent")):
        raise ValueError(
            f"workspace_path looks like a container-internal path ({workspace_path}). "
            "Use the host filesystem path instead."
        )

    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("lifecycle.agent_creating", runtime=runtime_name, workspace_path=workspace_path)

    project = await Project.objects.aget(id=project_id)

    # Check for duplicate name within the same project
    if await Agent.objects.filter(project=project, name=name).aexists():
        raise ValueError(
            f"An agent named '{name}' already exists in this project"
        )

    # Resolve MCP names to full config; include defaults if none specified
    if not mcp_servers:
        from agents.adapters import get_adapter
        adapter = get_adapter(agent_type)
        default_names = adapter.default_mcp_names()
        resolved_mcps = adapter.resolve_mcp_servers(default_names) if default_names else {}
    else:
        resolved_mcps = mcp_servers

    # Build config snapshot for future restarts
    config_snapshot = ConfigSnapshot(
        runtime=runtime_name,
        model=model,
        agent_type=agent_type,
        mcp_servers=resolved_mcps,
        workspace_path=workspace_path,
        instructions=instructions,
        role=role,
        volume_mounts=volume_mounts or [],
    ).to_dict()

    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        runtime=runtime_name,
        model=model,
        agent_type=agent_type,
        sandbox_id="",
        vnc_url="",
        status=AgentStatus.DEPLOYING,
        desired_status=DesiredStatus.DEPLOYED,
        mcp_servers=resolved_mcps,
        workspace_path=workspace_path,
        volume_mounts=volume_mounts or [],
        instructions=instructions,
        role=role,
        mode=mode,
        tags=tags or [],
        triggers=triggers or [],
        config_snapshot=config_snapshot,
    )

    # Resolve project secrets for this agent (default-all with optional scoping)
    secret_envs = await resolve_agent_secrets(agent, op_log)

    await broadcast_agent_update(agent)
    await create_stream_event(
        agent, event_type="created",
        data={"name": name, "runtime": runtime_name},
        session_id="",
    )

    correlation_id = secrets.token_hex(12)
    attempt = await _create_lifecycle_attempt(
        str(agent.id),
        AgentLifecycleKind.CREATE,
        correlation_id,
        step="queued",
        metadata={"runtime": runtime_name},
    )

    op_log.info("lifecycle.agent_created", agent_id=str(agent.id))

    spawn_logged_task(
        _provision_agent(
            agent,
            project,
            runtime_name,
            op_log.bind(correlation_id=correlation_id, attempt_id=str(attempt.id)),
            secret_envs,
            attempt_id=str(attempt.id),
        ),
        op_log=op_log,
        task_name=f"agent-provision:{agent.id}",
        event="lifecycle.provision_task",
        agent_id=str(agent.id),
        attempt_id=str(attempt.id),
        correlation_id=correlation_id,
    )

    return agent


def _save_agent_provisioned(agent_id, sandbox_id, vnc_url, team_name="", parent_session_id="", relay_token="", health_url=""):
    """Sync helper: save sandbox details. Agent stays DEPLOYING until relay connects.

    Status transitions to IDLE in RelayConsumer.connect() — the agent isn't
    truly ready until the relay WebSocket is up and pending messages have been
    backfilled. Setting IDLE here created a race: the agent looked idle but
    had no relay connection, so messages sent during that window were lost.
    """
    agent = Agent.objects.get(id=agent_id)
    agent.sandbox_id = sandbox_id
    agent.vnc_url = vnc_url
    agent.team_name = team_name
    agent.parent_session_id = parent_session_id
    agent.relay_token = relay_token
    # Store health_url in config_snapshot (ephemeral, changes per deploy)
    if health_url and agent.config_snapshot:
        agent.config_snapshot["health_url"] = health_url
    update_fields = [
        "sandbox_id", "vnc_url", "team_name",
        "parent_session_id", "relay_token", "updated_at",
    ]
    if health_url and agent.config_snapshot:
        update_fields.append("config_snapshot")
    agent.save(update_fields=update_fields)
    return agent


def _save_agent_failed(agent_id, error_message=""):
    """Sync helper: mark agent as error with reason."""
    agent = Agent.objects.get(id=agent_id)
    transition_agent_status(agent, AgentStatus.ERROR, reason="provision_failed")
    if error_message:
        agent.error_message = error_message[:2000]
    agent.save(update_fields=["status", "error_message", "updated_at"])
    return agent


def _create_stream_event_sync(agent, session_id, event_type, data):
    """Sync helper: create a StreamEvent row.

    Used inside _provision_agent (which runs as a detached asyncio.create_task)
    where the original request's CurrentThreadExecutor is already torn down.
    The async ORM's acreate() uses thread_sensitive=True by default, which
    tries to submit to that dead executor and crashes. This sync version
    wrapped with thread_sensitive=False gets its own thread instead.
    """
    return StreamEvent.objects.create(
        agent=agent, session_id=session_id, event_type=event_type, data=data,
    )


_save_provisioned = sync_to_async(_save_agent_provisioned, thread_sensitive=False)
_save_failed = sync_to_async(_save_agent_failed, thread_sensitive=False)
_create_stream_event = sync_to_async(_create_stream_event_sync, thread_sensitive=False)


def _merge_attempt_metadata(current: dict | None, update: dict | None) -> dict:
    merged = dict(current or {})
    if update:
        merged.update(update)
    return merged


def _create_lifecycle_attempt_sync(
    agent_id: str,
    kind: str,
    correlation_id: str,
    step: str = "queued",
    metadata: dict | None = None,
):
    agent = Agent.objects.get(id=agent_id)
    attempt_no = (
        AgentLifecycleAttempt.objects.filter(agent_id=agent_id).count() + 1
    )
    return AgentLifecycleAttempt.objects.create(
        agent=agent,
        kind=kind,
        status=AgentLifecycleAttemptStatus.RUNNING,
        step=step,
        attempt_no=attempt_no,
        correlation_id=correlation_id,
        metadata_json=metadata or {},
    )


def _update_lifecycle_attempt_sync(
    attempt_id: str,
    *,
    step: str | None = None,
    status: str | None = None,
    error_code: str = "",
    error_detail: str = "",
    metadata: dict | None = None,
):
    attempt = AgentLifecycleAttempt.objects.get(id=attempt_id)
    if step is not None:
        attempt.step = step
    if status is not None:
        attempt.status = status
    if error_code:
        attempt.error_code = error_code
    if error_detail:
        attempt.error_detail = error_detail[:4000]
    attempt.metadata_json = _merge_attempt_metadata(attempt.metadata_json, metadata)
    if status in (
        AgentLifecycleAttemptStatus.SUCCEEDED,
        AgentLifecycleAttemptStatus.FAILED,
        AgentLifecycleAttemptStatus.CANCELLED,
    ):
        attempt.finished_at = timezone.now()
    attempt.save(update_fields=[
        "step", "status", "error_code", "error_detail",
        "metadata_json", "finished_at", "updated_at",
    ])
    return attempt


def _complete_active_attempts_for_agent_sync(
    agent_id: str,
    *,
    status: str,
    step: str,
    error_code: str = "",
    error_detail: str = "",
    metadata: dict | None = None,
) -> int:
    attempts = list(
        AgentLifecycleAttempt.objects.filter(
            agent_id=agent_id,
            status=AgentLifecycleAttemptStatus.RUNNING,
        )
    )
    finished_at = timezone.now()
    for attempt in attempts:
        attempt.status = status
        attempt.step = step
        attempt.error_code = error_code
        if error_detail:
            attempt.error_detail = error_detail[:4000]
        attempt.metadata_json = _merge_attempt_metadata(attempt.metadata_json, metadata)
        attempt.finished_at = finished_at
        attempt.save(update_fields=[
            "status", "step", "error_code", "error_detail",
            "metadata_json", "finished_at", "updated_at",
        ])
    return len(attempts)


_create_lifecycle_attempt = sync_to_async(_create_lifecycle_attempt_sync, thread_sensitive=False)
_update_lifecycle_attempt = sync_to_async(_update_lifecycle_attempt_sync, thread_sensitive=False)
_complete_active_attempts_for_agent = sync_to_async(
    _complete_active_attempts_for_agent_sync,
    thread_sensitive=False,
)


def _build_volume_mounts(agent: Agent) -> list[VolumeMount]:
    """Build volume mount list from agent config.

    Priority: explicit volume_mounts field > workspace_path fallback.
    Always includes the agent volume (config/state) and project state volume.

    The agent volume is a per-project named Docker volume shared between
    the backend container (writes config) and agent containers (reads via
    symlinks). Each agent gets its own subdir: /vol/agents/{agent_id}/.
    The backend writes to VOLUME_ROOT/{project_vol_name}/agents/{agent_id}/
    and the agent container mounts the same volume at /vol/.
    """
    mounts: list[VolumeMount] = []

    if agent.volume_mounts:
        mounts.extend(
            VolumeMount(
                name=v["name"],
                mount_path=v["mount_path"],
                host_path=v.get("host_path", ""),
                read_only=v.get("read_only", False),
            )
            for v in agent.volume_mounts
        )
    elif agent.workspace_path:
        # Backward compat: derive from workspace_path
        mounts.append(
            VolumeMount(
                name=f"ws-{agent.id}",
                mount_path=CONTAINER_WORKSPACE,
                host_path=agent.workspace_path,
            )
        )

    # Agent volume — shared between backend (writes config at VOLUME_ROOT)
    # and agent container (reads via init-volume symlinks at /vol/).
    # Single named volume for all agents; each gets subdir /vol/agents/{id}/.
    # Name must match the actual volume name on the platform (e.g. Docker
    # Compose prefixes with project name: "agentobox_agent-volumes").
    mounts.append(VolumeMount(
        name=app_config.agent.volume_name,
        mount_path="/vol",
    ))

    # Project state volume (session persistence, shared secrets)
    project_id = str(agent.project_id)[:8]
    mounts.append(VolumeMount(
        name=f"agentobox-state-{project_id}",
        mount_path="/mnt/abox-state",
    ))

    return mounts


async def _mark_provisioned_ready(
    runtime_name: str,
    runtime,
    sandbox_id: str,
    vol,
    agent_id: str,
    provisioning_token: str,
    op_log,
) -> None:
    """Release managed provisioning only after canonical machine state is present."""
    vol.mark_provisioned(provisioning_token)

    if runtime_name != "modal":
        op_log.info("lifecycle.provisioning_ready_marked", runtime=runtime_name)
        return

    await runtime.await_machine_path_visible(
        sandbox_id,
        vol.mounted_path("_abox/provisioned.ready"),
        expected_content=provisioning_token,
    )
    op_log.info("lifecycle.provisioning_ready_marked", runtime=runtime_name)


async def _provision_agent(agent, project, runtime_name, op_log, secret_envs=None,
                           resume_session_id: str = "", attempt_id: str = ""):
    """
    Background task: create container, provision workspace, launch relay.

    The relay process (abox-relay) spawns Claude with stream-json flags,
    reads stdout events, and POSTs them to the backend. This replaces
    the previous tmux launch + hook system.

    Args:
        secret_envs: Pre-fetched decrypted secrets (fetched before launching task)
        resume_session_id: If non-empty, passed to relay as RESUME_SESSION_ID
            env var so Claude starts with --resume to preserve context.

    See: docs/ARCHITECTURE.md, "Relay Process"
    """
    from config.telemetry import bind_agent_context, clear_agent_context

    runtime = None
    sandbox_id = None
    agent_id = str(agent.id)

    # Bind agent context for all logs in this task
    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        project_id=str(project.id),
    )

    try:
        if attempt_id:
            await _update_lifecycle_attempt(
                attempt_id,
                step="provisioning_started",
                metadata={"runtime": runtime_name, "resume_session_id": resume_session_id},
            )
        runtime = get_runtime(runtime_name)
        env = _build_agent_env(agent, project)
        executor = env["AGENTOBOX_EXECUTOR"]
        machine = agent.machine

        # Generate relay auth token for this agent.
        # Passed as env var for the new runtime (reads RELAY_AUTH_TOKEN at boot).
        # Also written to .relay_env on volume for the old relay.
        relay_token = secrets.token_urlsafe(32)
        env["RELAY_AUTH_TOKEN"] = relay_token
        # New runtime reads provisioned files from AGENTOBOX_ROOT_DIR.
        # Volume is mounted at /vol and the machine helper owns the runtime-visible path.
        env["AGENTOBOX_ROOT_DIR"] = machine.mounted_root()

        api_key = ""
        is_oauth = False
        if executor == "claude_code":
            # Resolve API key early — need it in the container
            # env so the CC process can authenticate directly (no api-proxy).
            api_key = _resolve_api_key(agent.model, secret_envs)
            if not api_key:
                from agents.adapters.claude_code.registries import PROVIDER_SECRET_KEYS
                provider = agent.model.split("/", 1)[0] if "/" in agent.model else "anthropic"
                expected_key = PROVIDER_SECRET_KEYS.get(provider, f"PROVIDER_KEY_{provider.upper()}")
                raise ValueError(
                    f"No API key found for provider '{provider}'. "
                    f"Add a project secret named '{expected_key}' or set "
                    f"ANTHROPIC_API_KEY in backend settings (Anthropic only)."
                )
            is_oauth = api_key.startswith("sk-ant-oat")

            # New runtime still authenticates Claude via explicit container env
            # for non-OAuth flows. Shared secrets on the volume remain scoped;
            # this explicit env is limited to the Claude execution path.
            if not is_oauth:
                env["ANTHROPIC_API_KEY"] = api_key
                env["ANTHROPIC_BASE_URL"] = "https://api.anthropic.com"

        # Build volume mounts from agent config (explicit or workspace_path fallback)
        mounts = _build_volume_mounts(agent)

        sandbox = await runtime.create(agent.name, env, volumes=mounts or None)
        sandbox_id = sandbox.id
        if attempt_id:
            await _update_lifecycle_attempt(
                attempt_id,
                step="container_created",
                metadata={"sandbox_id": sandbox_id, "vnc_url": sandbox.vnc_url, "health_url": sandbox.health_url},
            )

        # Update agent context with sandbox_id now that it's available
        bind_agent_context(
            agent_id=agent_id,
            agent_name=agent.name,
            sandbox_id=sandbox_id,
            project_id=str(project.id),
        )

        op_log.info("lifecycle.container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url, health_url=sandbox.health_url)

        # Initialize the agent's volume control plane (_abox/ directory).
        # This MUST happen before any other volume writes. The init-volume
        # oneshot inside the container polls for /vol/agents/$AGENT_ID/_abox
        # as its readiness gate — once this directory exists, it creates
        # symlinks and all s6 services can start. Without this, the relay
        # service blocks forever waiting for its volume symlinks.
        vol = machine
        vol.initialize()
        if attempt_id:
            await _update_lifecycle_attempt(attempt_id, step="volume_initialized")

        # Write shared secrets env file to volume
        from agents.services.provision import build_secrets_env_content
        secrets_content = build_secrets_env_content(secret_envs)
        vol.write_secrets_env_document(secrets_content)

        team_name = project.name.lower().replace(" ", "-")
        parent_session_id = str(project.id)
        callback_url = env.get("ABOX_CALLBACK_URL", "")

        # Build team roster for CLAUDE.md
        from agents.services.utils import get_team_roster
        team_members = await get_team_roster(project)

        # Write all config files to the volume. The init-volume oneshot
        # creates symlinks so the container sees these at their canonical paths.
        # API key is in container env — don't write apiKeyHelper to settings.json.
        # OAuth still needs credential files on disk.
        provision_api_key = api_key if is_oauth else ""
        await provision_workspace(
            vol, project,
            agent_type=agent.agent_type,
            api_key=provision_api_key,
            mcp_servers=agent.mcp_servers or None,
            workspace_path=agent.workspace_path,
            instructions=agent.instructions,
            secret_envs=secret_envs,
            agent_role=agent.role,
            agent_name=agent.name,
            team_members=team_members,
            team_name=team_name,
            relay_token=relay_token,
            callback_url=callback_url,
            mode=agent.mode or "auto",
            model=agent.model,
            agent_tags=agent.tags or [],
        )
        # Clear stale OAuth credentials for API-key auth.
        # CC prefers .credentials.json over ANTHROPIC_API_KEY from env.
        if not is_oauth:
            vol.write("home/agent/.claude/.credentials.json", "{}")

        if attempt_id:
            await _update_lifecycle_attempt(attempt_id, step="workspace_provisioned")

        # Write canonical theme document to volume (runtime derives CSS/lua at boot)
        tokens = project.resolved_theme_tokens()
        if tokens:
            vol.write_theme_document(tokens, name=project.name)

        # Build relay environment via adapter (single source of truth for
        # env var names, model normalization, mode vocabulary, etc.)
        adapter = get_adapter(agent.agent_type)
        relay_env_api_key = api_key if is_oauth else ""
        relay_env_content = adapter.build_relay_env(
            agent_id=agent_id,
            agent_name=agent.name,
            team_name=team_name,
            parent_session_id=parent_session_id,
            callback_url=callback_url,
            relay_token=relay_token,
            api_key=relay_env_api_key,
            model=agent.model,
            mode=agent.mode or "auto",
            resume_session_id=resume_session_id,
            mcp_config_path="/home/agent/.mcp.json",
            allowed_tools=agent.allowed_tools or None,
        )
        vol.write("home/agent/.relay_env", relay_env_content)
        if attempt_id:
            await _update_lifecycle_attempt(attempt_id, step="relay_env_written")

        # Write state.json — initial state for relay boot.
        # At provision time relay isn't running, so no reload needed (use write, not mutate).
        state = json.dumps({"model": agent.model, "mode": agent.mode or "auto", "allowed_tools": agent.allowed_tools or []})
        vol.write("_abox/state.json", state)

        # Save relay_token and sandbox details BEFORE launching relay.
        # The managed runtime is released by provisioned.ready and can attempt
        # its first relay WS connect immediately afterward. Persist the fresh
        # relay token before releasing that gate so the very first connect sees
        # the correct backend-side token.
        agent = await _save_provisioned(
            agent_id, sandbox.id, sandbox.vnc_url,
            team_name, parent_session_id, relay_token,
            health_url=sandbox.health_url,
        )
        if attempt_id:
            await _update_lifecycle_attempt(
                attempt_id,
                step="relay_token_saved",
                metadata={"relay_token_set": True},
            )
        await broadcast_agent_update(agent)

        # Release the managed provisioning gate only after all files are
        # present in the canonical machine store and the backend has already
        # recorded the fresh relay token. Modal sandboxes require an explicit
        # mounted-volume sync before the running runtime can observe those
        # backend-side writes.
        await _mark_provisioned_ready(
            runtime_name,
            runtime,
            sandbox_id,
            vol,
            agent_id,
            relay_token,
            op_log,
        )
        if attempt_id:
            await _update_lifecycle_attempt(
                attempt_id,
                step="waiting_for_relay",
                metadata={"provision_store_runtime": runtime_name},
            )

        # Runtime manages its own process lifecycle — no tmux/s6 needed.

        await _capture_sandbox_logs(runtime, sandbox.id, op_log)

        op_log.info("lifecycle.agent_provisioned", agent_id=agent_id)

    except Exception as exc:  # intentional: provisioning is background task — must not crash, cleanup below
        op_log.exception(
            "lifecycle.provision_failed",
            agent_id=agent_id,
            error_code=ERR_LIFECYCLE_PROVISION_FAILED,
            error_class=type(exc).__name__,
            operation="provision_agent",
        )

        if runtime and sandbox_id:
            try:
                await runtime.terminate(sandbox_id)
                op_log.info("lifecycle.orphan_cleaned", sandbox_id=sandbox_id)
            except Exception as cleanup_exc:  # intentional: orphan container kill is best-effort during provision failure cleanup
                op_log.warning(
                    "lifecycle.orphan_cleanup_failed",
                    sandbox_id=sandbox_id,
                    error_code=ERR_LIFECYCLE_PROVISION_ORPHANED,
                    error_class=type(cleanup_exc).__name__,
                    operation="terminate_orphan",
                    agent_id=agent_id,
                    exc_info=True,
                )

        try:
            error_msg = f"{type(exc).__name__}: {exc}"
            agent = await _save_failed(agent_id, error_message=error_msg)
            await broadcast_agent_update(agent)
            await _create_stream_event(
                agent, "", "provision_failed",
                {"error": f"Container provisioning failed: {exc}"},
            )
            if attempt_id:
                await _update_lifecycle_attempt(
                    attempt_id,
                    step="failed",
                    status=AgentLifecycleAttemptStatus.FAILED,
                    error_code=ERR_LIFECYCLE_PROVISION_FAILED,
                    error_detail=f"Container provisioning failed: {exc}",
                    metadata={"sandbox_id": sandbox_id or ""},
                )
        except Exception as db_exc:  # intentional: DB cleanup after failed provision — nothing more to do
            op_log.warning(
                "lifecycle.provision_cleanup_failed",
                agent_id=agent_id,
                error_code=ERR_LIFECYCLE_PROVISION_CLEANUP_FAILED,
                error_class=type(db_exc).__name__,
                operation="save_failed_state",
                exc_info=True,
            )
    finally:
        clear_agent_context()


async def kill_agent(agent_id: str) -> bool:
    """Stop and remove an agent's container, mark as stopped."""
    from config.telemetry import bind_agent_context, clear_agent_context

    op_log = log.bind(agent_id=agent_id)
    op_log.info("lifecycle.agent_killing")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("lifecycle.agent_not_found")
        return False

    # Bind agent context for this operation
    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        sandbox_id=agent.sandbox_id,
        project_id=str(agent.project_id),
    )

    # Close the relay WS cleanly before stopping the container.
    # This triggers RelayConsumer.disconnect() immediately instead of
    # waiting for TCP teardown after container stop.
    try:
        from channels.layers import get_channel_layer
        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            f"relay_{agent_id}",
            {"type": "relay.shutdown"},
        )
    except Exception as exc:  # intentional: best-effort — container stop is the real cleanup
        op_log.debug(
            "lifecycle.relay_shutdown_failed",
            error_code=ERR_LIFECYCLE_RELAY_SHUTDOWN_FAILED,
            error_class=type(exc).__name__,
            operation="relay_shutdown",
            agent_id=agent_id,
        )

    await terminate_sandbox(agent, op_log)
    await record_runtime_segment(
        agent,
        close_reason="kill_agent",
        metadata={"status_before": agent.status},
    )

    # Validate transition before atomic bulk update.
    # transition_agent_status logs but does NOT save — the aupdate below
    # persists atomically with the F-expression compute accumulation.
    transition_agent_status(agent, AgentStatus.STOPPED, reason="kill_agent")

    # Accumulate compute time atomically (F-expression avoids races)
    # then set terminal status in a single update.
    update_kwargs = {
        "status": AgentStatus.STOPPED,
        "desired_status": DesiredStatus.STOPPED,
        "deployed_at": None,
    }
    if agent.deployed_at:
        elapsed = int((timezone.now() - agent.deployed_at).total_seconds())
        update_kwargs["compute_seconds"] = F("compute_seconds") + elapsed
    await Agent.objects.filter(id=agent_id).aupdate(**update_kwargs)

    # Refresh local instance for broadcast
    agent = await Agent.objects.aget(id=agent_id)

    await broadcast_agent_update(agent)
    await create_stream_event(agent, event_type="stopped", data={})

    op_log.info("lifecycle.agent_killed")
    clear_agent_context()
    return True


async def remove_agent(agent_id: str) -> bool:
    """Permanently delete an agent record from the fleet.

    For stopped/error agents only — removes the DB record entirely.
    Running agents should be killed first.
    """
    from config.telemetry import bind_agent_context, clear_agent_context

    op_log = log.bind(agent_id=agent_id)
    op_log.info("lifecycle.agent_removing")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("lifecycle.agent_not_found")
        return False

    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        project_id=str(agent.project_id),
    )

    # Safety: terminate sandbox if somehow still running
    await terminate_sandbox(agent, op_log)


    # Broadcast before delete -- the event FK needs the agent row to exist
    await create_stream_event(
        agent, event_type="removed", data={"agent_id": agent_id},
    )

    await agent.adelete()

    op_log.info("lifecycle.agent_removed")
    clear_agent_context()
    return True


@sync_to_async(thread_sensitive=False)
def _atomic_reset_for_restart(agent_id):
    """Lock the agent row and reset state to DEPLOYING for a hard restart.

    Uses select_for_update() to prevent two concurrent hard_restart_agent
    calls from both reading the agent, both terminating the container,
    both provisioning new ones — orphaning the first container.

    Returns (agent, old_sandbox_id, old_runtime, resume_session_id, config)
    or None if agent is already DEPLOYING (no-op).
    """
    with transaction.atomic():
        agent = Agent.objects.select_related("project").select_for_update().get(id=agent_id)

        # Guard: if already deploying, another restart won the race
        if agent.status == AgentStatus.DEPLOYING:
            return None

        # Capture values needed for teardown/reprovisioning
        old_sandbox_id = agent.sandbox_id
        old_runtime = agent.runtime
        resume_session_id = agent.session_id

        # Config priority: live agent fields > config_snapshot fallback.
        # Live fields reflect post-creation mutations (mode change, model
        # swap). config_snapshot is creation-time only — used as fallback
        # for old agent rows that may be missing newer fields.
        #
        # Runtime is the exception: it is deployment-environment policy, not
        # a user-selected per-agent knob. Hard restart should always reprovision
        # onto the currently configured runtime so legacy agents do not keep
        # dragging obsolete Docker/Modal assumptions forward forever.
        snap = ConfigSnapshot.from_dict(agent.config_snapshot) if agent.config_snapshot else None
        runtime_name = app_config.agent.runtime
        model = agent.model or (snap.model if snap else "")
        mcp_servers = agent.mcp_servers if agent.mcp_servers is not None else (snap.mcp_servers if snap else [])
        workspace_path = agent.workspace_path or (snap.workspace_path if snap else "")
        volume_mounts = agent.volume_mounts if agent.volume_mounts is not None else (snap.volume_mounts if snap else [])
        instructions = agent.instructions or (snap.instructions if snap else "")
        role = agent.role or (snap.role if snap else "")
        mode = agent.mode or "auto"

        # Accumulate compute time before resetting deployed_at
        if agent.deployed_at:
            elapsed = int((timezone.now() - agent.deployed_at).total_seconds())
            Agent.objects.filter(id=agent_id).update(
                compute_seconds=F("compute_seconds") + elapsed,
            )
            record_runtime_segment_sync(
                agent,
                close_reason="hard_restart",
                metadata={"status_before": agent.status, "old_runtime": old_runtime},
            )

        # Clean slate: reset ALL mutable state to DEPLOYING defaults.
        # Every field here was set by the previous container lifecycle.
        # latest_snapshot must be cleared so GraphQL-derived fields
        # (liveAction, lastOutput, cost) don't show stale values.
        # relay_* fields reset because the old WS connection dies with
        # the old container. deployed_at resets for compute tracking.
        transition_agent_status(agent, AgentStatus.DEPLOYING, reason="hard_restart")
        agent.desired_status = DesiredStatus.DEPLOYED
        agent.sandbox_id = ""
        agent.vnc_url = ""
        agent.session_id = ""
        agent.relay_token = ""
        agent.relay_connected = False
        agent.relay_disconnected_at = None
        agent.deployed_at = None
        agent.latest_snapshot = {}
        agent.task = ""
        agent.phase = ""
        agent.attention_level = "none"
        agent.error_message = ""
        agent.runtime = runtime_name
        agent.model = model
        agent.mcp_servers = mcp_servers
        agent.workspace_path = workspace_path
        agent.volume_mounts = volume_mounts
        agent.instructions = instructions
        agent.role = role
        agent.mode = mode
        agent.save(update_fields=[
            "status", "desired_status", "sandbox_id", "vnc_url", "session_id",
            "relay_token", "relay_connected", "relay_disconnected_at",
            "deployed_at", "latest_snapshot",
            "task", "phase", "attention_level", "error_message",
            "runtime", "model", "mcp_servers", "workspace_path",
            "volume_mounts", "instructions", "role", "mode", "updated_at",
        ])

    config = {
        "runtime": runtime_name,
        "model": model,
        "mcp_servers": mcp_servers,
        "workspace_path": workspace_path,
        "volume_mounts": volume_mounts,
        "instructions": instructions,
        "role": role,
        "mode": mode,
    }

    return agent, old_sandbox_id, old_runtime, resume_session_id, config


async def hard_restart_agent(agent_id: str) -> Agent:
    """
    Hard restart: kill container + reprovision with context preservation.

    Terminates the existing container, resets the agent's state, and provisions
    a new container with the same configuration that was used at creation time.
    Captures the current session_id so the new container can --resume it.

    Uses select_for_update() to prevent concurrent restarts from orphaning
    containers.
    """
    from config.telemetry import bind_agent_context, clear_agent_context

    op_log = log.bind(agent_id=agent_id)
    op_log.info("lifecycle.agent_restarting")

    # Atomically lock, read, and reset agent state.
    # If the agent is already DEPLOYING, another restart won the race.
    try:
        result = await _atomic_reset_for_restart(agent_id)
    except Agent.DoesNotExist:
        op_log.warning("lifecycle.agent_not_found")
        raise ValueError(f"Agent {agent_id} not found")

    if result is None:
        op_log.info("lifecycle.restart_skipped", agent_id=agent_id)
        agent = await Agent.objects.aget(id=agent_id)
        return agent

    agent, old_sandbox_id, old_runtime, resume_session_id, config = result
    runtime_name = config.get("runtime", old_runtime)

    # Bind agent context for this operation
    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        sandbox_id=old_sandbox_id,
        project_id=str(agent.project_id),
    )

    # Kill existing container if running (outside the lock — no DB contention)
    if old_sandbox_id:
        try:
            runtime = get_runtime(old_runtime)
            await runtime.terminate(old_sandbox_id)
            op_log.info("lifecycle.container_terminated", sandbox_id=old_sandbox_id)
        except Exception as exc:  # intentional: old container kill is best-effort during restart — new one will be provisioned regardless
            op_log.warning(
                "runtime.terminate_failed",
                sandbox_id=old_sandbox_id,
                error_code=ERR_LIFECYCLE_TERMINATE_FAILED,
                error_class=type(exc).__name__,
                operation="terminate_old_container",
                agent_id=agent_id,
                exc_info=True,
            )

    # Resolve project secrets for this agent (project already cached via select_related)
    secret_envs = await resolve_agent_secrets(agent, op_log)

    await broadcast_agent_update(agent)
    await create_stream_event(
        agent, event_type="restarted", data={"agent_id": agent_id},
    )

    correlation_id = secrets.token_hex(12)
    attempt = await _create_lifecycle_attempt(
        agent_id,
        AgentLifecycleKind.RESTART,
        correlation_id,
        step="queued",
        metadata={"previous_sandbox_id": old_sandbox_id, "resume_session_id": resume_session_id},
    )

    op_log.info("lifecycle.agent_restarted", agent_id=agent_id)

    # Start provisioning in background — pass resume_session_id so the
    # new container can --resume the prior conversation.
    spawn_logged_task(
        _provision_agent(
            agent,
            agent.project,
            runtime_name,
            op_log.bind(correlation_id=correlation_id, attempt_id=str(attempt.id)),
            secret_envs,
            resume_session_id=resume_session_id,
            attempt_id=str(attempt.id),
        ),
        op_log=op_log,
        task_name=f"agent-restart:{agent.id}",
        event="lifecycle.provision_task",
        agent_id=str(agent.id),
        attempt_id=str(attempt.id),
        correlation_id=correlation_id,
    )

    clear_agent_context()
    return agent


async def succeed_active_lifecycle_attempts(
    agent_id: str,
    *,
    step: str,
    metadata: dict | None = None,
) -> int:
    """Mark any running lifecycle attempts for an agent as succeeded."""
    return await _complete_active_attempts_for_agent(
        agent_id,
        status=AgentLifecycleAttemptStatus.SUCCEEDED,
        step=step,
        metadata=metadata,
    )


async def fail_active_lifecycle_attempts(
    agent_id: str,
    *,
    step: str,
    error_code: str,
    error_detail: str = "",
    metadata: dict | None = None,
) -> int:
    """Mark any running lifecycle attempts for an agent as failed."""
    return await _complete_active_attempts_for_agent(
        agent_id,
        status=AgentLifecycleAttemptStatus.FAILED,
        step=step,
        error_code=error_code,
        error_detail=error_detail,
        metadata=metadata,
    )


async def _capture_sandbox_logs(runtime, sandbox_id: str, op_log) -> None:
    """Best-effort capture of sandbox process list after provisioning."""
    try:
        output = await runtime.exec(sandbox_id, ["ps", "aux"])
        interesting = [
            line
            for line in output.splitlines()
            if any(
                token in line
                for token in ("Xvfb", "novnc", "websockify", "chromium", "awesome", "relay", "svc-relay")
            )
        ]
        truncated = "\n".join(interesting)[:200] if interesting else "(empty)"
        op_log.info("lifecycle.processes_captured", output=truncated)
    except Exception as exc:  # intentional: log capture is diagnostic only — never block provisioning
        op_log.warning(
            "lifecycle.log_capture_failed",
            error_code=ERR_LIFECYCLE_LOG_CAPTURE_FAILED,
            error_class=type(exc).__name__,
            operation="capture_sandbox_logs",
        )


def _build_agent_env(agent, project) -> dict[str, str]:
    """Build environment dict for the agent container.

    NOTE: ANTHROPIC_API_KEY is NOT included here — it's added by
    _provision_agent() for new runtime images (direct key in env) or
    delivered via apiKeyHelper + proxy for legacy images.
    """
    return {
        "AGENT_ID": str(agent.id),
        "AGENT_TYPE": agent.agent_type,
        "AGENTOBOX_EXECUTOR": _runtime_executor(
            agent.agent_type,
            app_config.agent.executor_override.strip(),
        ),
        "PROJECT_ID": str(project.id),
        "AGENT_NAME": agent.name,
        "ABOX_CALLBACK_URL": app_config.callback_url,
        "ABOX_DASHBOARD_URL": app_config.dashboard_url,
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
        # DO NOT set CLAUDECODE=1 — the CLI treats it as a nested session
        # marker and refuses to start. The SDK sets its own entrypoint env var
        # (CLAUDE_CODE_ENTRYPOINT=sdk-py) internally.
    }


async def spawn_team_lead(project_id: str) -> None:
    """Create and deploy a team-lead agent for a newly created project.

    Uses the "solo" template from the claude-code adapter's team configs.
    Called explicitly from the createProject mutation — not from a signal.
    """
    op_log = log.bind(project_id=project_id)
    op_log.info("lifecycle.spawning_team_lead")

    adapter = get_adapter("claude-code")
    template = adapter.team_configs()["solo"]
    lead_config = template["agents"][0]

    # Resolve MCP server names to full config
    mcp_config = None
    if lead_config.get("mcp_servers"):
        mcp_config = adapter.resolve_mcp_servers(lead_config["mcp_servers"])

    agent = await create_agent(
        project_id=project_id,
        name=lead_config["name"],
        runtime_name=app_config.agent.runtime,
        model=lead_config["model"],
        mcp_servers=mcp_config,
        workspace_path="",
        instructions=lead_config["instructions"],
        role=lead_config["role"],
    )

    op_log.info(
        "lifecycle.team_lead_spawned",
        agent_id=str(agent.id),
        agent_name=agent.name,
        model=agent.model,
    )


async def resolve_agent_secrets(agent, op_log) -> dict[str, str] | None:
    """Collect all secrets this agent should receive.

    Resolution order: account secrets (base) → project secrets (override).
    Project secrets with the same key override account secrets.

    A project secret goes to this agent if:
      1. It has no scoped_agents (default-all), OR
      2. This agent is in its scoped_agents set

    Returns a flat {key: value} dict, or None if no secrets.
    """
    from agents.models import AccountSecret, ProjectSecret
    from agents.services.secrets import decrypt_value

    merged: dict[str, str] = {}

    # Layer 1: account-level secrets (base)
    account_secrets = [
        s async for s in AccountSecret.objects.filter(
            user_id=agent.project.owner_id
        )
    ]
    for secret in account_secrets:
        try:
            merged[secret.key] = decrypt_value(bytes(secret.encrypted_value))
        except Exception as exc:  # intentional: one corrupt secret must not block other secrets or provisioning
            op_log.warning(
                "lifecycle.secret_decrypt_failed",
                key=secret.key,
                level="account",
                error_code=ERR_LIFECYCLE_SECRET_DECRYPT_FAILED,
                error_class=type(exc).__name__,
                operation="decrypt_secret",
                agent_id=str(agent.id),
            )

    # Layer 2: project-level secrets (override)
    project_secrets = [
        s async for s in ProjectSecret.objects.filter(
            project_id=agent.project_id
        ).prefetch_related("scoped_agents")
    ]
    for secret in project_secrets:
        scoped_ids = {a.id for a in secret.scoped_agents.all()}
        if not scoped_ids or agent.id in scoped_ids:
            try:
                merged[secret.key] = decrypt_value(bytes(secret.encrypted_value))
            except Exception as exc:  # intentional: one corrupt secret must not block other secrets or provisioning
                op_log.warning(
                    "lifecycle.secret_decrypt_failed",
                    key=secret.key,
                    level="project",
                    error_code=ERR_LIFECYCLE_SECRET_DECRYPT_FAILED,
                    error_class=type(exc).__name__,
                    operation="decrypt_secret",
                    agent_id=str(agent.id),
                )

    if not merged:
        return None

    op_log.info("lifecycle.secrets_resolved", count=len(merged), agent_name=agent.name)
    return merged
