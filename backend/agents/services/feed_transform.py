"""
Transform raw Messages + AgentEvents into typed feed items for the v2 dashboard.

One module, pure functions, no side effects. Converts the Anthropic-format
content parts stored in Message.parts into the display-oriented FeedItemType
the frontend expects.

Message.parts format (from stream.py):
    assistant: [{"type": "text", "text": "..."}, {"type": "tool_use", "id": "...", "name": "...", "input": {...}}]
    user:      [{"type": "tool_result", "tool_use_id": "...", "content": "..." | [...], "is_error": false}]

Tool input/result are passed through as-is — the frontend switches on tool name
and reads from input/result directly.
"""

from __future__ import annotations

import re
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
    from agents.models import AgentEvent, Message, SessionResult

# Tool names handled specially (not grouped into ACTIVITY)
_SPECIAL_TOOLS = {"AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "TaskCreate", "TaskUpdate"}


def messages_to_feed(
    messages: list[Message],
    events: list[AgentEvent],
    session_results: list[SessionResult],
) -> list[FeedItemType]:
    """Convert raw Messages + AgentEvents into sorted FeedItemType list."""

    # Step 1: Build tool_result index from user-role messages
    tool_results: dict[str, dict] = {}
    for msg in messages:
        if msg.role != "user":
            continue
        for part in msg.parts:
            if part.get("type") == "tool_result":
                tool_results[part["tool_use_id"]] = {
                    "content": part.get("content", ""),
                    "is_error": part.get("is_error", False),
                }

    # Step 2: Process assistant messages
    items: list[FeedItemType] = []
    task_subjects: dict[str, tuple[str, str]] = {}  # tool_use_id → (subject, activeForm)
    seen_broadcasts: set[str] = set()  # broadcast_id dedup
    for msg in messages:
        if msg.role == "user":
            # Check for user text messages (not tool results)
            _process_user_message(msg, items, seen_broadcasts)
        elif msg.role == "assistant":
            _process_assistant_message(msg, tool_results, items, task_subjects)

    # Step 3: Process AgentEvents
    for event in events:
        _process_event(event, items)

    # Step 4: Sort by timestamp (oldest first)
    items.sort(key=lambda x: x.timestamp)

    # Step 5: Merge consecutive ACTIVITY items from the same agent
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

    # Step 6: Collapse consecutive STATUS/SYSTEM runs from the same agent.
    # Keeps only the final item in each run, preserving ERROR items (they break
    # the run so errors are always visible).
    _COLLAPSIBLE = {FeedItemKind.STATUS, FeedItemKind.SYSTEM}
    collapsed: list[FeedItemType] = []
    for item in items:
        if (
            item.kind in _COLLAPSIBLE
            and collapsed
            and collapsed[-1].kind in _COLLAPSIBLE
            and collapsed[-1].agent_id == item.agent_id
        ):
            collapsed[-1] = item  # replace with the later one
        else:
            collapsed.append(item)
    items = collapsed

    # Step 7: Inject point-in-time cumulative costs from SessionResult timeline
    _inject_costs(items, session_results)

    return items


def _inject_costs(
    items: list[FeedItemType], session_results: list[SessionResult]
) -> None:
    """Assign point-in-time project-wide cumulative cost to each feed item.

    SessionResults are ordered by created_at (one per turn). For each feed
    item, find the latest SessionResult per agent at or before the item's
    timestamp, then sum across all agents for the project-wide total.

    Single-agent feeds produce the same result (one partition).
    """
    if not session_results:
        return

    # Merge all SRs into one timeline sorted by timestamp
    all_srs = sorted(session_results, key=lambda sr: sr.created_at)

    # Track latest cost per agent
    latest_cost: dict[str, float] = {}
    sr_idx = 0

    for item in items:
        # Advance SR pointer to latest at or before this item
        while sr_idx < len(all_srs) and all_srs[sr_idx].created_at <= item.timestamp:
            sr = all_srs[sr_idx]
            latest_cost[str(sr.agent_id)] = float(sr.total_cost_usd)
            sr_idx += 1

        # Project-wide cost = sum of all agents' latest costs
        if latest_cost:
            item.cumulative_cost_usd = round(sum(latest_cost.values()), 2)


def _process_user_message(
    msg: "Message", items: list[FeedItemType], seen_broadcasts: set[str],
) -> None:
    """Extract user text messages (SendMessage input, not tool_results).

    Handles broadcast deduplication: messages with a _broadcast metadata part
    share a broadcast_id. Only the first message in a group emits a feed item;
    subsequent duplicates are skipped. The surviving item carries target_agent_ids
    so the frontend can include it in per-agent filtered views.
    """
    text_parts = []
    image_urls = []
    has_tool_result = False
    broadcast_meta = None
    for part in msg.parts:
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

    # If there are text/image parts and no tool results, it's a user message
    if (text_parts or image_urls) and not has_tool_result:
        # Detect inter-agent team messages (message_id starts with "team_")
        if msg.message_id and msg.message_id.startswith("team_"):
            raw_text = "\n".join(text_parts) if text_parts else ""
            sender_name, stripped_text = _parse_team_message(raw_text)
            items.append(FeedItemType(
                id=f"feed_{msg.id}",
                kind=FeedItemKind.TEAM_MESSAGE,
                agent_id=str(msg.agent_id),
                agent_name=msg.agent.name,
                timestamp=msg.created_at,
                text=stripped_text or raw_text,
                sender_name=sender_name,
            ))
            return

        # Broadcast dedup: skip duplicates, enrich the first with target info
        target_name = msg.agent.name
        target_agent_ids = None
        if broadcast_meta:
            bid = broadcast_meta.get("broadcast_id")
            if bid in seen_broadcasts:
                return  # Already emitted for this broadcast group
            seen_broadcasts.add(bid)
            target_names = broadcast_meta.get("target_names", [])
            target_agent_ids = broadcast_meta.get("target_agent_ids")
            target_name = ", ".join(target_names) if target_names else msg.agent.name

        items.append(FeedItemType(
            id=f"feed_{msg.id}",
            kind=FeedItemKind.USER_MESSAGE,
            agent_id=str(msg.agent_id),
            agent_name=msg.agent.name,
            timestamp=msg.created_at,
            text="\n".join(text_parts) if text_parts else None,
            image_urls=image_urls or None,
            target_name=target_name,
            target_agent_ids=target_agent_ids,
        ))


def _process_assistant_message(
    msg: "Message",
    tool_results: dict[str, dict],
    items: list[FeedItemType],
    task_subjects: dict[str, tuple[str, str]],
) -> None:
    """Process one assistant Message into one or more FeedItems."""
    agent_id = str(msg.agent_id)
    agent_name = msg.agent.name
    ts = msg.created_at

    # Separate text, image, and tool_use parts
    text_parts: list[str] = []
    image_urls: list[str] = []
    tool_uses: list[dict] = []

    for part in msg.parts:
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

    # Check if this message contains plan-related tools
    has_plan_tool = any(
        tu.get("name") in ("EnterPlanMode", "ExitPlanMode")
        for tu in tool_uses
    )

    # Emit AGENT_TEXT item for text content (unless message has plan tools —
    # the plan text is captured in the PLAN item instead)
    if (text_parts or image_urls) and not has_plan_tool:
        items.append(FeedItemType(
            id=f"feed_{msg.id}_text",
            kind=FeedItemKind.AGENT_TEXT,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=ts,
            text="\n\n".join(text_parts) if text_parts else None,
            image_urls=image_urls or None,
        ))

    # Classify and emit tool_use items
    activity_tools: list[ToolUseItemType] = []
    pending_plan_text = "\n\n".join(text_parts) if text_parts else None

    for tu in tool_uses:
        name = tu.get("name", "")
        tu_id = tu.get("id", "")
        tu_input = tu.get("input", {})
        result = tool_results.get(tu_id, {})

        if name == "AskUserQuestion":
            items.append(_make_question_item(
                msg.id, tu_id, agent_id, agent_name, ts, tu_input, result,
            ))

        elif name == "EnterPlanMode":
            items.append(FeedItemType(
                id=f"feed_{msg.id}_{tu_id}",
                kind=FeedItemKind.PLAN,
                agent_id=agent_id,
                agent_name=agent_name,
                timestamp=ts,
                plan_status="content",
                plan_summary=_extract_plan_summary(pending_plan_text),
                plan_steps=_extract_plan_steps(pending_plan_text),
            ))

        elif name == "ExitPlanMode":
            # Determine approval from tool_result
            approved = not result.get("is_error", False)
            items.append(FeedItemType(
                id=f"feed_{msg.id}_{tu_id}",
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
                id=f"feed_{msg.id}_{tu_id}",
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
                    id=f"feed_{msg.id}_{tu_id}",
                    kind=FeedItemKind.TASK_END,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    timestamp=ts,
                    task_divider_subject=orig_subject or tu_input.get("subject", ""),
                    task_divider_id=ref_id,
                    task_divider_active_form=orig_active_form,
                ))

        else:
            # All other tools (Read, Edit, Write, Bash, Grep, Glob, MCP tools, etc.)
            # Check for memory (Edit/Write targeting CLAUDE.md)
            if name in ("Edit", "Write") and _is_claude_md(tu_input.get("file_path", "")):
                items.append(FeedItemType(
                    id=f"feed_{msg.id}_{tu_id}",
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

    # Group activity tools into a single ACTIVITY item
    if activity_tools:
        items.append(FeedItemType(
            id=f"feed_{msg.id}_activity",
            kind=FeedItemKind.ACTIVITY,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=ts,
            tools=activity_tools,
        ))


def _process_event(event: "AgentEvent", items: list[FeedItemType]) -> None:
    """Convert an AgentEvent into a FeedItem."""
    agent_id = str(event.agent_id)
    agent_name = event.agent.name

    if event.event_type == "status":
        data = event.data or {}
        to_status = data.get("to", "")
        # Suppress running/idle — they bookend every response and are noise.
        # Only deploying, error, stopped are actionable.
        if to_status in ("running", "idle"):
            return
        items.append(FeedItemType(
            id=f"feed_evt_{event.id}",
            kind=FeedItemKind.STATUS,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=event.created_at,
            from_status=data.get("from", ""),
            to_status=to_status,
        ))
    elif event.event_type == "error":
        data = event.data or {}
        items.append(FeedItemType(
            id=f"feed_evt_{event.id}",
            kind=FeedItemKind.ERROR,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=event.created_at,
            error_text=data.get("text", event.summary or "Error"),
        ))
    elif event.event_type == "task":
        data = event.data or {}
        items.append(FeedItemType(
            id=f"feed_evt_{event.id}",
            kind=FeedItemKind.TASK,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=event.created_at,
            task_summary=data.get("summary", event.summary or ""),
        ))
    else:
        items.append(FeedItemType(
            id=f"feed_evt_{event.id}",
            kind=FeedItemKind.SYSTEM,
            agent_id=agent_id,
            agent_name=agent_name,
            timestamp=event.created_at,
            text=event.summary or event.event_type,
        ))


def _result_as_text(content) -> str:
    """Extract text from result content (string or ContentBlock list)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "") for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def _is_claude_md(file_path: str) -> bool:
    """Check if a file path targets a CLAUDE.md file."""
    return file_path.upper().endswith("CLAUDE.MD") if file_path else False


def _extract_memory_content(name: str, tu_input: dict) -> str:
    """Extract the added content for a memory (CLAUDE.md edit)."""
    if name == "Write":
        return tu_input.get("content", "")
    # Edit: new_string is what was added
    return tu_input.get("new_string", "")


def _make_question_item(
    msg_id: int,
    tu_id: str,
    agent_id: str,
    agent_name: str,
    ts,
    tu_input: dict,
    result: dict,
) -> FeedItemType:
    """Build a QUESTION FeedItem from AskUserQuestion input."""
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

    # Detect answered questions from tool_result
    answers = None
    if result and not result.get("is_error", False):
        answer_text = _result_as_text(result.get("content", ""))
        if answer_text:
            answers = _resolve_question_answers(raw_questions, answer_text)

    return FeedItemType(
        id=f"feed_{msg_id}_{tu_id}",
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
    """Match answer_text against question options to build QuestionAnswerType list.

    Claude Code's AskUserQuestion returns the selected option label(s) as the
    tool_result content. For single questions, it's just the label text.
    For multi-question forms, answers are JSON or newline-separated.
    """
    answers: list[QuestionAnswerType | None] = []
    # Simple case: single question — answer_text is the label
    for q in raw_questions:
        options = q.get("options", [])
        option_labels = [o.get("label", "") for o in options]
        # Try to find which option was selected
        selected: list[int] = []
        other_text: str | None = None
        for i, label in enumerate(option_labels):
            if label and label.lower() in answer_text.lower():
                selected.append(i)
        if selected:
            answers.append(QuestionAnswerType(
                selected_indices=selected,
            ))
        elif answer_text.strip():
            # No option matched — treat as "Other"
            answers.append(QuestionAnswerType(
                selected_indices=[],
                other_text=answer_text.strip(),
            ))
        else:
            answers.append(None)
    return answers


def _extract_plan_summary(text: str | None) -> str | None:
    """Extract a one-line summary from plan text (first non-empty line)."""
    if not text:
        return None
    for line in text.split("\n"):
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped[:200]
    return None


def _extract_plan_steps(text: str | None) -> list[str] | None:
    """Extract numbered/bulleted steps from plan text."""
    if not text:
        return None
    steps = []
    for line in text.split("\n"):
        stripped = line.strip()
        # Match "1. ...", "- ...", "* ..."
        if stripped and (
            re.match(r"^\d+[.)]\s", stripped) or
            stripped.startswith("- ") or
            stripped.startswith("* ")
        ):
            # Remove the bullet/number prefix
            if stripped[0].isdigit():
                step = re.sub(r"^\d+[.)]\s*", "", stripped)
            else:
                step = stripped[2:]
            if step:
                steps.append(step)
    return steps if steps else None


def _parse_team_message(text: str) -> tuple[str | None, str | None]:
    """Parse sender name and content from a team message.

    Format: ``[Team message from sender_name]: actual content``
    Returns (sender_name, content) or (None, None) if no match.
    """
    m = re.match(r"^\[Team message from ([^\]]+)\]:\s*", text)
    if m:
        return m.group(1), text[m.end():]
    return None, None
