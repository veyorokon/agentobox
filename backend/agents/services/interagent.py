"""
Inter-agent message delivery through the Agentobox backend.

Messages are delivered to target agents via WebSocket relay push.
The MCP coordination server's teammate_message and teammate_broadcast
tools call into this module directly.

Flow:
    1. Agent calls teammate_message MCP tool
    2. _deliver_to_stdin() formats message as stream-json input
    3. StreamEvent created for feed visibility
    4. Command pushed to relay via WebSocket
    5. Relay writes to Claude's stdin -> agent receives it immediately
"""

import uuid

import structlog

from agents.models import Agent, AgentStatus, StreamEvent
from agents.services.broadcast import broadcast_event
from agents.services.comms import _push_to_relay
from agents.services.feed import create_feed_item

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
    """Deliver an inter-agent message via relay WebSocket push.

    Formats the message as a stream-json user input so the relay writes it
    to Claude's stdin. The prefix identifies it as a team message.
    """
    team_msg = f"[Team message from {sender_name}]: {content}"
    parts = [{"type": "text", "text": team_msg}]

    # Store as StreamEvent so the dashboard feed shows inbound team messages
    stream_event = await StreamEvent.objects.acreate(
        agent=target,
        session_id=target.session_id or "",
        event_type="user",
        message_id=f"team_{uuid.uuid4().hex[:16]}",
        data={
            "type": "user",
            "message": {"role": "user", "content": parts},
            "session_id": target.session_id or "",
        },
    )
    await broadcast_event(target, stream_event)

    # Create agent-message feed item
    await create_feed_item(
        project_id=str(target.project_id),
        source_event=stream_event,
        agent_record=target,
        type="agent-message",
        from_value=sender_name,
        to_value=target.name,
        text=content,
    )

    # Push to relay via WebSocket
    input_msg = {
        "type": "user",
        "message": {"role": "user", "content": parts},
    }
    await _push_to_relay(str(target.id), {"type": "input", "payload": input_msg})
