import asyncio
import secrets

import structlog
from asgiref.sync import sync_to_async
from django.conf import settings

from agents.models import Agent, AgentStatus
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update
from agents.services.provision import provision_workspace, resolve_mcp_servers

log = structlog.get_logger("agents.lifecycle")


async def create_agent(
    project_id: str,
    name: str,
    runtime_name: str = "modal",
    mcp_servers: dict | None = None,
    workspace_path: str = "",
    instructions: str = "",
) -> Agent:
    """Create agent record immediately, provision container in background."""
    from projects.models import Project

    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("creating_agent", runtime=runtime_name, workspace_path=workspace_path)

    project = await Project.objects.aget(id=project_id)

    # Resolve MCP names to full config
    resolved_mcps = mcp_servers or {}

    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        runtime=runtime_name,
        sandbox_id="",
        vnc_url="",
        status=AgentStatus.DEPLOYING,
        mcp_servers=resolved_mcps,
        workspace_path=workspace_path,
        instructions=instructions,
    )

    await broadcast_agent_update(agent)
    await broadcast_agent_event(agent, "created", {"name": name, "runtime": runtime_name})

    op_log.info("agent_created", agent_id=str(agent.id))

    asyncio.create_task(
        _provision_agent(agent, project, runtime_name, op_log)
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


async def _provision_agent(agent, project, runtime_name, op_log):
    """
    Background task: create container, provision workspace, launch relay.

    The relay process (abox-relay) spawns Claude with stream-json flags,
    reads stdout events, and POSTs them to the backend. This replaces
    the previous tmux launch + hook system.

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Relay Process"
    """
    runtime = None
    sandbox_id = None
    agent_id = str(agent.id)

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
        op_log.info("container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url)

        api_key = env.get("ANTHROPIC_API_KEY", "")
        await provision_workspace(
            runtime, sandbox.id, project,
            api_key=api_key,
            mcp_servers=agent.mcp_servers or None,
            workspace_path=agent.workspace_path,
            instructions=agent.instructions,
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
            f'export CLAUDE_MODEL="claude-opus-4-6"',
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
                agent, "provision_failed", {"error": "Container provisioning failed"}
            )
        except Exception:
            op_log.exception("provision_cleanup_db_failed", agent_id=agent_id)


async def kill_agent(agent_id: str) -> bool:
    """Stop and remove an agent's container, mark as stopped."""
    op_log = log.bind(agent_id=agent_id)
    op_log.info("killing_agent")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    if agent.sandbox_id:
        try:
            runtime = get_runtime(agent.runtime)
            await runtime.terminate(agent.sandbox_id)
        except Exception:
            op_log.exception("terminate_sandbox_failed", sandbox_id=agent.sandbox_id)

    agent.status = AgentStatus.STOPPED
    await agent.asave(update_fields=["status"])

    await broadcast_agent_update(agent)
    await broadcast_agent_event(agent, "stopped", {})

    op_log.info("agent_killed")
    return True


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
    """Build environment dict for the agent container."""
    return {
        "ANTHROPIC_API_KEY": getattr(settings, "ANTHROPIC_API_KEY", ""),
        "CLAUDE_CODE_API_KEY": getattr(settings, "ANTHROPIC_API_KEY", ""),
        "AGENT_ID": str(agent.id),
        "PROJECT_ID": str(project.id),
        "AGENT_NAME": agent.name,
        "ABOX_CALLBACK_URL": getattr(settings, "ABOX_CALLBACK_URL", ""),
        "ABOX_DASHBOARD_URL": getattr(settings, "ABOX_DASHBOARD_URL", ""),
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
        "CLAUDECODE": "1",
    }
