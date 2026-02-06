import structlog
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
    """Full agent creation: DB records, container, provisioning, Claude Code launch."""
    from projects.models import Project

    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("creating_agent", runtime=runtime_name)

    # 1. Fetch project
    project = await Project.objects.aget(id=project_id)

    # 2. Create goal + trajectory
    goal = await Goal.objects.acreate(
        project=project,
        text=goal_text,
        context_path=context_path,
    )
    await GoalTrajectory.objects.acreate(
        goal=goal,
        text_snapshot=goal_text,
        plan_snapshot=[],
        trigger="created",
    )

    # 3. Build env and create container
    runtime = get_runtime(runtime_name)
    env = _build_agent_env(project, goal, name)
    sandbox = await runtime.create(name, env)
    op_log.info("container_created", sandbox_id=sandbox.id, vnc_url=sandbox.vnc_url)

    # 4. Provision workspace (CLAUDE.md, hooks config)
    await provision_workspace(runtime, sandbox.id, project, goal)

    # 5. Launch Claude Code in tmux
    claude_cmd = (
        f"cd {goal.context_path} && "
        f"claude --dangerously-skip-permissions -p '{goal.text}'"
    )
    await runtime.exec(
        sandbox.id,
        ["tmux", "new-session", "-d", "-s", "claude", claude_cmd],
    )
    op_log.info("claude_code_launched")

    # 6. Create agent record
    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        goal=goal,
        runtime=runtime_name,
        sandbox_id=sandbox.id,
        vnc_url=sandbox.vnc_url,
        status=AgentStatus.WORKING,
    )

    # 7. Emit creation event + broadcast
    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="created",
        data={"goal": goal_text, "context": context_path},
    )
    await broadcast_agent_update(agent)
    await broadcast_agent_event(event)

    op_log.info("agent_created", agent_id=str(agent.id))
    return agent


async def kill_agent(project_id: str, name: str) -> bool:
    """Stop and remove an agent's container, mark as dead."""
    op_log = log.bind(project_id=str(project_id), agent=name)
    op_log.info("killing_agent")

    try:
        agent = await Agent.objects.aget(project_id=project_id, name=name)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    runtime = get_runtime(agent.runtime)
    await runtime.terminate(agent.sandbox_id)

    agent.status = AgentStatus.DEAD
    await agent.asave(update_fields=["status"])

    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="killed",
        data={},
    )
    await broadcast_agent_update(agent)
    await broadcast_agent_event(event)

    op_log.info("agent_killed")
    return True


async def process_agent_event(payload: dict) -> None:
    """Process an inbound event from an agent webhook callback."""
    agent_name = payload.get("agent_name", "")
    project_id = payload.get("project_id", "")
    event_type = payload.get("event_type", "")

    op_log = log.bind(
        agent=agent_name, project_id=project_id, event_type=event_type
    )
    op_log.info("processing_agent_event")

    try:
        agent = await Agent.objects.aget(project_id=project_id, name=agent_name)
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


def _build_agent_env(project, goal, agent_name: str) -> dict[str, str]:
    """Build environment dict for the agent container."""
    # Project-level key takes priority, falls back to global setting
    anthropic_key = project.anthropic_api_key or getattr(
        settings, "ANTHROPIC_API_KEY", ""
    )

    return {
        "ANTHROPIC_API_KEY": anthropic_key,
        "WEBHOOK_SECRET": getattr(settings, "WEBHOOK_SECRET", ""),
        "PROJECT_ID": str(project.id),
        "AGENT_NAME": agent_name,
        "GOAL_TEXT": goal.text,
        "CONTEXT_PATH": goal.context_path,
        "ABOX_CALLBACK_URL": getattr(settings, "ABOX_CALLBACK_URL", ""),
    }
