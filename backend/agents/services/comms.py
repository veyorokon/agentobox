"""
Agent communication: send messages, signals, and mode changes.

Commands are delivered to agents via WebSocket push through the relay's
persistent connection. Each command goes through:

    1. Create StreamEvent (append-only log)
    2. Broadcast to dashboard subscribers
    3. Push command to relay via Channels group_send

The relay consumer (consumers.py) receives group_send messages on the
relay_{agent_id} group and forwards them to the relay process over WebSocket.
"""

import copy
import uuid

import structlog
from channels.layers import get_channel_layer

from agents.models import Agent, AgentStatus
from agents.services.broadcast import broadcast_agent_update
from agents.services.utils import create_and_broadcast_event

log = structlog.get_logger("agents.comms")


def _needs_restart(agent: Agent) -> bool:
    """Check if an agent needs a hard restart before receiving a message."""
    return (
        agent.status in (AgentStatus.STOPPED, AgentStatus.ERROR)
        or (agent.status != AgentStatus.DEPLOYING and not agent.sandbox_id)
    )


def _normalize_content(content: list) -> list:
    """Normalize image content blocks for the Anthropic API.

    - URL sources: strip media_type (only valid for base64).
    - Non-HTTPS URLs (LocalStack in dev): convert to base64 inline so
      the API can read them.
    """
    import base64
    from urllib.parse import urlparse
    from urllib.request import urlopen

    for block in content:
        source = block.get("source") if isinstance(block, dict) else None
        if not source or source.get("type") != "url":
            continue

        url = source.get("url", "")
        source.pop("media_type", None)

        if not url.startswith("https://"):
            parsed = urlparse(url)
            if parsed.hostname not in ("localhost", "localstack", "127.0.0.1"):
                log.warning("url_fetch_blocked", url=url, reason="untrusted_host")
                continue
            fetch_url = url.replace("localhost:", "localstack:", 1)
            try:
                resp = urlopen(fetch_url, timeout=10)
                raw = resp.read()
                ct = resp.headers.get("Content-Type", "image/png")
                b64 = base64.b64encode(raw).decode()
                source.clear()
                source["type"] = "base64"
                source["media_type"] = ct
                source["data"] = b64
            except Exception:
                log.warning("url_to_base64_failed", url=url)

    return content


async def push_to_relay(agent_id: str, command: dict) -> None:
    """Push a command to the relay via Channels group_send.

    The RelayConsumer receives this on the relay_{agent_id} group
    and forwards it to the relay process over WebSocket.
    """
    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        f"relay_{agent_id}",
        {"type": "relay.command", "command": command},
    )


