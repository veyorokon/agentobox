import uuid

import structlog

from agents.models import Agent, AgentStatus, Message
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update, broadcast_stream_message

log = structlog.get_logger("agents.comms")


async def send_message(agent_id: str, message: str) -> bool:
    """
    Enqueue a message for delivery to an agent's Claude Code session.

    Instead of tmux send-keys, this enqueues the message as a stream-json
    input object in agent.pending_input (a list). The relay picks it up
    via the piggyback pattern in the next POST response cycle.

    Input format (stream-json stdin):
        {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "..."}]}}

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Piggyback Pattern"
    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Input Format"
    """
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    await broadcast_agent_event(agent, "inbound_message", {"message": message})

    # Store user message in stream Message model so the frontend sees it
    msg_record = await Message.objects.acreate(
        agent=agent,
        message_id=f"user_{uuid.uuid4().hex[:16]}",
        session_id=agent.session_id or "",
        role="user",
        parts=[{"type": "text", "text": message}],
        turn_number=0,
    )
    await broadcast_stream_message(agent, msg_record)

    # Build stream-json input object
    input_msg = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": message}],
        },
    }

    # Append to pending_input list — relay picks up via piggyback
    pending = agent.pending_input or []
    pending.append(input_msg)
    agent.pending_input = pending

    # Mark agent as running
    if agent.status != AgentStatus.RUNNING:
        agent.status = AgentStatus.RUNNING

    await agent.asave(update_fields=["pending_input", "status"])
    await broadcast_agent_update(agent)

    op_log.info("message_enqueued")
    return True


async def interrupt_agent(agent_id: str) -> bool:
    """
    Queue a SIGINT signal for an agent's Claude Code session.

    Instead of tmux C-c, this sets agent.pending_signal = "SIGINT".
    The relay picks it up via the piggyback pattern in the next
    heartbeat or POST response.

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Piggyback Pattern"
    """
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    agent.pending_signal = "SIGINT"
    await agent.asave(update_fields=["pending_signal"])

    await broadcast_agent_event(agent, "interrupted", {})
    op_log.info("interrupt_enqueued")
    return True
