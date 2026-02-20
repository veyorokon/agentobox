"""
Process Claude Code stream-json events from the relay.

Routes each event type to the appropriate handler:
    system/init       -> upsert agent.capabilities
    system/process_exit -> update agent.status (stopped or error)
    assistant         -> upsert Message by message_id (APPEND parts)
    user              -> create Message for tool_result (idempotent by event uuid)
    result            -> upsert SessionResult (cumulative cost/usage)

CRITICAL: Assistant events carry 1 content part each. Parts are APPENDED
to the Message, not replaced. See the "Content Part Accumulation" comment
on docs/ISSUE-36-BACKEND.md.

See: docs/ARCHITECTURE.md, "Event Processing Logic"
See: docs/ARCHITECTURE.md, "Streaming Callbacks" (AppendContent pattern)
"""

import structlog
from asgiref.sync import sync_to_async
from django.db import transaction
from django.utils import timezone

from agents.models import Agent, AgentStatus, Message, SessionResult
from agents.services.broadcast import broadcast_agent_update, broadcast_stream_message
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


async def process_stream_events(agent: Agent, events: list[dict]) -> None:
    """
    Process a batch of Claude Code stream-json events from the relay.

    Events are the raw JSON objects from Claude's stdout, each with
    a `type` field: "system", "assistant", "user", or "result".

    See: docs/ARCHITECTURE.md, "Event Processing Logic"
    """
    for event in events:
        try:
            await _process_one(agent, event)
        except Exception:
            log.exception(
                "stream_event_processing_failed",
                agent_id=str(agent.id),
                event_type=event.get("type"),
            )


async def _process_one(agent: Agent, event: dict) -> None:
    """
    Route a single Claude Code stream-json event to the appropriate handler.

    Event types (from Claude Code stdout):
        system    -> init (capabilities), process_exit (relay synthetic)
        assistant -> upsert Message (text and/or tool_use content parts)
        user      -> create Message (tool_result content parts)
        result    -> upsert SessionResult (cumulative cost/usage)

    See: docs/ARCHITECTURE.md, "Event Processing Logic"
    See: docs/ARCHITECTURE.md, "Turn Lifecycle"
    """
    event_type = event.get("type", "")

    if event_type == "system":
        await _handle_system(agent, event)
    elif event_type == "assistant":
        await _handle_assistant(agent, event)
    elif event_type == "user":
        await _handle_user(agent, event)
    elif event_type == "result":
        await _handle_result(agent, event)
    elif event_type == "stream_event":
        await _handle_stream_event(agent, event)


async def _handle_system(agent: Agent, event: dict) -> None:
    """
    Handle system events: init (capabilities) and process_exit (relay synthetic).

    system/init:
        Upsert agent.capabilities from first init event per session.
        Fields: tools, mcp_servers, model, claude_code_version.

    system/process_exit:
        Update agent.status based on exit code.
        exit_code == 0 -> stopped (clean exit)
        exit_code != 0 -> error (crash)

    See: docs/ARCHITECTURE.md, "system/init", "system/process_exit"
    """
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

        # Update session_id from init event
        session_id = event.get("session_id", "")
        if session_id and session_id != agent.session_id:
            agent.session_id = session_id
            update_fields.append("session_id")

        # permissionMode is NOT read from system/init because --resume
        # can report a stale or default mode that overwrites the real
        # value set by set_agent_mode().  The authoritative source is:
        #   - set_agent_mode() -> writes permission_mode directly
        # system/status events are accepted only when no pending_mode
        # is in flight (see status handler below).

        if update_fields:
            await agent.asave(update_fields=update_fields)
            await broadcast_agent_update(agent)

    elif subtype == "status":
        # system/status events can carry permissionMode. However, during a
        # dashboard-initiated mode change, the dying Claude process may emit
        # a status event with the OLD permission mode, racing with the new
        # value set by set_agent_mode(). Guard: re-read the agent from DB
        # and only accept the status event's value if no pending_mode is
        # queued (meaning no dashboard-initiated change is in flight).
        perm_mode = event.get("permissionMode", "")
        if perm_mode and perm_mode != agent.permission_mode:
            fresh = await Agent.objects.aget(id=agent.id)
            if perm_mode != fresh.permission_mode and not fresh.pending_mode:
                agent.permission_mode = perm_mode
                await agent.asave(update_fields=["permission_mode"])
                await broadcast_agent_update(agent)

    elif subtype == "process_exit":
        exit_code = event.get("exit_code", -1)
        agent.status = AgentStatus.STOPPED if exit_code == 0 else AgentStatus.ERROR
        agent.phase = ""
        await agent.asave(update_fields=["status", "phase"])
        await broadcast_agent_update(agent)
        log.info(
            "process_exit",
            agent_id=str(agent.id),
            exit_code=exit_code,
        )


@sync_to_async(thread_sensitive=False)
def _atomic_upsert_parts(agent, message_id, defaults, new_parts, usage, stop_reason):
    """Append content parts to an assistant Message under a row lock.

    Prevents the read-modify-write race where concurrent batches both read
    the same parts list, append different new_parts, and one save clobbers
    the other's appended content.
    """
    with transaction.atomic():
        message, created = Message.objects.get_or_create(
            agent=agent,
            message_id=message_id,
            defaults=defaults,
        )
        # Re-fetch with lock — even on create, a concurrent batch may have
        # already appended parts between our get_or_create and this lock.
        message = Message.objects.select_for_update().get(id=message.id)
        message.parts = (message.parts or []) + new_parts
        if usage:
            message.usage = usage
        if stop_reason:
            message.stop_reason = stop_reason
        message.save(update_fields=["parts", "usage", "stop_reason", "updated_at"])
    return message


