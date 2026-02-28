"""
Process Claude Code stream-json events into the append-only StreamEvent log.

This is the write path. It is deliberately simple:

    1. Store the raw event verbatim as a StreamEvent row (INSERT, never UPDATE)
    2. Broadcast to dashboard subscribers
    3. Update materialized fields on the Agent model (status, phase, cost, etc.)

No upserts. No row locks. No content part accumulation. No dual-table routing.
The old write path had select_for_update() to accumulate parts on a Message row —
that complexity is gone. Each event from the relay is one INSERT.

Why store raw: the relay forwards ALL stream-json events without filtering.
Thinking content, tool progress, rate limits, content deltas — everything
Anthropic adds to stream-json is automatically captured. The data field is
the raw event dict, verbatim. We are an event log, not a relational model.

Intelligence lives in the read path (the frontend) which reconstructs
logical messages by grouping StreamEvents by message_id.
"""

import structlog
from asgiref.sync import sync_to_async

from agents.models import Agent, AgentStatus, SessionResult, StreamEvent
from agents.services.broadcast import broadcast_agent_update, broadcast_event
from agents.services.feed import create_feed_item, recompute_attention
from agents.services.media import externalize_image_block

log = structlog.get_logger("agents.stream")


def _externalize_media(parts: list[dict]) -> list[dict]:
    """Walk content parts, upload base64 images to S3, swap source to URL."""
    result = []
    for part in parts:
        if part.get("type") == "tool_result":
            content = part.get("content")
            if isinstance(content, list):
                part = {
                    **part,
                    "content": [externalize_image_block(block) for block in content],
                }
        elif part.get("type") == "image":
            part = externalize_image_block(part)
        result.append(part)
    return result


def _extract_message_id(event: dict) -> str:
    """Pull the stable message_id from an event, if present.

    assistant/user events carry it in event.message.id.
    Standalone events (system, result, stream_event) have no message_id.
    """
    msg = event.get("message")
    if isinstance(msg, dict):
        return msg.get("id", "")
    return ""


async def process_stream_event(agent: Agent, event: dict) -> None:
    """Every event from relay → INSERT StreamEvent + broadcast + side effects.

    This is the entire write path. One function. No routing, no branching
    by event type for storage — every event gets stored the same way.
    Side effects (agent model updates) are the only type-specific logic.

    The caller (RelayConsumer) caches the Agent instance for the lifetime
    of the WebSocket connection — no per-event DB fetch.
    """
    event_type = event.get("type", "")
    session_id = event.get("session_id", "")

    # Externalize base64 images in assistant/user events before storage
    # so we don't bloat the DB with inline image data.
    if event_type in ("assistant", "user"):
        msg_data = event.get("message", {})
        content = msg_data.get("content", [])
        if content:
            externalized = await sync_to_async(_externalize_media)(content)
            # Mutate the event dict — this is our copy, not the relay's
            event = {**event, "message": {**msg_data, "content": externalized}}

    # 1. Store verbatim — true event sourcing, no filtering, no transformation
    stream_event = await StreamEvent.objects.acreate(
        agent=agent,
        session_id=session_id,
        event_type=event_type,
        message_id=_extract_message_id(event),
        data=event,
    )

    # 2. Broadcast to dashboard subscribers
    await broadcast_event(agent, stream_event)

    # 3. Agent model side effects (materialized view updates)
    # These update denormalized fields on Agent for fast dashboard reads.
    # The StreamEvent log is the source of truth; these are just caches.
    #
    # The agent instance is cached on the consumer for the WS lifetime,
    # so refresh before reads that gate writes to avoid stale-state bugs.
    if event_type == "assistant":
        await agent.arefresh_from_db(fields=["status"])
        await _maybe_set_running(agent)
        await _update_assistant_fields(agent, event)
    elif event_type == "result":
        await _handle_result(agent, event, stream_event)
    elif event_type == "system":
        await agent.arefresh_from_db(
            fields=["capabilities", "session_id", "permission_mode", "status", "phase", "mode"]
        )
        await _handle_system(agent, event)
    elif event_type == "stream_event":
        await agent.arefresh_from_db(fields=["phase"])
        await _handle_phase(agent, event)


async def _maybe_set_running(agent: Agent) -> None:
    """Promote agent to RUNNING on first assistant event."""
    if agent.status != AgentStatus.RUNNING:
        agent.status = AgentStatus.RUNNING
        await agent.asave(update_fields=["status"])
        await broadcast_agent_update(agent)


async def _update_assistant_fields(agent: Agent, event: dict) -> None:
    """Update latest_snapshot with assistant event data."""
    snapshot = agent.latest_snapshot or {}
    snapshot["assistant"] = event
    snapshot.pop("result", None)  # new turn started, clear previous result
    agent.latest_snapshot = snapshot
    await agent.asave(update_fields=["latest_snapshot"])
    await broadcast_agent_update(agent)


