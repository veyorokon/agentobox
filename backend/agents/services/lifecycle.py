import asyncio

import structlog
from asgiref.sync import sync_to_async
from django.conf import settings

from agents.models import Agent, AgentStatus
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update
from agents.services.provision import provision_workspace

log = structlog.get_logger("agents.lifecycle")


async def create_agent(
    project_id: str,
    name: str,
    runtime_name: str = "modal",
) -> Agent:
    """Create agent record immediately, provision container in background."""
    from projects.models import Project

    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("creating_agent", runtime=runtime_name)

    project = await Project.objects.aget(id=project_id)

    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        runtime=runtime_name,
        sandbox_id="",
        vnc_url="",
        status=AgentStatus.DEPLOYING,
    )

    await broadcast_agent_update(agent)
    await broadcast_agent_event(agent, "created", {"name": name, "runtime": runtime_name})

    op_log.info("agent_created", agent_id=str(agent.id))

    asyncio.create_task(
        _provision_agent(agent, project, runtime_name, op_log)
    )

    return agent


def _save_agent_provisioned(agent_id, sandbox_id, vnc_url, team_name="", parent_session_id=""):
    """Sync helper: mark agent as running with sandbox details."""
    agent = Agent.objects.get(id=agent_id)
    agent.sandbox_id = sandbox_id
    agent.vnc_url = vnc_url
    agent.status = AgentStatus.RUNNING
    agent.team_name = team_name
    agent.parent_session_id = parent_session_id
    agent.save(update_fields=["sandbox_id", "vnc_url", "status", "team_name", "parent_session_id"])
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
    """Background task: create container, provision workspace, launch Claude."""
    runtime = None
    sandbox_id = None
    agent_id = str(agent.id)

    try:
        runtime = get_runtime(runtime_name)
        env = _build_agent_env(agent, project)
        sandbox = await runtime.create(agent.name, env)
        sandbox_id = sandbox.id
        op_log.info("container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url)

        api_key = env.get("ANTHROPIC_API_KEY", "")
        hook_env = {
            "AGENT_ID": str(agent.id),
            "ABOX_CALLBACK_URL": env.get("ABOX_CALLBACK_URL", ""),
        }
        await provision_workspace(runtime, sandbox.id, project, api_key=api_key, agent_env=hook_env)

        team_name = project.name.lower().replace(" ", "-")
        parent_session_id = str(project.id)

        claude_cmd = (
            f"cd /home/computeruse && claude"
            f" --agent-id {agent.name}@{team_name}"
            f" --agent-name {agent.name}"
            f" --team-name {team_name}"
            f" --parent-session-id {parent_session_id}"
            f" --agent-type general-purpose"
            f" --model claude-opus-4-6"
            f" --dangerously-skip-permissions"
        )
        # Wrap so that when claude exits (for any reason), we notify the backend
        exit_payload = (
            f'{{"hook_event_name":"ProcessExit","agent_id":"{agent_id}"}}'
        )
        callback_url = env.get("ABOX_CALLBACK_URL", "")
        wrapped_cmd = (
            f'{claude_cmd}; '
            f"curl -sf -X POST '{callback_url}/hooks/event' "
            f"-H 'Content-Type: application/json' "
            f"-d '{exit_payload}' >/dev/null 2>&1 || true"
        )
        await runtime.exec(
            sandbox.id,
            ["tmux", "new-session", "-d", "-s", "claude", "-x", "200", "-y", "50", "bash", "-c", wrapped_cmd],
        )
        op_log.info("claude_code_launched", team_name=team_name, parent_session_id=parent_session_id)

        await _capture_sandbox_logs(runtime, sandbox.id, op_log)

        agent = await _save_provisioned(agent_id, sandbox.id, sandbox.vnc_url, team_name, parent_session_id)
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


async def process_hook_event(payload: dict) -> None:
    """Process an inbound hook event from an agent container.

    Expects Claude Code's native stdin JSON with `agent_id` injected by hook-event.sh.
    """
    agent_id = payload.pop("agent_id", "")
    event_type = payload.get("hook_event_name", "")

    op_log = log.bind(agent_id=agent_id, event_type=event_type)
    op_log.info("processing_hook_event")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found_for_event")
        return

    await broadcast_agent_event(agent, event_type, payload)

    # Update agent common fields from Claude Code's native schema
    update_fields = []

    session_id = payload.get("session_id", "")
    if session_id and session_id != agent.session_id:
        agent.session_id = session_id
        update_fields.append("session_id")

    cwd = payload.get("cwd", "")
    if cwd and cwd != agent.cwd:
        agent.cwd = cwd
        update_fields.append("cwd")

    transcript_path = payload.get("transcript_path", "")
    if transcript_path and transcript_path != agent.transcript_path:
        agent.transcript_path = transcript_path
        update_fields.append("transcript_path")

    permission_mode = payload.get("permission_mode", "")
    if permission_mode and permission_mode != agent.permission_mode:
        agent.permission_mode = permission_mode
        update_fields.append("permission_mode")

    # Extract model on SessionStart (it's in the top-level payload)
    if event_type == "SessionStart":
        model = payload.get("model", "")
        if model and model != agent.model:
            agent.model = model
            update_fields.append("model")

    # Status transitions — ProcessExit means claude process died (may never
    # have started a session), so treat as STOPPED.
    _STATUS_MAP = {
        "SessionStart": AgentStatus.RUNNING,
        "SessionEnd": AgentStatus.STOPPED,
        "Stop": AgentStatus.STOPPED,
        "ProcessExit": AgentStatus.STOPPED,
    }

    new_status = _STATUS_MAP.get(event_type)
    if new_status and agent.status != new_status:
        agent.status = new_status
        update_fields.append("status")

    if update_fields:
        await agent.asave(update_fields=update_fields)
        await broadcast_agent_update(agent)
        op_log.info("agent_updated", fields=update_fields)


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
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
        "CLAUDECODE": "1",
    }
