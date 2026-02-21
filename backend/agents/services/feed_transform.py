"""
Transform StreamEvents into typed feed items for the dashboard.

One module, pure functions, no side effects. Reads from StreamEvent only
(single table source — no heapmerge of Message + AgentEvent).

The core insight: StreamEvents are an append-only log where each event is
a raw stream-json dict. To reconstruct the "logical message" that the old
Message model used to provide, we GROUP events by message_id. Multiple
assistant events with the same message_id = one message with multiple parts.

Pipeline:
    Step 1: Build tool_result index from user events
    Step 2: Group assistant events by message_id → reconstruct parts arrays
    Step 3: Process each group into feed items (AGENT_TEXT, ACTIVITY, QUESTION, etc.)
    Step 4: Process standalone events (status, error, system, mode_change, etc.)
    Step 5: Sort all items by timestamp
    Step 6: Merge consecutive ACTIVITY items from the same agent
    Step 7: Collapse consecutive STATUS/SYSTEM runs
    Step 8: Inject point-in-time cumulative costs
    Step 9: Attach session results to TASK_END items
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import TYPE_CHECKING

from agents.graphql.types import (
    AgentQuestionType,
    FeedItemKind,
    FeedItemType,
    QuestionAnswerType,
    QuestionOptionType,
    ToolUseItemType,
)

if TYPE_CHECKING:
    from agents.models import SessionResult, StreamEvent


def stream_events_to_feed(
    events: list[StreamEvent],
    session_results: list[SessionResult],
) -> list[FeedItemType]:
    """Convert StreamEvents into sorted FeedItemType list.

    Single table source. No heapmerge. Events must arrive pre-sorted
    by created_at ascending (the DB query guarantees this).
    """

    # ── Step 1: Build tool_result index from user events ──
    # User events contain tool_results that we need to resolve when
    # processing assistant tool_use parts (for answer detection, error status).
    tool_results: dict[str, dict] = {}
    for evt in events:
        if evt.event_type != "user":
            continue
        msg_data = evt.data.get("message", {})
        for part in msg_data.get("content", []):
            if part.get("type") == "tool_result":
                tool_results[part["tool_use_id"]] = {
                    "content": part.get("content", ""),
                    "is_error": part.get("is_error", False),
                }

    # ── Step 2: Group assistant events by message_id ──
    # Multiple assistant events share an Anthropic message_id — each carries
    # one content part. Grouping reconstructs the full parts array.
    assistant_groups: dict[str, list[StreamEvent]] = defaultdict(list)
    user_events: list[StreamEvent] = []
    standalone_events: list[StreamEvent] = []

    for evt in events:
        if evt.event_type == "assistant" and evt.message_id:
            assistant_groups[evt.message_id].append(evt)
        elif evt.event_type == "user":
            user_events.append(evt)
        elif evt.event_type in ("status", "error", "mode_change", "interrupted",
                                 "restarting", "cleared", "system"):
            standalone_events.append(evt)
        # stream_event, result, etc. are stored but not rendered in feed
        # (they power the phase indicator and cost tracking, not feed items)

    # ── Step 3: Process user messages into feed items ──
    items: list[FeedItemType] = []
    seen_broadcasts: set[str] = set()
    for evt in user_events:
        _process_user_event(evt, items, seen_broadcasts)

    # ── Step 4: Process assistant message groups ──
    task_subjects: dict[str, tuple[str, str]] = {}  # tool_use_id → (subject, activeForm)
    for message_id, group in assistant_groups.items():
        _process_assistant_group(group, tool_results, items, task_subjects)

    # ── Step 5: Process standalone events ──
    for evt in standalone_events:
        _process_standalone_event(evt, items)

    # ── Step 6: Sort by timestamp ──
    items.sort(key=lambda x: x.timestamp)

    # ── Step 7: Merge consecutive ACTIVITY items from the same agent ──
    merged: list[FeedItemType] = []
    for item in items:
        if (
            item.kind == FeedItemKind.ACTIVITY
            and merged
            and merged[-1].kind == FeedItemKind.ACTIVITY
            and merged[-1].agent_id == item.agent_id
        ):
            merged[-1].tools = (merged[-1].tools or []) + (item.tools or [])
        else:
            merged.append(item)
    items = merged

    # Step 8: Collapse consecutive STATUS/SYSTEM runs from the same agent
    _COLLAPSIBLE = {FeedItemKind.STATUS, FeedItemKind.SYSTEM}
    collapsed: list[FeedItemType] = []
    for item in items:
        if (
            item.kind in _COLLAPSIBLE
            and collapsed
            and collapsed[-1].kind in _COLLAPSIBLE
            and collapsed[-1].agent_id == item.agent_id
        ):
            collapsed[-1] = item
        else:
            collapsed.append(item)
    items = collapsed

    # ── Step 9: Inject costs and session results ──
    _inject_costs(items, session_results)
    _attach_session_results(items, session_results)

    return items


# ── User event processing ──


def _process_user_event(
    evt: "StreamEvent", items: list[FeedItemType], seen_broadcasts: set[str],
) -> None:
    """Process a user-type StreamEvent into a feed item."""
    msg_data = evt.data.get("message", {})
    parts = msg_data.get("content", [])

    text_parts = []
    image_urls = []
    has_tool_result = False
    broadcast_meta = None
    for part in parts:
        ptype = part.get("type", "")
        if ptype == "tool_result":
            has_tool_result = True
        elif ptype == "text":
            text_parts.append(part.get("text", ""))
        elif ptype == "image":
            source = part.get("source", {})
            if source.get("type") == "url" and source.get("url"):
                image_urls.append(source["url"])
        elif ptype == "_broadcast":
            broadcast_meta = part

    if (text_parts or image_urls) and not has_tool_result:
        # Detect inter-agent team messages
        if evt.message_id and evt.message_id.startswith("team_"):
            raw_text = "\n".join(text_parts) if text_parts else ""
            sender_name, stripped_text = _parse_team_message(raw_text)
            items.append(FeedItemType(
                id=f"feed_{evt.id}",
                kind=FeedItemKind.TEAM_MESSAGE,
                agent_id=str(evt.agent_id),
                agent_name=evt.agent.name,
                timestamp=evt.created_at,
                text=stripped_text or raw_text,
                sender_name=sender_name,
            ))
            return

        # Broadcast dedup
        target_name = evt.agent.name
        target_agent_ids = None
        if broadcast_meta:
            bid = broadcast_meta.get("broadcast_id")
            if bid in seen_broadcasts:
                return
            seen_broadcasts.add(bid)
            target_names = broadcast_meta.get("target_names", [])
            target_agent_ids = broadcast_meta.get("target_agent_ids")
            target_name = ", ".join(target_names) if target_names else evt.agent.name

        items.append(FeedItemType(
            id=f"feed_{evt.id}",
            kind=FeedItemKind.USER_MESSAGE,
            agent_id=str(evt.agent_id),
            agent_name=evt.agent.name,
            timestamp=evt.created_at,
            text="\n".join(text_parts) if text_parts else None,
            image_urls=image_urls or None,
            target_name=target_name,
            target_agent_ids=target_agent_ids,
        ))


# ── Assistant event processing ──


def _process_assistant_group(
    group: list["StreamEvent"],
    tool_results: dict[str, dict],
    items: list[FeedItemType],
    task_subjects: dict[str, tuple[str, str]],
) -> None:
    """Process a group of assistant StreamEvents sharing one message_id.

    Reconstructs the parts array from individual events, then classifies
    just like the old _process_assistant_message did.
    """
    if not group:
        return

    # Use first event for metadata (agent, timestamps)
    first = group[0]
    last = group[-1]
    agent_id = str(first.agent_id)
    agent_name = first.agent.name
    ts = first.created_at

    # Reconstruct parts from all events in the group
    all_parts: list[dict] = []
    for evt in group:
        msg_data = evt.data.get("message", {})
        all_parts.extend(msg_data.get("content", []))

    # Separate text, image, and tool_use parts
    text_parts: list[str] = []
    image_urls: list[str] = []
    tool_uses: list[dict] = []

    for part in all_parts:
        ptype = part.get("type", "")
        if ptype == "text":
            text = part.get("text", "").strip()
            if text:
                text_parts.append(text)
        elif ptype == "image":
            source = part.get("source", {})
            if source.get("type") == "url" and source.get("url"):
                image_urls.append(source["url"])
        elif ptype == "tool_use":
            tool_uses.append(part)
        elif ptype == "thinking":
            # Thinking content — emit as AGENT_TEXT with a thinking marker
            thinking_text = part.get("thinking", "").strip()
            if thinking_text:
                text_parts.append(thinking_text)

    has_plan_tool = any(
        tu.get("name") in ("EnterPlanMode", "ExitPlanMode")
        for tu in tool_uses
    )

    # Use last event's ID for feed item IDs (ensures uniqueness)
    base_id = last.id

    if (text_parts or image_urls) and not has_plan_tool:
        items.append(FeedItemType(
            id=f"feed_{base_id}_text",
            kind=FeedItemKind.AGENT_TEXT,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=ts,
            text="\n\n".join(text_parts) if text_parts else None,
            image_urls=image_urls or None,
        ))

    # Classify tool_use parts
    activity_tools: list[ToolUseItemType] = []
    pending_plan_text = "\n\n".join(text_parts) if text_parts else None

    for tu in tool_uses:
        name = tu.get("name", "")
        tu_id = tu.get("id", "")
        tu_input = tu.get("input", {})
        result = tool_results.get(tu_id, {})

        if name == "AskUserQuestion":
            items.append(_make_question_item(
                base_id, tu_id, agent_id, agent_name, ts, tu_input, result,
            ))

        elif name == "EnterPlanMode":
            items.append(FeedItemType(
                id=f"feed_{base_id}_{tu_id}",
                kind=FeedItemKind.PLAN,
                agent_id=agent_id,
                agent_name=agent_name,
                timestamp=ts,
                plan_status="content",
                plan_summary=_extract_plan_summary(pending_plan_text),
                plan_steps=_extract_plan_steps(pending_plan_text),
            ))

        elif name == "ExitPlanMode":
            approved = not result.get("is_error", False)
            items.append(FeedItemType(
                id=f"feed_{base_id}_{tu_id}",
                kind=FeedItemKind.PLAN,
                agent_id=agent_id,
                agent_name=agent_name,
                timestamp=ts,
                plan_status="approved" if approved else "rejected",
                plan_summary=_extract_plan_summary(pending_plan_text),
            ))

        elif name == "TaskCreate":
            subject = tu_input.get("subject", "")
            active_form = tu_input.get("activeForm", "")
            task_subjects[tu_id] = (subject, active_form)
            items.append(FeedItemType(
                id=f"feed_{base_id}_{tu_id}",
                kind=FeedItemKind.TASK_START,
                agent_id=agent_id,
                agent_name=agent_name,
                timestamp=ts,
                task_divider_subject=subject,
                task_divider_id=tu_id,
                task_divider_active_form=active_form or subject,
            ))

        elif name == "TaskUpdate":
            if tu_input.get("status") == "completed":
                ref_id = tu_input.get("taskId", "")
                orig_subject, orig_active_form = task_subjects.get(ref_id, ("", ""))
                items.append(FeedItemType(
                    id=f"feed_{base_id}_{tu_id}",
                    kind=FeedItemKind.TASK_END,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    timestamp=ts,
                    task_divider_subject=orig_subject or tu_input.get("subject", ""),
                    task_divider_id=ref_id,
                    task_divider_active_form=orig_active_form,
                ))

        else:
            if name in ("Edit", "Write") and _is_claude_md(tu_input.get("file_path", "")):
                items.append(FeedItemType(
                    id=f"feed_{base_id}_{tu_id}",
                    kind=FeedItemKind.MEMORY,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    timestamp=ts,
                    memory_content=_extract_memory_content(name, tu_input),
                ))
            else:
                activity_tools.append(ToolUseItemType(
                    name=name,
                    input=tu_input,
                    result=result.get("content", ""),
                    is_error=result.get("is_error", False),
                ))

    if activity_tools:
        items.append(FeedItemType(
            id=f"feed_{base_id}_activity",
            kind=FeedItemKind.ACTIVITY,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=ts,
            tools=activity_tools,
        ))


# ── Standalone event processing ──


def _process_standalone_event(evt: "StreamEvent", items: list[FeedItemType]) -> None:
    """Convert a standalone StreamEvent into a feed item."""
    agent_id = str(evt.agent_id)
    agent_name = evt.agent.name
    data = evt.data or {}

    if evt.event_type == "status":
        to_status = data.get("to", "")
        if to_status in ("running", "idle"):
            return  # Suppress noise
        items.append(FeedItemType(
            id=f"feed_evt_{evt.id}",
            kind=FeedItemKind.STATUS,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=evt.created_at,
            from_status=data.get("from", ""),
            to_status=to_status,
        ))
    elif evt.event_type == "error":
        items.append(FeedItemType(
            id=f"feed_evt_{evt.id}",
            kind=FeedItemKind.ERROR,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=evt.created_at,
            error_text=data.get("text", "Error"),
        ))
    else:
        # mode_change, interrupted, restarting, cleared, system, etc.
        summary = data.get("summary", "") or evt.event_type
        if evt.event_type == "mode_change":
            summary = f"Switching to {data.get('mode', '')} mode"
        items.append(FeedItemType(
            id=f"feed_evt_{evt.id}",
            kind=FeedItemKind.SYSTEM,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=evt.created_at,
            text=summary,
        ))


# ── Cost injection ──


def _inject_costs(
    items: list[FeedItemType], session_results: list["SessionResult"]
) -> None:
    """Assign point-in-time cumulative cost to each feed item."""
    if not session_results:
        return

    all_srs = sorted(session_results, key=lambda sr: sr.created_at)
    latest_cost: dict[str, float] = {}
    sr_idx = 0

    for item in items:
        while sr_idx < len(all_srs) and all_srs[sr_idx].created_at <= item.timestamp:
            sr = all_srs[sr_idx]
            latest_cost[str(sr.agent_id)] = float(sr.total_cost_usd)
            sr_idx += 1
        if latest_cost:
            item.cumulative_cost_usd = round(sum(latest_cost.values()), 2)


def _attach_session_results(
    items: list[FeedItemType], session_results: list["SessionResult"],
) -> None:
    """Attach the latest SessionResult to TASK_END feed items."""
    if not session_results:
        return

    by_agent: dict[str, list["SessionResult"]] = {}
    for sr in session_results:
        aid = str(sr.agent_id)
        by_agent.setdefault(aid, []).append(sr)
    for srs in by_agent.values():
        srs.sort(key=lambda sr: sr.created_at, reverse=True)

    for item in items:
        if item.kind != FeedItemKind.TASK_END:
            continue
        agent_srs = by_agent.get(item.agent_id, [])
        for sr in agent_srs:
            if sr.created_at <= item.timestamp:
                item.session_result = sr  # type: ignore[assignment]
                break


# ── Helper functions ──


def _result_as_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "") for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def _is_claude_md(file_path: str) -> bool:
    return file_path.upper().endswith("CLAUDE.MD") if file_path else False


def _extract_memory_content(name: str, tu_input: dict) -> str:
    if name == "Write":
        return tu_input.get("content", "")
    return tu_input.get("new_string", "")


def _make_question_item(
    base_id: int,
    tu_id: str,
    agent_id: str,
    agent_name: str,
    ts,
    tu_input: dict,
    result: dict,
) -> FeedItemType:
    raw_questions = tu_input.get("questions", [])
    questions = [
        AgentQuestionType(
            question=q.get("question", ""),
            header=q.get("header", ""),
            options=[
                QuestionOptionType(
                    label=o.get("label", ""),
                    description=o.get("description", ""),
                )
                for o in q.get("options", [])
            ],
            multi_select=q.get("multiSelect", False),
        )
        for q in raw_questions
    ]

    answers = None
    if result and not result.get("is_error", False):
        answer_text = _result_as_text(result.get("content", ""))
        if answer_text:
            answers = _resolve_question_answers(raw_questions, answer_text)

    return FeedItemType(
        id=f"feed_{base_id}_{tu_id}",
        kind=FeedItemKind.QUESTION,
        agent_id=agent_id,
        agent_name=agent_name,
        timestamp=ts,
        questions=questions,
        answers=answers,
        tool_use_id=tu_id,
    )


def _resolve_question_answers(
    raw_questions: list[dict], answer_text: str,
) -> list[QuestionAnswerType | None]:
    answers: list[QuestionAnswerType | None] = []
    for q in raw_questions:
        options = q.get("options", [])
        option_labels = [o.get("label", "") for o in options]
        selected: list[int] = []
        for i, label in enumerate(option_labels):
            if label and label.lower() in answer_text.lower():
                selected.append(i)
        if selected:
            answers.append(QuestionAnswerType(selected_indices=selected))
        elif answer_text.strip():
            answers.append(QuestionAnswerType(
                selected_indices=[], other_text=answer_text.strip(),
            ))
        else:
            answers.append(None)
    return answers


def _extract_plan_summary(text: str | None) -> str | None:
    if not text:
        return None
    for line in text.split("\n"):
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped[:200]
    return None


def _extract_plan_steps(text: str | None) -> list[str] | None:
    if not text:
        return None
    steps = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped and (
            re.match(r"^\d+[.)]\s", stripped) or
            stripped.startswith("- ") or
            stripped.startswith("* ")
        ):
            if stripped[0].isdigit():
                step = re.sub(r"^\d+[.)]\s*", "", stripped)
            else:
                step = stripped[2:]
            if step:
                steps.append(step)
    return steps if steps else None


def _parse_team_message(text: str) -> tuple[str | None, str | None]:
    m = re.match(r"^\[Team message from ([^\]]+)\]:\s*", text)
    if m:
        return m.group(1), text[m.end():]
    return None, None
