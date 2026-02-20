import uuid

import structlog
from asgiref.sync import sync_to_async
from django.db import transaction

from agents.models import Agent, AgentStatus, Message
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update, broadcast_stream_message

log = structlog.get_logger("agents.comms")


def _normalize_content(content: list) -> list:
    """Normalize image content blocks for the Anthropic API.

    - URL sources: strip media_type (only valid for base64).
    - Non-HTTPS URLs (LocalStack in dev): convert to base64 inline so
      the API can read them. The backend can reach LocalStack even though
      Anthropic's servers can't.
    """
    import base64
    import mimetypes
    from urllib.request import urlopen

    for block in content:
        source = block.get("source") if isinstance(block, dict) else None
        if not source or source.get("type") != "url":
            continue

        url = source.get("url", "")
        source.pop("media_type", None)

        if not url.startswith("https://"):
            # Only allow fetching from known internal hosts (SSRF prevention)
            from urllib.parse import urlparse
            parsed = urlparse(url)
            if parsed.hostname not in ("localhost", "localstack", "127.0.0.1"):
                log.warning("url_fetch_blocked", url=url, reason="untrusted_host")
                continue
            # Rewrite localhost -> Docker service name so backend container
            # can reach LocalStack
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


@sync_to_async
def _atomic_enqueue(agent_id: str, input_msg: dict) -> Agent:
    """Append to pending_input under a row lock to prevent concurrent clobber."""
    with transaction.atomic():
        agent = Agent.objects.select_for_update().get(id=agent_id)
        pending = agent.pending_input or []
        pending.append(input_msg)
        agent.pending_input = pending

        # Only promote to RUNNING if agent is IDLE (relay is alive to deliver).
        # DEPLOYING: leave it — relay will transition when it connects.
        # RUNNING: already processing, just enqueue.
        # STOPPED/ERROR: handled by auto-restart before this point.
        if agent.status == AgentStatus.IDLE:
            agent.status = AgentStatus.RUNNING
        agent.save(update_fields=["pending_input", "status", "updated_at"])
    return agent


async def send_message(agent_id: str, message: str, content: list | None = None) -> bool:
    """
    Enqueue a message for delivery to an agent's Claude Code session.

    Instead of tmux send-keys, this enqueues the message as a stream-json
    input object in agent.pending_input (a list). The relay picks it up
    via the piggyback pattern in the next POST response cycle.

    Uses select_for_update() to prevent concurrent appends from losing
    messages (read-modify-write on JSONField without a lock is racy).

    When `content` is provided (list of Anthropic content blocks), it's
    used directly as parts/content. Otherwise, `message` is wrapped as
    a single text block.

    Input format (stream-json stdin):
        {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "..."}]}}

    See: docs/ARCHITECTURE.md, "Piggyback Pattern"
    See: docs/ARCHITECTURE.md, "Input Format"
    """
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    # Auto-restart dead agents — reprovision before enqueuing
    needs_restart = (
        agent.status in (AgentStatus.STOPPED, AgentStatus.ERROR)
        or (agent.status != AgentStatus.DEPLOYING and not agent.sandbox_id)
    )
    if needs_restart:
        from agents.services.lifecycle import hard_restart_agent

        op_log.info("auto_restarting_agent", current_status=agent.status)
        agent = await hard_restart_agent(str(agent_id))
        # Agent is now DEPLOYING. Message will be enqueued below.
        # pending_input survives restart — relay delivers when ready.

    # Build parts from content blocks or plain text
    if content:
        import copy
        parts = content
        text_summary = next(
            (b["text"] for b in parts if b.get("type") == "text"), message
        )
        # Normalize a copy for the relay — original stays intact for storage/feed
        api_parts = _normalize_content(copy.deepcopy(parts))
    else:
        parts = [{"type": "text", "text": message}]
        api_parts = parts
        text_summary = message

    # Store user message in stream Message model so the frontend sees it
    # (uses original parts with URLs so feed_transform can extract image_urls)
    msg_record = await Message.objects.acreate(
        agent=agent,
        message_id=f"user_{uuid.uuid4().hex[:16]}",
        session_id=agent.session_id or "",
        role="user",
        parts=parts,
        turn_number=0,
    )
    await broadcast_stream_message(agent, msg_record)

    # Build stream-json input object (uses normalized parts for the API)
    input_msg = {
        "type": "user",
        "message": {
            "role": "user",
            "content": api_parts,
        },
    }

    # Atomic append — lock the row to prevent concurrent writes from
    # clobbering each other's pending_input entries.
    agent = await _atomic_enqueue(agent_id, input_msg)
    await broadcast_agent_update(agent)

    op_log.info("message_enqueued")
    return True