async def _handle_assistant(agent: Agent, event: dict) -> None:
    """
    Handle assistant events: upsert Message by message_id, APPEND content parts.

    CRITICAL: Claude sends each content block as a separate event with the
    same message_id (text first, then each tool_use individually). We must
    APPEND parts, not replace — same pattern Crush uses with
    AppendContent()/AddToolCall().

    Field mapping:
        message_id  <- event.message.id
        session_id  <- event.session_id
        role        <- "assistant"
        model       <- event.message.model
        parts       <- event.message.content[] (APPENDED)
        usage       <- event.message.usage (overwritten — latest is most complete)
        stop_reason <- event.message.stop_reason (overwritten when non-null)
        parent_tool_use_id <- event.parent_tool_use_id

    See: docs/ARCHITECTURE.md, "assistant event"
    See: docs/ARCHITECTURE.md, "Streaming Callbacks"
    """
    msg_data = event.get("message", {})
    message_id = msg_data.get("id", "")
    if not message_id:
        return

    new_parts = await sync_to_async(_externalize_media)(msg_data.get("content", []))
    usage = msg_data.get("usage")
    stop_reason = msg_data.get("stop_reason")

    # Atomic upsert — row lock prevents concurrent batches from clobbering
    # each other's appended parts (read-modify-write race on JSONField).
    message = await _atomic_upsert_parts(
        agent=agent,
        message_id=message_id,
        defaults={
            "session_id": event.get("session_id", ""),
            "role": "assistant",
            "model": msg_data.get("model", ""),
            "parts": [],
            "parent_tool_use_id": event.get("parent_tool_use_id") or "",
        },
        new_parts=new_parts,
        usage=usage,
        stop_reason=stop_reason,
    )

    # Update agent status to running
    if agent.status != AgentStatus.RUNNING:
        agent.status = AgentStatus.RUNNING
        await agent.asave(update_fields=["status"])
        await broadcast_agent_update(agent)

    await broadcast_stream_message(agent, message)


async def _handle_user(agent: Agent, event: dict) -> None:
    """
    Handle user events: create Message for tool_result.

    Each tool_result arrives as a separate event. Use the event's uuid
    as message_id (not tool_use_id) for idempotency on relay retry.
    get_or_create for safety.

    Field mapping:
        message_id  <- event.uuid (unique per event, idempotent on retry)
        session_id  <- event.session_id
        role        <- "user"
        parts       <- event.message.content[] (tool_result content parts)

    See: docs/ARCHITECTURE.md, "user event"
    """
    msg_data = event.get("message", {})
    content = await sync_to_async(_externalize_media)(msg_data.get("content", []))
    event_uuid = event.get("uuid", "")
    if not event_uuid:
        return

    message, created = await Message.objects.aget_or_create(
        agent=agent,
        message_id=event_uuid,
        defaults={
            "session_id": event.get("session_id", ""),
            "role": "user",
            "parts": content,
        },
    )

    if created:
        await broadcast_stream_message(agent, message)


async def _handle_result(agent: Agent, event: dict) -> None:
    """
    Handle result events: insert SessionResult per turn.

    `result` fires per-turn with cumulative totals. Each turn gets its
    own row so we have a full cost timeline for point-in-time display.

    Field mapping:
        is_error         <- event.is_error
        total_cost_usd   <- event.total_cost_usd (cumulative across turns)
        duration_ms      <- event.duration_ms (total wall time)
        duration_api_ms  <- event.duration_api_ms (API time only)
        num_turns        <- event.num_turns (conversation depth)
        model_usage      <- event.modelUsage (per-model cost/token breakdown)
        permission_denials <- event.permission_denials

    See: docs/ARCHITECTURE.md, "result event"
    """
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

    # Update agent's running session cost, clear phase, and mark idle (turn complete)
    agent.session_cost_usd = event.get("total_cost_usd", 0)
    agent.status = AgentStatus.IDLE
    agent.phase = ""
    await agent.asave(update_fields=["session_cost_usd", "status", "phase"])
    await broadcast_agent_update(agent)

    # Assign turn_number to messages from this session that don't have one yet
    num_turns = event.get("num_turns", 1)
    await Message.objects.filter(
        agent=agent, session_id=session_id, turn_number=0
    ).aupdate(turn_number=num_turns)


async def _handle_stream_event(agent: Agent, event: dict) -> None:
    """
    Extract phase transitions from stream_event envelopes.

    stream_event wraps Anthropic SSE events from --include-partial-messages.
    We only care about content_block_start (to detect thinking/responding/tool-input)
    and message_stop (to detect tool execution phase).

    Phase values:
        thinking   — content_block_start with type=thinking|redacted_thinking
        responding — content_block_start with type=text
        tool-input — content_block_start with type=tool_use|server_tool_use|mcp_tool_use
        tool-use   — message_stop (Claude finished, tools executing)

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
        new_phase = "tool-use"

    # Only write to DB on actual phase change
    if new_phase and new_phase != agent.phase:
        agent.phase = new_phase
        await agent.asave(update_fields=["phase"])
        await broadcast_agent_update(agent)
