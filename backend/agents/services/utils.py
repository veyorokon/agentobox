"""Shared service utilities -- thin helpers for repeated patterns."""

import structlog
from asgiref.sync import sync_to_async

from agents.models import Agent, AgentStatus, StreamEvent

log = structlog.get_logger("abox.comms")


async def create_stream_event(
    agent: Agent,
    event_type: str,
    data: dict,
    session_id: str = "",
    message_id: str = "",
) -> StreamEvent:
    """Create a StreamEvent row. Dashboard picks up new events via polling."""
    stream_event = await StreamEvent.objects.acreate(
        agent=agent,
        session_id=session_id or agent.session_id or "",
        event_type=event_type,
        message_id=message_id,
        data=data,
    )
    return stream_event


async def get_team_roster(project) -> list[dict]:
    """Build team roster for CLAUDE.md -- list of {name, role, instructions}."""
    all_agents = await sync_to_async(
        lambda: list(
            Agent.objects.filter(project=project)
            .exclude(status=AgentStatus.STOPPED)
        ),
        thread_sensitive=False,
    )()
    return [
        {"name": a.name, "role": a.role, "instructions": a.instructions or ""}
        for a in all_agents
    ]


async def terminate_sandbox(agent: Agent, op_log) -> bool:
    """Safely terminate an agent's sandbox container.

    Returns True if terminated, False if no sandbox or error.
    """
    if not agent.sandbox_id:
        return False
    try:
        from agents.runtimes import get_runtime

        runtime = get_runtime(agent.runtime)
        await runtime.terminate(agent.sandbox_id)
        return True
    except Exception as exc:  # intentional: container may already be gone — log and report failure
        from agents.errors import ERR_UTILS_TERMINATE_FAILED
        op_log.exception(
            "runtime.terminate_failed",
            sandbox_id=agent.sandbox_id,
            error_code=ERR_UTILS_TERMINATE_FAILED,
            error_class=type(exc).__name__,
            operation="terminate_sandbox",
            agent_id=str(agent.id),
        )
        return False