async def _handle_result(agent: Agent, event: dict, stream_event: StreamEvent | None = None) -> None:
    """Insert SessionResult + update agent cost/status on turn completion."""
    session_id = event.get("session_id", "")
    if not session_id:
        return

    await SessionResult.objects.acreate(
        agent=agent,
        session_id=session_id,
        is_error=event.get("is_error", False),
        total_cost_usd=event.get("total_cost_usd", 0),
        duration_ms=event.get("duration_ms", 0),
        duration_api_ms=event.get("duration_api_ms", 0),
        num_turns=event.get("num_turns", 0),
        model_usage=event.get("modelUsage", {}),
        permission_denials=event.get("permission_denials", []),
    )

    # Update snapshot with result event
    snapshot = agent.latest_snapshot or {}
    snapshot["result"] = event
    agent.latest_snapshot = snapshot

    agent.session_cost_usd = event.get("total_cost_usd", 0)
    agent.status = AgentStatus.IDLE
    agent.phase = ""
    await agent.asave(update_fields=[
        "latest_snapshot", "session_cost_usd", "status", "phase",
    ])
    await broadcast_agent_update(agent)

    # Read last_output from snapshot via adapter (no DB refresh needed)
    from agents.adapters import get_adapter
    adapter = get_adapter(agent.agent_type)
    last_text = adapter.last_output(agent.latest_snapshot)

    # Create TeamFeedItem for the result
    is_error = event.get("is_error", False)
    item_type = "error" if is_error else "summary"
    duration_ms = event.get("duration_ms", 0)
    secs = duration_ms // 1000 if duration_ms else 0
    mins = secs // 60
    duration_str = f"{mins}m {secs % 60:02d}s" if mins else f"{secs}s"

    feed_kwargs = dict(
        type=item_type,
        agent_name=agent.name,
        agent_record=agent,
        cost=event.get("total_cost_usd", 0),
        turns=event.get("num_turns", 0),
        duration=duration_str,
        is_error=is_error,
    )
    if is_error:
        feed_kwargs["text"] = last_text or "Agent encountered an error"
    else:
        feed_kwargs["summary"] = last_text or "Turn completed"

    await create_feed_item(
        project_id=str(agent.project_id),
        source_event=stream_event,
        **feed_kwargs,
    )
    # Set review attention after turn completion (if no pending perm/plan)
    await recompute_attention(str(agent.project_id), str(agent.id), after_result=True)


async def _handle_system(agent: Agent, event: dict) -> None:
    """Update agent state from system events (init, status, process_exit)."""
    subtype = event.get("subtype", "")

    if subtype == "init":
        update_fields = []

        if not agent.capabilities:
            agent.capabilities = {
                "tools": event.get("tools", []),
                "mcp_servers": event.get("mcp_servers", []),
                "model": event.get("model", ""),
                "version": event.get("claude_code_version", ""),
            }
            update_fields.append("capabilities")

        session_id = event.get("session_id", "")
        if session_id and session_id != agent.session_id:
            agent.session_id = session_id
            update_fields.append("session_id")

        if update_fields:
            await agent.asave(update_fields=update_fields)
            await broadcast_agent_update(agent)

    elif subtype == "status":
        # Update permission mode from Claude's status event + reverse-map to frontend mode
        perm_mode = event.get("permissionMode", "")
        if perm_mode and perm_mode != agent.permission_mode:
            agent.permission_mode = perm_mode
            # Reverse-map Claude Code mode -> frontend mode via adapter
            from agents.adapters import get_adapter
            adapter = get_adapter(agent.agent_type)
            new_mode = adapter.wire_to_mode(perm_mode) or agent.mode
            update_fields = ["permission_mode"]
            if new_mode != agent.mode:
                agent.mode = new_mode
                update_fields.append("mode")
            await agent.asave(update_fields=update_fields)
            await broadcast_agent_update(agent)

    elif subtype == "process_exit":
        exit_code = event.get("exit_code", -1)
        agent.status = AgentStatus.STOPPED if exit_code == 0 else AgentStatus.ERROR
        agent.phase = ""
        await agent.asave(update_fields=["status", "phase"])
        await broadcast_agent_update(agent)
        log.info("stream_process_exit", agent_id=str(agent.id), exit_code=exit_code)


async def _handle_phase(agent: Agent, event: dict) -> None:
    """Extract phase transitions from stream_event envelopes.

    Phase values: thinking, responding, tool-input, tool-use.
    Only writes to DB on actual phase change to avoid spamming updates.
    """
    inner = event.get("event", {})
    inner_type = inner.get("type", "")

    new_phase = ""
    if inner_type == "content_block_start":
        block_type = inner.get("content_block", {}).get("type", "")
        if block_type in ("thinking", "redacted_thinking"):
            new_phase = "thinking"
        elif block_type == "text":
            new_phase = "responding"
        elif block_type in ("tool_use", "server_tool_use", "mcp_tool_use"):
            new_phase = "tool-input"
    elif inner_type == "message_stop":
        # Only transition to tool-use if we were in tool-input phase.
        # A pure text message ending (responding -> message_stop) should
        # not set tool-use phase.
        if agent.phase == "tool-input":
            new_phase = "tool-use"

    if new_phase and new_phase != agent.phase:
        agent.phase = new_phase
        await agent.asave(update_fields=["phase"])
        await broadcast_agent_update(agent)
