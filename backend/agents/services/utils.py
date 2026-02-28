"""Shared service utilities -- thin helpers for repeated patterns."""

import structlog

from agents.models import Agent, StreamEvent
from agents.services.broadcast import broadcast_event

log = structlog.get_logger("agents.utils")


async def create_and_broadcast_event(
    agent: Agent,
    event_type: str,
    data: dict,
    session_id: str = "",
    message_id: str = "",
) -> StreamEvent:
    """Create a StreamEvent and broadcast it to dashboard subscribers.

    Consolidates the repeated acreate + broadcast_event two-liner.
    """
    stream_event = await StreamEvent.objects.acreate(
        agent=agent,
        session_id=session_id or agent.session_id or "",
        event_type=event_type,
        message_id=message_id,
        data=data,
    )
    await broadcast_event(agent, stream_event)
    return stream_event


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
    except Exception:
        op_log.exception("terminate_sandbox_failed", sandbox_id=agent.sandbox_id)
        return False
