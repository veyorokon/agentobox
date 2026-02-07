import asyncio

import structlog
from asgiref.sync import sync_to_async
from django.conf import settings

from agents.models import Agent, AgentEvent, AgentStatus, Goal, GoalTrajectory
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update
from agents.services.provision import provision_workspace

log = structlog.get_logger("agents.lifecycle")


async def create_agent(
    project_id: str,
    name: str,
    goal_text: str,
    context_path: str,
    runtime_name: str = "modal",
) -> Agent:
    """Create agent record immediately, provision container in background."""
    from projects.models import Project

    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("creating_agent", runtime=runtime_name)

    # --- Phase 1: synchronous DB creation (~100ms) ---

    project = await Project.objects.aget(id=project_id)

    goal = await Goal.objects.acreate(
        project=project,
        text=goal_text,
        context_path=context_path or "/home/computeruse",
    )
    await GoalTrajectory.objects.acreate(
        goal=goal,
        text_snapshot=goal_text,
        plan_snapshot=[],
        trigger="created",
    )

    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        goal=goal,
        runtime=runtime_name,
        sandbox_id="",
        vnc_url="",
        status=AgentStatus.DEPLOYING,
    )

    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="created",
        data={"goal": goal_text, "context": context_path},
    )
    await broadcast_agent_update(agent)
    await broadcast_agent_event(event)

    op_log.info("agent_created", agent_id=str(agent.id))

    # --- Phase 2: background provisioning ---
    asyncio.create_task(
        _provision_agent(agent, project, goal, runtime_name, op_log)
    )

    return agent


def _save_agent_provisioned(agent_id, sandbox_id, vnc_url):
    """Sync helper: mark agent as working with sandbox details."""
    agent = Agent.objects.get(id=agent_id)
    agent.sandbox_id = sandbox_id
    agent.vnc_url = vnc_url
    agent.status = AgentStatus.WORKING
    agent.save(update_fields=["sandbox_id", "vnc_url", "status"])
    return agent


def _save_agent_failed(agent_id):
    """Sync helper: mark agent as dead and create failure event."""
    agent = Agent.objects.get(id=agent_id)
    agent.status = AgentStatus.DEAD
    agent.save(update_fields=["status"])
    event = AgentEvent.objects.create(
        agent=agent,
        event_type="provision_failed",
        data={"error": "Container provisioning failed"},
    )
    return agent, event


# thread_sensitive=False: runs in a new thread, independent of request lifecycle.
# This is critical because _provision_agent runs as an asyncio.create_task detached
# from the HTTP request. The default thread_sensitive=True would use the request's
# CurrentThreadExecutor which dies when the response is sent.
_save_provisioned = sync_to_async(_save_agent_provisioned, thread_sensitive=False)
_save_failed = sync_to_async(_save_agent_failed, thread_sensitive=False)


async def _provision_agent(agent, project, goal, runtime_name, op_log):
    """Background task: create container, provision workspace, launch Claude."""
    runtime = None
    sandbox_id = None
    agent_id = str(agent.id)

    try:
        runtime = get_runtime(runtime_name)
        env = _build_agent_env(agent, project, goal)
        sandbox = await runtime.create(agent.name, env)
        sandbox_id = sandbox.id
        op_log.info("container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url)

        await provision_workspace(runtime, sandbox.id, project, goal)

        claude_cmd = f"cd {goal.context_path} && claude --dangerously-skip-permissions"
        await runtime.exec(
            sandbox.id,
            ["tmux", "new-session", "-d", "-s", "claude", "bash", "-c", claude_cmd],
        )
        op_log.info("claude_code_launched")

        # Send the goal as the first message
        await runtime.exec(
            sandbox.id,
            ["tmux", "send-keys", "-t", "claude", goal.text, "Enter"],
        )
        op_log.info("goal_sent")

        await _capture_sandbox_logs(runtime, sandbox.id, op_log)

        agent = await _save_provisioned(agent_id, sandbox.id, sandbox.vnc_url)
        await broadcast_agent_update(agent)

        op_log.info("agent_provisioned", agent_id=agent_id)

    except Exception:
        op_log.exception("agent_provision_failed", agent_id=agent_id)

        # Terminate orphaned sandbox if one was created
        if runtime and sandbox_id:
            try:
                await runtime.terminate(sandbox_id)
                op_log.info("orphan_sandbox_terminated", sandbox_id=sandbox_id)
            except Exception:
                op_log.exception("orphan_cleanup_failed", sandbox_id=sandbox_id)

        try:
            agent, event = await _save_failed(agent_id)
            await broadcast_agent_update(agent)
            await broadcast_agent_event(event, agent=agent)
        except Exception:
            op_log.exception("provision_cleanup_db_failed", agent_id=agent_id)


async def kill_agent(agent_id: str) -> bool:
    """Stop and remove an agent's container, mark as terminated."""
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

    agent.status = AgentStatus.TERMINATED
    await agent.asave(update_fields=["status"])

    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="terminated",
        data={},
    )
    await broadcast_agent_update(agent)
    await broadcast_agent_event(event)

    op_log.info("agent_killed")
    return True


async def process_agent_event(payload: dict) -> None:
    """Process an inbound event from an agent webhook callback."""
    agent_id = payload.get("agent_id", "")
    event_type = payload.get("event_type", "")

    op_log = log.bind(agent_id=agent_id, event_type=event_type)
    op_log.info("processing_agent_event")

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found_for_event")
        return

    # Save event + broadcast
    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type=event_type,
        data=payload.get("data", {}),
    )
    await broadcast_agent_event(event)

    # Update meta protocol fields if present
    meta_fields = ["status", "confidence", "sentiment", "summary", "reasoning", "output"]
    update_fields = []
    for field in meta_fields:
        if field in payload:
            value = payload[field]
            # Validate status enum
            if field == "status":
                valid_statuses = [s.value for s in AgentStatus]
                if value not in valid_statuses:
                    op_log.warning("invalid_status", status=value)
                    continue
            setattr(agent, field, value)
            update_fields.append(field)

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


def _build_agent_env(agent, project, goal) -> dict[str, str]:
    """Build environment dict for the agent container."""
    # Project-level key takes priority, falls back to global setting
    anthropic_key = project.anthropic_api_key or getattr(
        settings, "ANTHROPIC_API_KEY", ""
    )

    return {
        "ANTHROPIC_API_KEY": anthropic_key,
        "WEBHOOK_SECRET": getattr(settings, "WEBHOOK_SECRET", ""),
        "AGENT_ID": str(agent.id),
        "PROJECT_ID": str(project.id),
        "AGENT_NAME": agent.name,
        "GOAL_TEXT": goal.text,
        "CONTEXT_PATH": goal.context_path,
        "ABOX_CALLBACK_URL": getattr(settings, "ABOX_CALLBACK_URL", ""),
    }
