import asyncio
import re
import secrets

import structlog
from asgiref.sync import sync_to_async
from django.conf import settings

from agents.models import Agent, AgentStatus, SecretGroup
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update
from agents.services.provision import provision_workspace, resolve_mcp_servers


def _sanitize_name(value: str) -> str:
    """Strip HTML tags and trim whitespace from a name."""
    return re.sub(r"<[^>]*>", "", value).strip()

log = structlog.get_logger("agents.lifecycle")


async def create_agent(
    project_id: str,
    name: str,
    runtime_name: str = "modal",
    model: str = "claude-sonnet-4-5-20250929",
    mcp_servers: dict | None = None,
    workspace_path: str = "",
    instructions: str = "",
    secret_group_ids: list[str] | None = None,
    role: str = "worker",
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
        "secret_group_ids": secret_group_ids or [],
        "role": role,
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
        instructions=instructions,
        role=role,
        config_snapshot=config_snapshot,
    )

    # Attach secret groups to agent (M2M) and fetch them for provisioning
    secret_envs = None
    if secret_group_ids:
        secret_groups = SecretGroup.objects.filter(
            id__in=secret_group_ids, project=project,
        )
        await agent.secret_groups.aset([sg async for sg in secret_groups])
        # Fetch and decrypt secrets before launching background task
        secret_envs = await _resolve_agent_secrets_sync(secret_group_ids, project, op_log)

    await broadcast_agent_update(agent)
    await broadcast_agent_event(
        agent, "created", {"name": name, "runtime": runtime_name},
        summary=f"{name} created",
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
    agent.save(update_fields=["sandbox_id", "vnc_url", "status", "team_name", "parent_session_id", "relay_token"])
    return agent


def _save_agent_failed(agent_id):
    """Sync helper: mark agent as error."""
    agent = Agent.objects.get(id=agent_id)
    agent.status = AgentStatus.ERROR
    agent.save(update_fields=["status"])
    return agent


_save_provisioned = sync_to_async(_save_agent_provisioned, thread_sensitive=False)
_save_failed = sync_to_async(_save_agent_failed, thread_sensitive=False)


async def _provision_agent(agent, project, runtime_name, op_log, secret_envs=None):
    """
    Background task: create container, provision workspace, launch relay.

    The relay process (abox-relay) spawns Claude with stream-json flags,
    reads stdout events, and POSTs them to the backend. This replaces
    the previous tmux launch + hook system.

    Args:
        secret_envs: Pre-fetched decrypted secrets (fetched before launching task)

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Relay Process"
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

        # Build volume mounts when workspace_path is set
        CONTAINER_WORKSPACE = "/home/computeruse/workspace"
        volumes = None
        if agent.workspace_path:
            volumes = {agent.workspace_path: CONTAINER_WORKSPACE}

        sandbox = await runtime.create(agent.name, env, volumes=volumes)
        sandbox_id = sandbox.id

        # Update agent context with sandbox_id now that it's available
        bind_agent_context(
            agent_id=agent_id,
            agent_name=agent.name,
            sandbox_id=sandbox_id,
            project_id=str(project.id),
        )

        op_log.info("container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url)

        api_key = getattr(settings, "ANTHROPIC_API_KEY", "")

        await provision_workspace(
            runtime, sandbox.id, project,
            api_key=api_key,
            mcp_servers=agent.mcp_servers or None,
            workspace_path=agent.workspace_path,
            instructions=agent.instructions,
            secret_envs=secret_envs,
        )

        team_name = project.name.lower().replace(" ", "-")
        parent_session_id = str(project.id)
        work_dir = CONTAINER_WORKSPACE if agent.workspace_path else "/home/computeruse"
        callback_url = env.get("ABOX_CALLBACK_URL", "")

        # Build relay environment variables
        # The relay reads these to spawn Claude with correct flags and POST events
        relay_env_lines = [
            f'export AGENT_ID="{agent_id}"',
            f'export AGENT_NAME="{agent.name}"',
            f'export TEAM_NAME="{team_name}"',
            f'export PARENT_SESSION_ID="{parent_session_id}"',
            f'export ABOX_CALLBACK_URL="{callback_url}"',
            f'export RELAY_AUTH_TOKEN="{relay_token}"',
            f'export ANTHROPIC_API_KEY="{api_key}"',
            f'export CLAUDE_MODEL="{agent.model}"',
        ]

        # Add MCP config path if agent has MCP servers
        if agent.mcp_servers:
            relay_env_lines.append(f'export MCP_CONFIG="{work_dir}/.mcp.json"')

        relay_env_content = "\n".join(relay_env_lines) + "\n"
        await runtime.write_file(
            sandbox.id,
            relay_env_content.encode("utf-8"),
            "/home/computeruse/.relay_env",
        )

        # Launch relay process via tmux (so it's visible in VNC)
        relay_cmd = (
            f"cd {work_dir} && source /home/computeruse/.relay_env"
            f" && python3 /opt/abox/relay.py"
        )
        await runtime.exec(
            sandbox.id,
            ["tmux", "new-session", "-d", "-s", "claude", "-x", "200", "-y", "50",
             "bash", "-c", relay_cmd],
        )
        op_log.info("relay_launched", team_name=team_name, parent_session_id=parent_session_id)

        await _capture_sandbox_logs(runtime, sandbox.id, op_log)

        # Save relay_token on agent for stream endpoint auth
        agent = await _save_provisioned(
            agent_id, sandbox.id, sandbox.vnc_url,
            team_name, parent_session_id, relay_token,
        )
        await broadcast_agent_update(agent)

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
            await broadcast_agent_event(
                agent, "provision_failed", {"error": "Container provisioning failed"},
                summary=f"{agent.name} failed to provision",
            )
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
    await broadcast_agent_event(agent, "stopped", {}, summary=f"{agent.name} stopped")

    op_log.info("agent_killed")
    clear_agent_context()
    return True


async def restart_agent(agent_id: str) -> Agent:
    """
    Restart an agent using its saved config_snapshot.

    Terminates the existing container, resets the agent's state, and provisions
    a new container with the same configuration that was used at creation time.
    """
    from config.telemetry import bind_agent_context, clear_agent_context

    op_log = log.bind(agent_id=agent_id)
    op_log.info("restarting_agent")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        raise ValueError(f"Agent {agent_id} not found")

    # Bind agent context for this operation
    bind_agent_context(
        agent_id=agent_id,
        agent_name=agent.name,
        sandbox_id=agent.sandbox_id,
        project_id=str(agent.project_id),
    )

    # Kill existing container if running
    if agent.sandbox_id:
        try:
            runtime = get_runtime(agent.runtime)
            await runtime.terminate(agent.sandbox_id)
            op_log.info("container_terminated", sandbox_id=agent.sandbox_id)
        except Exception:
            op_log.exception("terminate_sandbox_failed", sandbox_id=agent.sandbox_id)

    # Extract config from snapshot
    config = agent.config_snapshot or {}
    runtime_name = config.get("runtime", agent.runtime)
    model = config.get("model", agent.model)
    mcp_servers = config.get("mcp_servers", agent.mcp_servers)
    workspace_path = config.get("workspace_path", agent.workspace_path)
    instructions = config.get("instructions", agent.instructions)
    secret_group_ids = config.get("secret_group_ids", [])
    role = config.get("role", agent.role)

    # Reset agent state to DEPLOYING
    agent.status = AgentStatus.DEPLOYING
    agent.sandbox_id = ""
    agent.vnc_url = ""
    agent.session_id = ""
    agent.relay_token = ""
    agent.last_heartbeat_at = None
    agent.runtime = runtime_name
    agent.model = model
    agent.mcp_servers = mcp_servers
    agent.workspace_path = workspace_path
    agent.instructions = instructions
    agent.role = role
    await agent.asave()

    # Re-attach secret groups from config snapshot and fetch secrets
    from projects.models import Project
    project = await Project.objects.aget(id=agent.project_id)
    secret_envs = None
    if secret_group_ids:
        secret_groups = SecretGroup.objects.filter(
            id__in=secret_group_ids, project=project,
        )
        await agent.secret_groups.aset([sg async for sg in secret_groups])
        # Fetch and decrypt secrets before launching background task
        secret_envs = await _resolve_agent_secrets_sync(secret_group_ids, project, op_log)

    await broadcast_agent_update(agent)
    await broadcast_agent_event(
        agent, "restarted", {"agent_id": agent_id},
        summary=f"{agent.name} restarted",
    )

    op_log.info("agent_reset_complete", agent_id=agent_id)

    # Start provisioning in background
    asyncio.create_task(
        _provision_agent(agent, project, runtime_name, op_log, secret_envs)
    )

    clear_agent_context()
    return agent


async def _capture_sandbox_logs(runtime, sandbox_id: str, op_log) -> None:
    """Best-effort capture of sandbox process list after provisioning."""
    try:
        output = await runtime.exec(
            sandbox_id,
            ["bash", "-c", "ps aux | grep -E 'Xvfb|novnc|websockify|firefox|awesome' | grep -v grep"],
        )
        truncated = output[:2000] if output else "(empty)"
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
        "CLAUDECODE": "1",
    }


async def _resolve_agent_secrets_sync(secret_group_ids: list[str], project, op_log) -> dict[str, dict[str, str]] | None:
    """
    Decrypt secret groups by IDs (called before launching background task).

    This function is safe to call in the normal async context (not inside create_task).
    Returns dict suitable for passing to provision_workspace.
    """
    from agents.services.secrets import decrypt_secrets

    if not secret_group_ids:
        return None

    # Query secret groups directly (safe in normal async context)
    secret_groups = await SecretGroup.objects.filter(
        id__in=secret_group_ids, project=project
    ).aall()

    if not secret_groups:
        return None

    # Flat merge: all secret groups' key-value pairs combined
    merged: dict[str, str] = {}
    for sg in secret_groups:
        try:
            data = decrypt_secrets(bytes(sg.encrypted_data))
            merged.update(data)
        except Exception:
            op_log.warning(
                "secret_group_decrypt_failed",
                secret_group=sg.name,
            )

    if not merged:
        return None

    op_log.info("secrets_resolved", count=len(merged), groups=len(secret_groups))
    return {"_global": merged}


async def _resolve_agent_secrets(agent, op_log) -> dict[str, dict[str, str]] | None:
    """Decrypt all secret groups attached to this agent.

    Returns a flat dict of {key: value} from all attached secret groups,
    or None if no secrets are attached. These are passed to provision_workspace
    as secret_envs for injection into MCP server env blocks.

    Currently returns a flat merge of all secret groups. When MCP templates
    (Phase 2) add required_secret_keys, this will become per-MCP-server mapping.
    """
    from agents.services.secrets import decrypt_secrets

    # Query SecretGroup directly to avoid ManyToMany async issues
    secret_groups = [
        sg async for sg in SecretGroup.objects.filter(agents__id=agent.id)
    ]
    if not secret_groups:
        return None

    # Flat merge: all secret groups' key-value pairs combined
    # Phase 2 will map specific keys to specific MCP servers
    merged: dict[str, str] = {}
    for sg in secret_groups:
        try:
            data = decrypt_secrets(bytes(sg.encrypted_data))
            merged.update(data)
        except Exception:
            op_log.warning(
                "secret_group_decrypt_failed",
                secret_group=sg.name,
                agent_id=str(agent.id),
            )

    if not merged:
        return None

    op_log.info("secrets_resolved", count=len(merged), groups=len(secret_groups))
    return {"_global": merged}