async def send_message(agent_id: str, message: str, content: list | None = None) -> bool:
    """Send a message to an agent's Claude Code session."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    # Build parts from content blocks or plain text
    if content:
        parts = content
        api_parts = _normalize_content(copy.deepcopy(parts))
    else:
        parts = [{"type": "text", "text": message}]
        api_parts = parts

    # Store as StreamEvent BEFORE restart so the message is persisted
    # regardless of whether the relay is connected yet.
    stream_event = await create_and_broadcast_event(
        agent,
        event_type="user",
        data={
            "type": "user",
            "message": {"role": "user", "content": parts},
            "session_id": agent.session_id or "",
        },
        message_id=f"user_{uuid.uuid4().hex[:16]}",
    )

    # Auto-restart dead agents — relay will backfill the message on connect
    if _needs_restart(agent):
        from agents.services.lifecycle import hard_restart_agent
        op_log.info("auto_restarting_agent", current_status=agent.status)
        await hard_restart_agent(str(agent_id))
        op_log.info("message_sent", delivery="backfill")
        return True

    # Push to relay via WebSocket
    input_msg = {
        "type": "user",
        "message": {"role": "user", "content": api_parts},
    }
    await push_to_relay(agent_id, {"type": "input", "payload": input_msg})

    op_log.info("message_sent")
    return True


async def answer_question(agent_id: str, tool_use_id: str, answer_text: str) -> bool:
    """Send a tool_result for an AskUserQuestion back to the agent."""
    op_log = log.bind(agent_id=agent_id, tool_use_id=tool_use_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    parts = [{"type": "tool_result", "tool_use_id": tool_use_id, "content": answer_text}]

    # Store as StreamEvent
    stream_event = await create_and_broadcast_event(
        agent,
        event_type="user",
        data={
            "type": "user",
            "message": {"role": "user", "content": parts},
            "session_id": agent.session_id or "",
        },
        message_id=f"answer_{uuid.uuid4().hex[:16]}",
    )

    # Push to relay via WebSocket
    input_msg = {"type": "user", "message": {"role": "user", "content": parts}}
    await push_to_relay(agent_id, {"type": "input", "payload": input_msg})

    op_log.info("question_answered")
    return True


async def broadcast_message(
    agent_ids: list[str], message: str, content: list | None = None,
) -> bool:
    """Send a message to multiple agents with broadcast dedup metadata."""
    from agents.services.lifecycle import hard_restart_agent

    if not agent_ids:
        return False

    broadcast_id = uuid.uuid4().hex[:16]
    op_log = log.bind(broadcast_id=broadcast_id, agent_count=len(agent_ids))

    if content:
        parts = content
        api_parts = _normalize_content(copy.deepcopy(parts))
    else:
        parts = [{"type": "text", "text": message}]
        api_parts = parts

    agents: list[Agent] = [a async for a in Agent.objects.filter(id__in=agent_ids)]
    found_ids = {str(a.id) for a in agents}
    for aid in agent_ids:
        if aid not in found_ids:
            op_log.warning("agent_not_found", agent_id=aid)

    if not agents:
        return False

    target_names = [a.name for a in agents]
    target_ids = [str(a.id) for a in agents]

    broadcast_meta = {
        "type": "_broadcast",
        "broadcast_id": broadcast_id,
        "target_agent_ids": target_ids,
        "target_names": target_names,
    }
    parts_with_meta = [*parts, broadcast_meta]

    for agent in agents:
        # Store with broadcast metadata BEFORE restart so the message is persisted
        stream_event = await create_and_broadcast_event(
            agent,
            event_type="user",
            data={
                "type": "user",
                "message": {"role": "user", "content": parts_with_meta},
                "session_id": agent.session_id or "",
            },
            message_id=f"user_{broadcast_id}_{agent.id}",
        )

        if _needs_restart(agent):
            op_log.info("auto_restarting_agent", agent_id=str(agent.id))
            await hard_restart_agent(str(agent.id))
            # Relay will backfill the message on connect
            continue

        # Push to relay via WebSocket
        input_msg = {"type": "user", "message": {"role": "user", "content": api_parts}}
        await push_to_relay(str(agent.id), {"type": "input", "payload": input_msg})

    op_log.info("broadcast_sent", targets=target_names)
    return True


async def set_agent_mode(agent_id: str, mode: str) -> Agent:
    """Change an agent's permission mode via relay restart."""
    VALID_MODES = {"default", "plan", "acceptEdits", "bypassPermissions", "dontAsk"}
    op_log = log.bind(agent_id=agent_id, mode=mode)

    if mode not in VALID_MODES:
        raise ValueError(f"Invalid permission mode: {mode}")

    agent = await Agent.objects.aget(id=agent_id)

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        raise ValueError(f"Agent must be running or idle (current: {agent.status})")

    if agent.permission_mode == mode:
        op_log.info("mode_change_noop")
        return agent

    agent.permission_mode = mode
    await agent.asave(update_fields=["permission_mode"])

    await broadcast_agent_update(agent)

    # Store mode change as StreamEvent
    stream_event = await create_and_broadcast_event(
        agent, event_type="mode_change", data={"mode": mode},
    )

    # Push to relay via WebSocket
    await push_to_relay(agent_id, {"type": "mode", "mode": mode})

    op_log.info("mode_change_sent")
    return agent


async def interrupt_agent(agent_id: str) -> bool:
    """Send SIGINT to an agent's Claude Code session."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    # Store as StreamEvent
    await create_and_broadcast_event(agent, event_type="interrupted", data={})

    # Push to relay via WebSocket
    await push_to_relay(agent_id, {"type": "signal", "signal": "SIGINT"})

    op_log.info("interrupt_sent")
    return True


async def restart_agent(agent_id: str) -> bool:
    """Soft restart an agent's Claude Code session."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("restart_skipped", status=agent.status)
        return False

    # Store as StreamEvent
    await create_and_broadcast_event(agent, event_type="restarting", data={})

    # Push to relay via WebSocket
    await push_to_relay(agent_id, {"type": "signal", "signal": "restart"})

    op_log.info("restart_sent")
    return True


async def clear_agent_session(agent_id: str) -> bool:
    """Clear an agent's conversation history and restart fresh."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("clear_session_skipped", status=agent.status)
        return False

    # Clear session files from container
    from agents.runtimes import get_runtime
    agent_state_dir = f"/mnt/abox-state/agents/{agent.id}/.claude"
    try:
        runtime = get_runtime(agent.runtime)
        await runtime.exec(agent.sandbox_id, [
            "bash", "-c",
            f"rm -rf {agent_state_dir}/projects/*/",
        ])
    except Exception:
        op_log.exception("clear_session_files_failed")

    agent.session_id = ""
    await agent.asave(update_fields=["session_id"])

    # Store as StreamEvent
    await create_and_broadcast_event(
        agent, event_type="cleared", data={}, session_id="",
    )

    # Push to relay via WebSocket
    await push_to_relay(agent_id, {"type": "signal", "signal": "clear"})

    op_log.info("session_cleared")
    return True
