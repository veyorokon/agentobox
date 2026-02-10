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

See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Event Processing Logic"
See: docs/CRUSH-ARCHITECTURE.md, "Streaming Callbacks" (AppendContent pattern)
"""

import structlog
from asgiref.sync import sync_to_async
from django.utils import timezone

from agents.models import Agent, AgentStatus, Message, SessionResult
from agents.services.broadcast import broadcast_agent_update, broadcast_stream_message

log = structlog.get_logger("agents.stream")


def _normalize_parts(parts: list[dict]) -> list[dict]:
    """Normalize content parts to canonical format before storage.

    Anthropic API allows tool_result.content to be either a string or an array
    of content blocks. We normalize to always store it as a string so downstream
    consumers (frontend, extractMessageItems) can trust the shape.
    """
    for part in parts:
        if part.get("type") == "tool_result":
            content = part.get("content")
            if isinstance(content, list):
                part["content"] = "\n".join(
                    block.get("text", "") for block in content if isinstance(block, dict)
                )
    return parts


async def process_stream_events(agent: Agent, events: list[dict]) -> None:
    """
    Process a batch of Claude Code stream-json events from the relay.

    Events are the raw JSON objects from Claude's stdout, each with
    a `type` field: "system", "assistant", "user", or "result".

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Event Processing Logic"
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

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Event Processing Logic"
    See: docs/CLAUDE-CODE-MESSAGE-PIPELINE.md, "Turn Lifecycle"
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

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "system/init", "system/process_exit"
    """
    subtype = event.get("subtype", "")

    if subtype == "init":
        if not agent.capabilities:
            agent.capabilities = {
                "tools": event.get("tools", []),
                "mcp_servers": event.get("mcp_servers", []),
                "model": event.get("model", ""),
                "version": event.get("claude_code_version", ""),
            }
            await agent.asave(update_fields=["capabilities"])
            await broadcast_agent_update(agent)

        # Update session_id from init event
        session_id = event.get("session_id", "")
        if session_id and session_id != agent.session_id:
            agent.session_id = session_id
            await agent.asave(update_fields=["session_id"])

    elif subtype == "process_exit":
        exit_code = event.get("exit_code", -1)
        agent.status = AgentStatus.STOPPED if exit_code == 0 else AgentStatus.ERROR
        await agent.asave(update_fields=["status"])
        await broadcast_agent_update(agent)
        log.info(
            "process_exit",
            agent_id=str(agent.id),
            exit_code=exit_code,
        )


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

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "assistant event"
    See: docs/CRUSH-ARCHITECTURE.md, "Streaming Callbacks"
    """
    msg_data = event.get("message", {})
    message_id = msg_data.get("id", "")
    if not message_id:
        return

    message, created = await Message.objects.aget_or_create(
        agent=agent,
        message_id=message_id,
        defaults={
            "session_id": event.get("session_id", ""),
            "role": "assistant",
            "model": msg_data.get("model", ""),
            "parts": [],
            "parent_tool_use_id": event.get("parent_tool_use_id") or "",
        },
    )

    # APPEND new content parts — never replace
    new_parts = _normalize_parts(msg_data.get("content", []))
    message.parts = message.parts + new_parts
    message.usage = msg_data.get("usage") or message.usage
    message.stop_reason = msg_data.get("stop_reason") or message.stop_reason
    await message.asave(update_fields=["parts", "usage", "stop_reason", "updated_at"])

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

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "user event"
    """
    msg_data = event.get("message", {})
    content = _normalize_parts(msg_data.get("content", []))
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
    Handle result events: upsert SessionResult with cumulative cost/usage.

    `result` fires per-turn with cumulative totals, so we upsert by
    (agent, session_id) — always one row per session with latest values.

    Field mapping:
        is_error         <- event.is_error
        total_cost_usd   <- event.total_cost_usd (cumulative across turns)
        duration_ms      <- event.duration_ms (total wall time)
        duration_api_ms  <- event.duration_api_ms (API time only)
        num_turns        <- event.num_turns (conversation depth)
        model_usage      <- event.modelUsage (per-model cost/token breakdown)
        permission_denials <- event.permission_denials

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "result event"
    """
    session_id = event.get("session_id", "")
    if not session_id:
        return

    await SessionResult.objects.aupdate_or_create(
        agent=agent,
        session_id=session_id,
        defaults={
            "is_error": event.get("is_error", False),
            "total_cost_usd": event.get("total_cost_usd", 0),
            "duration_ms": event.get("duration_ms", 0),
            "duration_api_ms": event.get("duration_api_ms", 0),
            "num_turns": event.get("num_turns", 0),
            "model_usage": event.get("modelUsage", {}),
            "permission_denials": event.get("permission_denials", []),
        },
    )

    # Update agent's running session cost and mark idle (turn complete)
    agent.session_cost_usd = event.get("total_cost_usd", 0)
    agent.status = AgentStatus.IDLE
    await agent.asave(update_fields=["session_cost_usd", "status"])
    await broadcast_agent_update(agent)

    # Assign turn_number to messages from this session that don't have one yet
    num_turns = event.get("num_turns", 1)
    await Message.objects.filter(
        agent=agent, session_id=session_id, turn_number=0
    ).aupdate(turn_number=num_turns)
