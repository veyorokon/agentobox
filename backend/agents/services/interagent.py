"""
Inter-agent message delivery through the Agentobox backend.

Messages are delivered to target agents via the same durable inbox path
used for user input. The MCP coordination server's teammate_message and
teammate_broadcast tools call into this module directly.

Flow:
    1. Agent calls teammate_message MCP tool
    2. deliver_to_stdin() formats message as stream-json input
    3. StreamEvent created for feed visibility
    4. Input appended to target inbox.jsonl
    5. Relay gets a reload and consumes the inbox
"""

import uuid

import structlog

from agents.models import Agent, AgentStatus
from agents.services.relay import deliver_input
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
    """Deliver an inter-agent message via the durable inbox path.

    Formats the message as a stream-json user input so the relay writes it
    to Claude's stdin. The prefix identifies it as a team message.

    Returns True if the relay accepted the inbox reload, False if disconnected.
    The message is still durable either way because it was persisted to the
    inbox before the reload.
    """
    team_msg = f"[Team message from {sender_name}]: {content}"
    parts = [{"type": "text", "text": team_msg}]

    # Store as StreamEvent so the dashboard feed shows inbound team messages.
    # team_message_from lets the frontend render sender separately from content.
    await create_stream_event(
        target,
        event_type="user",
        data={
            "type": "user",
            "message": {"role": "user", "content": parts},
            "session_id": target.session_id or "",
            "team_message_from": sender_name,
        },
        message_id=f"team_{uuid.uuid4().hex[:16]}",
    )

    # Enqueue via the same durable inbox path used for all other input.
    input_msg = {
        "type": "user",
        "message": {"role": "user", "content": parts},
    }
    sent = await deliver_input(target, input_msg)
    if not sent:
        log.warning("comms.interagent_delivery_failed",
                    sender=sender_name, target=target.name)
    return sent
