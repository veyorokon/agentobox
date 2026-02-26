import asyncio
import secrets

import structlog
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import transaction

from agents.models import Agent, AgentStatus
from agents.runtimes import get_runtime
from agents.runtimes.base import VolumeMount
from agents.models import StreamEvent
from agents.services.broadcast import broadcast_agent_update, broadcast_event
from agents.services.feed import create_feed_item
from agents.services.provision import provision_workspace, resolve_mcp_servers, write_secrets_env, write_theme_files
from agents.utils import sanitize_name as _sanitize_name

CONTAINER_WORKSPACE = "/home/agent/workspace"

log = structlog.get_logger("agents.lifecycle")


def _shell_escape(val: str) -> str:
    """Escape a value for safe use inside single quotes in shell."""
    return val.replace("'", "'\\''")


async def create_agent(
    project_id: str,
    name: str,
    runtime_name: str = "modal",
    model: str = "claude-sonnet-4-5-20250929",
    mcp_servers: dict | None = None,
    workspace_path: str = "",
    instructions: str = "",
    role: str = "worker",
    volume_mounts: list[dict] | None = None,
    mode: str = "auto",
    tags: list[str] | None = None,
) -> Agent:
    """Create agent record immediately, provision container in background."""
    from config.telemetry import bind_agent_context
    from projects.models import Project

    name = _sanitize_name(name)
    if not name:
        raise ValueError("Agent name cannot be empty")

    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("creating_agent", runtime=runtime_name, workspace_path=workspace_path)

    project = await Project.objects.aget(id=project_id)

    # Check for duplicate name within the same project
    if await Agent.objects.filter(project=project, name=name).aexists():
        raise ValueError(
            f"An agent named '{name}' already exists in this project"
        )

    # Resolve MCP names to full config
    resolved_mcps = mcp_servers or {}

    # Build config snapshot for future restarts
    config_snapshot = {
        "runtime": runtime_name,
        "model": model,
        "mcp_servers": resolved_mcps,
        "workspace_path": workspace_path,
        "instructions": instructions,
        "role": role,
        "volume_mounts": volume_mounts or [],
    }

    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        runtime=runtime_name,
        model=model,
        sandbox_id="",
        vnc_url="",
        status=AgentStatus.DEPLOYING,
        mcp_servers=resolved_mcps,
        workspace_path=workspace_path,
        volume_mounts=volume_mounts or [],
        instructions=instructions,
        role=role,
        config_snapshot=config_snapshot,
        mode=mode,
        tags=tags or [],
    )

    # Resolve project secrets for this agent (default-all with optional scoping)
    secret_envs = await resolve_agent_secrets(agent, op_log)

    await broadcast_agent_update(agent)
    evt = await StreamEvent.objects.acreate(
        agent=agent, session_id="", event_type="created",
        data={"name": name, "runtime": runtime_name},
    )
    await broadcast_event(agent, evt)

    # Create system feed item for agent creation
    await create_feed_item(
        project_id=str(project_id),
        source_event=evt,
        agent_record=agent,
        type="system",
        agent_name=name,
        text=f"Agent {name} created ({runtime_name})",
    )

    op_log.info("agent_created", agent_id=str(agent.id))

    asyncio.create_task(
        _provision_agent(agent, project, runtime_name, op_log, secret_envs)
    )

    return agent


def _save_agent_provisioned(agent_id, sandbox_id, vnc_url, team_name="", parent_session_id="", relay_token=""):
    """Sync helper: mark agent as provisioned with sandbox details."""
    agent = Agent.objects.get(id=agent_id)
    agent.sandbox_id = sandbox_id
    agent.vnc_url = vnc_url
    agent.status = AgentStatus.IDLE
    agent.team_name = team_name
    agent.parent_session_id = parent_session_id
    agent.relay_token = relay_token
    agent.save(update_fields=[
        "sandbox_id", "vnc_url", "status", "team_name",
        "parent_session_id", "relay_token", "updated_at",
    ])
    return agent


