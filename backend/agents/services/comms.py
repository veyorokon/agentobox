import uuid

import structlog
from asgiref.sync import sync_to_async
from django.db import transaction

from agents.models import Agent, AgentStatus, Message
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update, broadcast_stream_message

log = structlog.get_logger("agents.comms")


@sync_to_async
def _atomic_enqueue(agent_id: str, input_msg: dict) -> Agent:
    """Append to pending_input under a row lock to prevent concurrent clobber."""
    with transaction.atomic():
        agent = Agent.objects.select_for_update().get(id=agent_id)
        pending = agent.pending_input or []
        pending.append(input_msg)
        agent.pending_input = pending
        if agent.status != AgentStatus.RUNNING:
            agent.status = AgentStatus.RUNNING
        agent.save(update_fields=["pending_input", "status"])
    return agent


async def send_message(agent_id: str, message: str) -> bool:
    """
    Enqueue a message for delivery to an agent's Claude Code session.

    Instead of tmux send-keys, this enqueues the message as a stream-json
    input object in agent.pending_input (a list). The relay picks it up
    via the piggyback pattern in the next POST response cycle.

    Uses select_for_update() to prevent concurrent appends from losing
    messages (read-modify-write on JSONField without a lock is racy).

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

    await broadcast_agent_event(
        agent, "inbound_message", {"message": message},
        summary=f"Message sent to {agent.name}",
    )

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

    # Atomic append — lock the row to prevent concurrent writes from
    # clobbering each other's pending_input entries.
    agent = await _atomic_enqueue(agent_id, input_msg)
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

    await broadcast_agent_event(agent, "interrupted", {}, summary=f"{agent.name} interrupted")
    op_log.info("interrupt_enqueued")
    return True
