"""
Inter-agent message delivery through the Agentobox backend.

Messages are delivered to target agents via WebSocket relay push.
The MCP coordination server's teammate_message and teammate_broadcast
tools call into this module directly.

Flow:
    1. Agent calls teammate_message MCP tool
    2. deliver_to_stdin() formats message as stream-json input
    3. StreamEvent created for feed visibility
    4. Command pushed to relay via WebSocket
    5. Relay writes to Claude's stdin -> agent receives it immediately
"""

import uuid

import structlog

from agents.models import Agent, AgentStatus
from agents.services.comms import push_to_relay
from agents.services.utils import create_stream_event

log = structlog.get_logger("abox.comms")


async def deliver_broadcast(
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

    failed = []
    for agent in agents:
        sent = await deliver_to_stdin(sender.name, agent, content)
        if not sent:
            failed.append(agent.name)

    log.info(
        "comms.interagent_routed",
        sender=sender.name,
        recipients=[a.name for a in agents],
        failed=failed or None,
    )


async def deliver_to_stdin(sender_name: str, target: Agent, content: str) -> bool:
    """Deliver an inter-agent message via relay WebSocket push.

    Formats the message as a stream-json user input so the relay writes it
    to Claude's stdin. The prefix identifies it as a team message.

    Returns True if the relay accepted the push, False if disconnected.
    The message is always persisted as a StreamEvent regardless — backfill
    on reconnect will replay it.
    """
    team_msg = f"[Team message from {sender_name}]: {content}"
    parts = [{"type": "text", "text": team_msg}]

    # Store as StreamEvent so the dashboard feed shows inbound team messages
    stream_event = await create_stream_event(
        target,
        event_type="user",
        data={
            "type": "user",
            "message": {"role": "user", "content": parts},
            "session_id": target.session_id or "",
        },
        message_id=f"team_{uuid.uuid4().hex[:16]}",
    )

    # Push to relay via WebSocket
    input_msg = {
        "type": "user",
        "message": {"role": "user", "content": parts},
    }
    sent = await push_to_relay(str(target.id), {"type": "input", "payload": input_msg})
    if not sent:
        log.warning("comms.interagent_delivery_failed",
                    sender=sender_name, target=target.name)
    return sent
