import asyncio
from datetime import timedelta

import structlog
from django.utils import timezone

from agents.models import Agent, AgentEvent, AgentStatus, GoalStatus, GoalTrajectory
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update

log = structlog.get_logger("agents.gda")

POLL_INTERVAL = 5  # seconds


async def gda_loop() -> None:
    """Main GDA loop. Polls active agents and evaluates state mechanically."""
    log.info("gda_loop_started")
    while True:
        try:
            active_statuses = [
                AgentStatus.WORKING,
                AgentStatus.CONVERSING,
                AgentStatus.NEEDS_INFO,
                AgentStatus.BLOCKED,
                AgentStatus.GOAL_CHANGED,
            ]
            async for agent in Agent.objects.filter(
                status__in=active_statuses
            ).select_related("goal", "project"):
                try:
                    await evaluate_agent(agent)
                except Exception:
                    log.exception("evaluate_agent_failed", agent=agent.name)
        except Exception:
            log.exception("gda_loop_error")

        await asyncio.sleep(POLL_INTERVAL)


async def evaluate_agent(agent: Agent) -> None:
    """Evaluate a single agent's state and take mechanical action."""
    op_log = log.bind(agent=agent.name, project_id=str(agent.project_id))

    # Check container health
    runtime = get_runtime(agent.runtime)
    container_status = await runtime.get_status(agent.sandbox_id)

    if container_status != "running" and agent.status != AgentStatus.COMPLETED:
        op_log.warning("container_dead", container_status=container_status)
        agent.status = AgentStatus.DEAD
        await agent.asave(update_fields=["status"])
        event = await AgentEvent.objects.acreate(
            agent=agent,
            event_type="agent_died",
            data={"container_status": container_status},
        )
        await broadcast_agent_update(agent)
        await broadcast_agent_event(event)
        return

    # Act on meta protocol status
    match agent.status:
        case AgentStatus.WORKING | AgentStatus.CONVERSING:
            pass  # healthy, just monitor

        case AgentStatus.NEEDS_INFO:
            await _handle_needs_info(agent, op_log)

        case AgentStatus.BLOCKED:
            await _handle_blocked(agent, op_log)

        case AgentStatus.COMPLETED:
            await _handle_completed(agent, op_log)

        case AgentStatus.GOAL_CHANGED:
            await _handle_goal_changed(agent, op_log)


async def _handle_needs_info(agent: Agent, op_log) -> None:
    """System tries to help before escalating to user.

    For now, log it. Future: casebase lookup, env scan, etc.
    """
    # Check how long agent has been in needs_info
    last_event = await AgentEvent.objects.filter(
        agent=agent, event_type__in=["heartbeat", "session_start", "created"]
    ).order_by("-timestamp").afirst()

    if last_event and (timezone.now() - last_event.timestamp) > timedelta(minutes=5):
        # Stale needs_info -- escalate
        op_log.info("needs_info_escalating")
        event = await AgentEvent.objects.acreate(
            agent=agent,
            event_type="escalation",
            data={
                "reason": "Agent needs information",
                "summary": agent.summary,
                "reasoning": agent.reasoning,
            },
        )
        await broadcast_agent_event(event)
    else:
        op_log.debug("needs_info_waiting")


async def _handle_blocked(agent: Agent, op_log) -> None:
    """Agent is blocked. Escalate to user."""
    op_log.info("agent_blocked", reasoning=agent.reasoning)
    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="escalation",
        data={
            "reason": "Agent is blocked",
            "summary": agent.summary,
            "reasoning": agent.reasoning,
        },
    )
    await broadcast_agent_event(event)


async def _handle_completed(agent: Agent, op_log) -> None:
    """Agent reports completed. Retain case, mark goal satisfied."""
    op_log.info("agent_completed")

    goal = agent.goal
    if goal and goal.status == GoalStatus.ACTIVE:
        goal.status = GoalStatus.SATISFIED
        goal.satisfied_at = timezone.now()
        await goal.asave(update_fields=["status", "satisfied_at"])

        # Trajectory snapshot
        await GoalTrajectory.objects.acreate(
            goal=goal,
            text_snapshot=goal.text,
            plan_snapshot=goal.plan,
            trigger="satisfied",
        )

    # Mark agent as done
    agent.completed_at = timezone.now()
    await agent.asave(update_fields=["completed_at"])

    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="completed",
        data={"output": agent.output},
    )
    await broadcast_agent_update(agent)
    await broadcast_agent_event(event)

    # Terminate container
    runtime = get_runtime(agent.runtime)
    await runtime.terminate(agent.sandbox_id)
    op_log.info("container_terminated_after_completion")


async def _handle_goal_changed(agent: Agent, op_log) -> None:
    """Goal has evolved. Create trajectory node, check plan staleness."""
    op_log.info("goal_changed", reasoning=agent.reasoning)

    goal = agent.goal
    if goal:
        await GoalTrajectory.objects.acreate(
            goal=goal,
            text_snapshot=goal.text,
            plan_snapshot=goal.plan,
            trigger="goal_evolved",
        )

    # Reset status to working so GDA doesn't re-trigger
    agent.status = AgentStatus.WORKING
    await agent.asave(update_fields=["status"])

    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="goal_changed",
        data={"reasoning": agent.reasoning},
    )
    await broadcast_agent_update(agent)
    await broadcast_agent_event(event)
