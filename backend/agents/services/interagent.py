"""
Route inter-agent messages through the Agentobox backend.

Claude Code's native team system is file-based and single-machine-only.
When agents run in separate containers, SendMessage writes to a local
inbox file that no other agent can read. This module intercepts SendMessage
tool_use parts from the stream and delivers them to the target agent via
the pending_input (stdin) piggyback pattern.

Flow:
    1. Agent A calls SendMessage -> Claude writes to local file (no-op)
    2. assistant event with SendMessage tool_use arrives in stream.py
    3. route_inter_agent_messages() extracts recipient + content
    4. Message is formatted as a stream-json user input and enqueued
       in target agent's pending_input
    5. Target relay picks up pending_input via piggyback response
    6. Relay writes to Claude's stdin -> agent receives it immediately

See: docs/FOUNDATIONS.md, "Distributed Team Bridge"
"""

import uuid

import structlog
from asgiref.sync import sync_to_async
from django.db import transaction

from agents.models import Agent, AgentStatus, AgentTask, Message
from agents.services.broadcast import broadcast_agent_update, broadcast_stream_message

log = structlog.get_logger("agents.interagent")


async def route_inter_agent_messages(sender: Agent, parts: list[dict]) -> None:
    """
    Scan content parts for SendMessage tool_use calls and route them.

    Called from _handle_assistant in stream.py after storing the Message.
    Only processes tool_use parts with name="SendMessage".
    """
    for part in parts:
        if part.get("type") != "tool_use" or part.get("name") != "SendMessage":
            continue

        input_data = part.get("input", {})
        msg_type = input_data.get("type", "message")
        content = input_data.get("content", "")
        summary = input_data.get("summary", "")

        if not content:
            continue

        if msg_type == "broadcast":
            await _handle_broadcast(sender, content, summary)
        elif msg_type in ("message", "shutdown_request", "plan_approval_response"):
            recipient = input_data.get("recipient", "")
            if recipient:
                await _handle_direct_message(sender, recipient, content, summary, msg_type)
        elif msg_type == "shutdown_response":
            # shutdown_response doesn't have a recipient — it goes back to whoever
            # sent the shutdown_request. Route to all agents as a fallback (rare).
            await _handle_broadcast(sender, content, summary)


async def _handle_direct_message(
    sender: Agent,
    recipient_name: str,
    content: str,
    summary: str,
    msg_type: str,
) -> None:
    """Route a direct message to a specific agent by name."""
    try:
        target = await Agent.objects.aget(
            project_id=sender.project_id, name=recipient_name,
        )
    except Agent.DoesNotExist:
        log.warning(
            "interagent_recipient_not_found",
            sender=sender.name,
            recipient=recipient_name,
        )
        return

    await _deliver_to_stdin(sender.name, target, content)

    log.info(
        "interagent_message_routed",
        sender=sender.name,
        recipient=recipient_name,
        type=msg_type,
    )


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


async def route_task_operations(agent: Agent, parts: list[dict]) -> None:
    """
    Scan content parts for TaskCreate/TaskUpdate tool_use calls
    and sync them to AgentTask records for dashboard visibility.

    Same pattern as route_inter_agent_messages() — observe after local
    execution and mirror state to the DB.

    See: docs/ARCHITECTURE.md
    """
    for part in parts:
        if part.get("type") != "tool_use":
            continue
        name = part.get("name", "")
        input_data = part.get("input", {})

        if name == "TaskCreate":
            await _handle_task_create(agent, input_data)
        elif name == "TaskUpdate":
            await _handle_task_update(agent, input_data)


async def _handle_task_create(agent: Agent, input_data: dict) -> None:
    """Create or update an AgentTask from a TaskCreate tool call."""
    subject = input_data.get("subject", "")
    if not subject:
        return

    description = input_data.get("description", "")
    # Claude's TaskCreate doesn't return an ID in the tool_use input —
    # the ID is in the tool_result. Use subject as a stable key for now,
    # and update when we see the TaskUpdate with the real ID.
    task_id = f"tc_{hash(subject) & 0xFFFFFFFF:08x}"

    await AgentTask.objects.aupdate_or_create(
        project_id=agent.project_id,
        task_id=task_id,
        defaults={
            "agent": agent,
            "subject": subject[:500],
            "description": description,
            "status": "pending",
        },
    )
    log.info("task_create_synced", agent=agent.name, subject=subject[:80])


async def _handle_task_update(agent: Agent, input_data: dict) -> None:
    """Update an AgentTask from a TaskUpdate tool call."""
    task_id = input_data.get("taskId", "")
    if not task_id:
        return

    updates = {}
    if "status" in input_data:
        updates["status"] = input_data["status"]
    if "subject" in input_data:
        updates["subject"] = input_data["subject"][:500]
    if "description" in input_data:
        updates["description"] = input_data["description"]
    if "owner" in input_data:
        updates["owner"] = input_data["owner"]

    if not updates:
        return

    # Try to find by Claude's task ID first, then by our generated prefix
    updated = await AgentTask.objects.filter(
        project_id=agent.project_id, task_id=task_id,
    ).aupdate(**updates)

    if not updated:
        # Task might have been created with our hash-based ID; try numeric match
        # Claude uses sequential IDs like "1", "2", etc.
        log.debug(
            "task_update_no_match",
            agent=agent.name,
            task_id=task_id,
            updates=updates,
        )
    else:
        log.info("task_update_synced", agent=agent.name, task_id=task_id)


@sync_to_async
def _atomic_enqueue(agent_id: str, input_msg: dict) -> Agent:
    """Append to pending_input under a row lock to prevent concurrent clobber."""
    with transaction.atomic():
        agent = Agent.objects.select_for_update().get(id=agent_id)
        pending = agent.pending_input or []
        pending.append(input_msg)
        agent.pending_input = pending

        if agent.status == AgentStatus.IDLE:
            agent.status = AgentStatus.RUNNING
        agent.save(update_fields=["pending_input", "status"])
    return agent
