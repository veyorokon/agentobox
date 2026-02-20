"""
Inter-agent message delivery through the Agentobox backend.

Messages are delivered to target agents via the pending_input (stdin)
piggyback pattern. The MCP coordination server's teammate_message and
teammate_broadcast tools call into this module directly.

Flow:
    1. Agent calls teammate_message MCP tool
    2. _deliver_to_stdin() formats message as stream-json input
    3. Message enqueued in target agent's pending_input
    4. Target relay picks up pending_input via piggyback response
    5. Relay writes to Claude's stdin -> agent receives it immediately
"""

import uuid

import structlog

from agents.models import Agent, AgentStatus, Message
from agents.services.broadcast import broadcast_agent_update, broadcast_stream_message
from agents.services.comms import _atomic_enqueue

log = structlog.get_logger("agents.interagent")


async def _handle_broadcast(
    sender: Agent,
    content: str,
    summary: str,
) -> None:
    """Route a broadcast message to all other agents in the project."""
    agents = [
        a async for a in Agent.objects.filter(project_id=sender.project_id)
        .exclude(id=sender.id)
        .exclude(status=AgentStatus.STOPPED)
    ]

    if not agents:
        return

    for agent in agents:
        await _deliver_to_stdin(sender.name, agent, content)

    log.info(
        "interagent_broadcast_routed",
        sender=sender.name,
        recipients=[a.name for a in agents],
    )


async def _deliver_to_stdin(sender_name: str, target: Agent, content: str) -> None:
    """
    Deliver an inter-agent message via pending_input (stdin).

    Formats the message as a stream-json user input so the relay writes it
    to Claude's stdin. Claude processes it immediately as a user turn.
    The prefix identifies it as a team message so the agent knows the source.
    """
    team_msg = f"[Team message from {sender_name}]: {content}"
    parts = [{"type": "text", "text": team_msg}]

    # Store Message so the dashboard feed shows inbound team messages
    msg_record = await Message.objects.acreate(
        agent=target,
        message_id=f"team_{uuid.uuid4().hex[:16]}",
        session_id=target.session_id or "",
        role="user",
        parts=parts,
        turn_number=0,
    )
    await broadcast_stream_message(target, msg_record)

    # Build stream-json stdin input
    input_msg = {
        "type": "user",
        "message": {
            "role": "user",
            "content": parts,
        },
    }

    # Atomic enqueue + wake idle agents
    target = await _atomic_enqueue(str(target.id), input_msg)
    await broadcast_agent_update(target)