def _save_agent_failed(agent_id):
    """Sync helper: mark agent as error."""
    agent = Agent.objects.get(id=agent_id)
    agent.status = AgentStatus.ERROR
    agent.save(update_fields=["status", "updated_at"])
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


def _build_volume_mounts(agent: Agent) -> list[VolumeMount]:
    """Build volume mount list from agent config.

    Priority: explicit volume_mounts field > workspace_path fallback.
    Always includes the project state volume for session persistence.
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

    # Project state volume (session persistence, shared secrets)
    project_id = str(agent.project_id)[:8]
    mounts.append(VolumeMount(
        name=f"agentobox-state-{project_id}",
        mount_path="/mnt/abox-state",
    ))

    return mounts


async def _provision_agent(agent, project, runtime_name, op_log, secret_envs=None,
                           resume_session_id: str = ""):
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
        runtime = get_runtime(runtime_name)
        env = _build_agent_env(agent, project)

        # Generate relay auth token for this agent
        relay_token = secrets.token_urlsafe(32)

        # Build volume mounts from agent config (explicit or workspace_path fallback)
        mounts = _build_volume_mounts(agent)

        # Dev: bind-mount relay.py so changes don't require image rebuild
        rootfs_path = getattr(settings, "AGENT_ROOTFS_PATH", "")
        if rootfs_path:
            mounts.append(VolumeMount(
                name="dev-relay",
                mount_path="/opt/abox/relay.py",
                host_path=f"{rootfs_path}/opt/abox/relay.py",
            ))

        sandbox = await runtime.create(agent.name, env, volumes=mounts or None)
        sandbox_id = sandbox.id

        # Update agent context with sandbox_id now that it's available
        bind_agent_context(
            agent_id=agent_id,
            agent_name=agent.name,
            sandbox_id=sandbox_id,
            project_id=str(project.id),
        )

        op_log.info("container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url)

        # Set up session persistence: symlink ~/.claude to volume-backed dir
        # Run as root because fresh Docker volumes are root-owned
        agent_state_dir = f"/mnt/abox-state/agents/{agent_id}/.claude"
        await runtime.exec(sandbox_id, [
            "bash", "-c",
            f"mkdir -p {agent_state_dir} /mnt/abox-state/secrets"
            f" && chown -R agent:agent /mnt/abox-state/agents/{agent_id}"
            f" && chown agent:agent /mnt/abox-state/secrets"
            f" && rm -rf /home/agent/.claude"
            f" && ln -sf {agent_state_dir} /home/agent/.claude",
        ], user="root")

        # Write shared secrets env file and source it from .bashrc
        await write_secrets_env(runtime, sandbox_id, secret_envs)
        await runtime.exec(sandbox_id, [
            "bash", "-c",
            "grep -q 'abox-state/secrets/env' /home/agent/.bashrc 2>/dev/null"
            " || echo 'source /mnt/abox-state/secrets/env 2>/dev/null' >> /home/agent/.bashrc",
        ])

        api_key = getattr(settings, "ANTHROPIC_API_KEY", "")

        team_name = project.name.lower().replace(" ", "-")
        parent_session_id = str(project.id)
        work_dir = CONTAINER_WORKSPACE if agent.workspace_path else "/home/agent"
        callback_url = env.get("ABOX_CALLBACK_URL", "")

        # Fetch all team agents for CLAUDE.md roster and team config
        # thread_sensitive=False because this runs inside asyncio.create_task
        # where the request's CurrentThreadExecutor is gone
        all_agents = await sync_to_async(
            lambda: list(
                Agent.objects.filter(project=project)
                .exclude(status=AgentStatus.STOPPED)
            ),
            thread_sensitive=False,
        )()

        # Build team roster for CLAUDE.md
        team_members = [
            {
                "name": a.name,
                "role": a.role,
                "instructions": a.instructions or "",
            }
            for a in all_agents
        ]

        await provision_workspace(
            runtime, sandbox.id, project,
            api_key=api_key,
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
            mode=getattr(agent, "mode", "auto"),
        )
        # Write theme tokens if project has them
        if project.theme_tokens:
            await write_theme_files(runtime, sandbox.id, project.theme_tokens)

        # Build relay environment variables
        # The relay reads these into ClaudeAgentOptions (SDK) and WS config
        relay_env_lines = [
            f"export AGENT_ID='{_shell_escape(agent_id)}'",
            f"export AGENT_NAME='{_shell_escape(agent.name)}'",
            f"export TEAM_NAME='{_shell_escape(team_name)}'",
            f"export PARENT_SESSION_ID='{_shell_escape(parent_session_id)}'",
            f"export ABOX_CALLBACK_URL='{_shell_escape(callback_url)}'",
            f"export RELAY_AUTH_TOKEN='{_shell_escape(relay_token)}'",
            f"export ANTHROPIC_API_KEY='{_shell_escape(api_key)}'",
            f"export CLAUDE_MODEL='{_shell_escape(agent.model)}'",
        ]

        # Pass resume session so relay can --resume the prior conversation
        if resume_session_id:
            relay_env_lines.append(f"export RESUME_SESSION_ID='{_shell_escape(resume_session_id)}'")

        # Always set MCP config path (abox-coord is always present)
        # provision.py writes .mcp.json to /home/agent/ (not work_dir)
        relay_env_lines.append("export MCP_CONFIG='/home/agent/.mcp.json'")

        relay_env_content = "\n".join(relay_env_lines) + "\n"
        await runtime.write_file(
            sandbox.id,
            relay_env_content.encode("utf-8"),
            "/home/agent/.relay_env",
        )

        # Save relay_token and sandbox details BEFORE launching relay.
        # The relay POSTs to /agents/<id>/stream/ immediately on startup,
        # authenticated via X-Relay-Token. If the token isn't in DB yet,
        # early relay POSTs get 401.
        agent = await _save_provisioned(
            agent_id, sandbox.id, sandbox.vnc_url,
            team_name, parent_session_id, relay_token,
        )
        await broadcast_agent_update(agent)

        # Bring up the s6-supervised relay service.
        # The service runs under s6-supervise from boot, but idles in
        # `sleep infinity` until .relay_env exists. Now that we've written
        # the env file, SIGTERM the sleeping placeholder so s6-supervise
        # restarts the run script — which will find .relay_env and exec
        # relay.py. On crash, s6-supervise auto-restarts; on clean exit
        # (code 0), the finish script touches a down file to stop restarts.
        await runtime.exec(
            sandbox.id, ["/command/s6-svc", "-t", "/run/service/svc-relay"],
            user="root",
        )

        # Spawn a tmux session tailing relay logs for VNC debug visibility.
        # S6_LOGGING=1 routes service stdout/stderr through s6-log to the
        # catch-all directory. Tail with -F to handle log rotation.
        await runtime.exec(
            sandbox.id,
            ["tmux", "new-session", "-d", "-s", "claude", "-x", "200", "-y", "50",
             "bash", "-c",
             "exec tail -F /run/uncaught-logs/current 2>/dev/null || exec sleep infinity"],
            user="agent",
        )
        op_log.info("relay_launched", team_name=team_name, parent_session_id=parent_session_id)

        await _capture_sandbox_logs(runtime, sandbox.id, op_log)

        op_log.info("agent_provisioned", agent_id=agent_id)

    except Exception:
        op_log.exception("agent_provision_failed", agent_id=agent_id)

        if runtime and sandbox_id:
            try:
                await runtime.terminate(sandbox_id)
                op_log.info("orphan_sandbox_terminated", sandbox_id=sandbox_id)
            except Exception:
                op_log.exception("orphan_cleanup_failed", sandbox_id=sandbox_id)

        try:
            agent = await _save_failed(agent_id)
            await broadcast_agent_update(agent)
            evt = await _create_stream_event(
                agent, "", "provision_failed",
                {"error": "Container provisioning failed"},
            )
            await broadcast_event(agent, evt)
        except Exception:
            op_log.exception("provision_cleanup_db_failed", agent_id=agent_id)
    finally:
        clear_agent_context()


async def kill_agent(agent_id: str) -> bool:
    """Stop and remove an agent's container, mark as stopped."""
    from config.telemetry import bind_agent_context, clear_agent_context

    op_log = log.bind(agent_id=agent_id)
    op_log.info("killing_agent")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    # Bind agent context for this operation
    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        sandbox_id=agent.sandbox_id,
        project_id=str(agent.project_id),
    )

    if agent.sandbox_id:
        try:
            runtime = get_runtime(agent.runtime)
            await runtime.terminate(agent.sandbox_id)
        except Exception:
            op_log.exception("terminate_sandbox_failed", sandbox_id=agent.sandbox_id)

    agent.status = AgentStatus.STOPPED
    await agent.asave(update_fields=["status"])

    await broadcast_agent_update(agent)
    evt = await StreamEvent.objects.acreate(
        agent=agent, session_id=agent.session_id or "", event_type="stopped", data={},
    )
    await broadcast_event(agent, evt)

    op_log.info("agent_killed")
    clear_agent_context()
    return True