async def answer_question(agent_id: str, tool_use_id: str, answer_text: str) -> bool:
    """
    Send a tool_result for an AskUserQuestion back to the agent.

    Builds a stream-json input with the tool_result content block and
    enqueues it via the same piggyback pattern as send_message.

    The answer is also stored as a Message so feed_transform can resolve
    the question as answered (tool_results index).
    """
    op_log = log.bind(agent_id=agent_id, tool_use_id=tool_use_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    parts = [{"type": "tool_result", "tool_use_id": tool_use_id, "content": answer_text}]

    # Store in Message model so feed_transform resolves the answer
    msg_record = await Message.objects.acreate(
        agent=agent,
        message_id=f"answer_{uuid.uuid4().hex[:16]}",
        session_id=agent.session_id or "",
        role="user",
        parts=parts,
        turn_number=0,
    )
    await broadcast_stream_message(agent, msg_record)

    # Enqueue for relay delivery
    input_msg = {
        "type": "user",
        "message": {
            "role": "user",
            "content": parts,
        },
    }
    agent = await _atomic_enqueue(agent_id, input_msg)
    await broadcast_agent_update(agent)

    op_log.info("question_answered")
    return True


async def broadcast_message(
    agent_ids: list[str], message: str, content: list | None = None,
) -> bool:
    """
    Send a message to one or more agents, producing a single consolidated
    feed item instead of N duplicates.

    Transport: N separate enqueues (one per agent) — each agent gets the
    message in its pending_input for relay delivery.

    Presentation: One user-message feed item via broadcast metadata in
    Message.parts — feed_transform deduplicates by broadcast_id.
    """
    from agents.services.lifecycle import hard_restart_agent

    if not agent_ids:
        return False

    broadcast_id = uuid.uuid4().hex[:16]
    op_log = log.bind(broadcast_id=broadcast_id, agent_count=len(agent_ids))

    # Build content parts
    if content:
        import copy
        parts = content
        text_summary = next(
            (b["text"] for b in parts if b.get("type") == "text"), message
        )
        api_parts = _normalize_content(copy.deepcopy(parts))
    else:
        parts = [{"type": "text", "text": message}]
        api_parts = parts
        text_summary = message

    # Resolve all agents in a single query
    agents: list[Agent] = [
        a async for a in Agent.objects.filter(id__in=agent_ids)
    ]
    found_ids = {str(a.id) for a in agents}
    for aid in agent_ids:
        if aid not in found_ids:
            op_log.warning("agent_not_found", agent_id=aid)

    if not agents:
        return False

    target_names = [a.name for a in agents]
    target_ids = [str(a.id) for a in agents]

    # Broadcast metadata — stored in Message.parts so feed_transform can
    # deduplicate. Stripped before relay delivery.
    broadcast_meta = {
        "type": "_broadcast",
        "broadcast_id": broadcast_id,
        "target_agent_ids": target_ids,
        "target_names": target_names,
    }
    parts_with_meta = [*parts, broadcast_meta]

    for agent in agents:
        # Auto-restart dead agents
        needs_restart = (
            agent.status in (AgentStatus.STOPPED, AgentStatus.ERROR)
            or (agent.status != AgentStatus.DEPLOYING and not agent.sandbox_id)
        )
        if needs_restart:
            op_log.info("auto_restarting_agent", agent_id=str(agent.id))
            agent = await hard_restart_agent(str(agent.id))

        # Store Message with broadcast metadata (for feed dedup)
        msg_record = await Message.objects.acreate(
            agent=agent,
            message_id=f"user_{broadcast_id}_{agent.id}",
            session_id=agent.session_id or "",
            role="user",
            parts=parts_with_meta,
            turn_number=0,
        )
        await broadcast_stream_message(agent, msg_record)

        # Enqueue for relay delivery (normalized parts, no broadcast metadata)
        input_msg = {
            "type": "user",
            "message": {"role": "user", "content": api_parts},
        }
        agent = await _atomic_enqueue(str(agent.id), input_msg)
        await broadcast_agent_update(agent)

    op_log.info("broadcast_sent", targets=target_names)
    return True


async def set_agent_mode(agent_id: str, mode: str) -> Agent:
    """
    Queue a permission mode change for an agent's Claude Code session.

    Mode switching works via soft restart: the relay SIGINTs Claude,
    then respawns with --resume <session_id> --permission-mode <mode>.
    The pending_mode field is delivered via piggyback.

    Valid modes: default, plan, acceptEdits, bypassPermissions, dontAsk

    See: docs/ARCHITECTURE.md, "Piggyback Pattern"
    """
    VALID_MODES = {"default", "plan", "acceptEdits", "bypassPermissions", "dontAsk"}
    op_log = log.bind(agent_id=agent_id, mode=mode)

    if mode not in VALID_MODES:
        raise ValueError(f"Invalid permission mode: {mode}. Must be one of: {', '.join(sorted(VALID_MODES))}")

    agent = await Agent.objects.aget(id=agent_id)

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("set_mode_skipped", status=agent.status)
        raise ValueError(f"Agent must be running or idle to change mode (current: {agent.status})")

    agent.pending_mode = mode
    await agent.asave(update_fields=["pending_mode"])

    await broadcast_agent_event(
        agent, "mode_change",
        {"mode": mode},
        summary=f"{agent.name} switching to {mode} mode",
    )
    op_log.info("mode_change_enqueued")
    return agent


async def interrupt_agent(agent_id: str) -> bool:
    """
    Queue a SIGINT signal for an agent's Claude Code session.

    Instead of tmux C-c, this sets agent.pending_signal = "SIGINT".
    The relay picks it up via the piggyback pattern in the next
    heartbeat or POST response.

    See: docs/ARCHITECTURE.md, "Piggyback Pattern"
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


async def restart_agent(agent_id: str) -> bool:
    """
    Queue a soft restart for an agent's Claude Code session.

    Sets agent.pending_signal = "restart". The relay picks it up via
    piggyback, sends SIGINT to Claude for graceful shutdown, then
    respawns with --resume to preserve conversation context.

    MCP servers re-init from the updated .mcp.json on restart,
    picking up any new secrets.

    See: docs/ARCHITECTURE.md, "Piggyback Pattern"
    """
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("restart_skipped", status=agent.status)
        return False

    agent.pending_signal = "restart"
    await agent.asave(update_fields=["pending_signal"])

    await broadcast_agent_event(agent, "restarting", {}, summary=f"{agent.name} restarting")
    op_log.info("restart_enqueued")
    return True


async def clear_agent_session(agent_id: str) -> bool:
    """
    Clear an agent's conversation history and restart fresh.

    Deletes session project data from the persistent volume, resets
    session tracking, and triggers a soft restart so the agent picks
    up fresh state. Maps to Claude Code's /clear command.
    """
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("clear_session_skipped", status=agent.status)
        return False

    # Clear session project data from volume
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

    # Clear session_id on model
    agent.session_id = ""
    await agent.asave(update_fields=["session_id"])

    # Use "clear" signal (not "restart") so the relay resets its in-memory
    # session_id and respawns Claude fresh instead of --resume.
    agent.pending_signal = "clear"
    await agent.asave(update_fields=["pending_signal"])

    await broadcast_agent_event(agent, "cleared", {}, summary=f"{agent.name} session cleared")
    op_log.info("session_cleared")
    return True