async def remove_agent(agent_id: str) -> bool:
    """Permanently delete an agent record from the fleet.

    For stopped/error agents only — removes the DB record entirely.
    Running agents should be killed first.
    """
    from config.telemetry import bind_agent_context, clear_agent_context

    op_log = log.bind(agent_id=agent_id)
    op_log.info("removing_agent")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        project_id=str(agent.project_id),
    )

    # Safety: terminate sandbox if somehow still running
    if agent.sandbox_id:
        try:
            runtime = get_runtime(agent.runtime)
            await runtime.terminate(agent.sandbox_id)
        except Exception:
            op_log.exception("terminate_sandbox_failed", sandbox_id=agent.sandbox_id)

    project_id = agent.project_id
    agent_name = agent.name

    # Broadcast before delete — the event FK needs the agent row to exist
    evt = await StreamEvent.objects.acreate(
        agent=agent, session_id=agent.session_id or "", event_type="removed",
        data={"agent_id": agent_id},
    )
    await broadcast_event(agent, evt)

    await agent.adelete()

    op_log.info("agent_removed")
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
        agent = Agent.objects.select_for_update().get(id=agent_id)

        # Guard: if already deploying, another restart won the race
        if agent.status == AgentStatus.DEPLOYING:
            return None

        # Capture values needed for teardown/reprovisioning
        old_sandbox_id = agent.sandbox_id
        old_runtime = agent.runtime
        resume_session_id = agent.session_id

        # Extract config from snapshot
        config = agent.config_snapshot or {}
        runtime_name = config.get("runtime", agent.runtime)
        model = config.get("model", agent.model)
        mcp_servers = config.get("mcp_servers", agent.mcp_servers)
        workspace_path = config.get("workspace_path", agent.workspace_path)
        volume_mounts = config.get("volume_mounts", agent.volume_mounts)
        instructions = config.get("instructions", agent.instructions)
        role = config.get("role", agent.role)

        # Reset agent state to DEPLOYING — clear stale session data.
        agent.status = AgentStatus.DEPLOYING
        agent.sandbox_id = ""
        agent.vnc_url = ""
        agent.session_id = ""
        agent.relay_token = ""
        agent.runtime = runtime_name
        agent.model = model
        agent.mcp_servers = mcp_servers
        agent.workspace_path = workspace_path
        agent.volume_mounts = volume_mounts
        agent.instructions = instructions
        agent.role = role
        agent.save(update_fields=[
            "status", "sandbox_id", "vnc_url", "session_id", "relay_token",
            "runtime", "model", "mcp_servers", "workspace_path",
            "volume_mounts", "instructions", "role", "updated_at",
        ])

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
    op_log.info("restarting_agent")

    # Atomically lock, read, and reset agent state.
    # If the agent is already DEPLOYING, another restart won the race.
    try:
        result = await _atomic_reset_for_restart(agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        raise ValueError(f"Agent {agent_id} not found")

    if result is None:
        op_log.info("restart_skipped_already_deploying", agent_id=agent_id)
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
            op_log.info("container_terminated", sandbox_id=old_sandbox_id)
        except Exception:
            op_log.exception("terminate_sandbox_failed", sandbox_id=old_sandbox_id)

    # Resolve project secrets for this agent
    from projects.models import Project
    project = await Project.objects.aget(id=agent.project_id)
    secret_envs = await resolve_agent_secrets(agent, op_log)

    await broadcast_agent_update(agent)
    evt = await StreamEvent.objects.acreate(
        agent=agent, session_id=agent.session_id or "", event_type="restarted",
        data={"agent_id": agent_id},
    )
    await broadcast_event(agent, evt)

    op_log.info("agent_reset_complete", agent_id=agent_id)

    # Start provisioning in background — pass resume_session_id so the
    # new container can --resume the prior conversation.
    asyncio.create_task(
        _provision_agent(agent, project, runtime_name, op_log, secret_envs,
                         resume_session_id=resume_session_id)
    )

    clear_agent_context()
    return agent


async def _capture_sandbox_logs(runtime, sandbox_id: str, op_log) -> None:
    """Best-effort capture of sandbox process list after provisioning."""
    try:
        output = await runtime.exec(
            sandbox_id,
            ["bash", "-c", "ps aux | grep -E 'Xvfb|novnc|websockify|firefox|awesome|relay|s6-supervise.*svc-relay' | grep -v grep"],
        )
        truncated = output[:200] if output else "(empty)"
        op_log.info("sandbox_processes", output=truncated)
    except Exception:
        op_log.warning("sandbox_log_capture_failed")


def _build_agent_env(agent, project) -> dict[str, str]:
    """Build environment dict for the agent container.

    NOTE: ANTHROPIC_API_KEY is intentionally NOT included here.
    The key is delivered via apiKeyHelper + tmpfs (see provision.py).
    It remains in .relay_env so the relay can write it to tmpfs at boot,
    but is NOT in the container's shell environment.
    """
    return {
        "AGENT_ID": str(agent.id),
        "PROJECT_ID": str(project.id),
        "AGENT_NAME": agent.name,
        "ABOX_CALLBACK_URL": getattr(settings, "ABOX_CALLBACK_URL", ""),
        "ABOX_DASHBOARD_URL": getattr(settings, "ABOX_DASHBOARD_URL", ""),
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
        # DO NOT set CLAUDECODE=1 — the CLI treats it as a nested session
        # marker and refuses to start. The SDK sets its own entrypoint env var
        # (CLAUDE_CODE_ENTRYPOINT=sdk-py) internally.
        # BASH_ENV is sourced by bash for every non-interactive invocation.
        # Claude Code's Bash tool uses non-interactive shells, so .bashrc
        # is NOT read. BASH_ENV ensures secrets are available to all commands.
        "BASH_ENV": "/mnt/abox-state/secrets/env",
    }


async def resolve_agent_secrets(agent, op_log) -> dict[str, str] | None:
    """Collect all project secrets this agent should receive.

    A secret goes to this agent if:
      1. It has no scoped_agents (default-all), OR
      2. This agent is in its scoped_agents set

    Returns a flat {key: value} dict, or None if no secrets.
    """
    from agents.models import ProjectSecret
    from agents.services.secrets import decrypt_value

    all_secrets = [
        s async for s in ProjectSecret.objects.filter(
            project_id=agent.project_id
        ).prefetch_related("scoped_agents")
    ]

    if not all_secrets:
        return None

    merged: dict[str, str] = {}
    for secret in all_secrets:
        scoped_ids = {a.id for a in secret.scoped_agents.all()}
        if not scoped_ids or agent.id in scoped_ids:
            try:
                merged[secret.key] = decrypt_value(bytes(secret.encrypted_value))
            except Exception:
                op_log.warning("secret_decrypt_failed", key=secret.key)

    if not merged:
        return None

    op_log.info("secrets_resolved", count=len(merged), agent_name=agent.name)
    return merged
