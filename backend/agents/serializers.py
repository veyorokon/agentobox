"""Canonical serialization for Agent and TeamFeedItem.

Both GraphQL resolvers and WS consumers derive from these views.
This is the single source of truth for field computation — no transport
layer should duplicate task counting, lifecycle fetching, or adapter calls.

WS consumers add transport markers (_t, __typename) on top of these dicts.
GraphQL types delegate computed fields to shared helpers here.
"""

from asgiref.sync import sync_to_async
from decimal import Decimal

PREVIEW_READY_STATUSES = {"idle", "running", "waiting"}
PreviewState = str


# ---------------------------------------------------------------------------
# Shared query helpers — used by both WS serialize and GraphQL resolvers
# ---------------------------------------------------------------------------


def _count_task_progress_sync(agent_id) -> dict | None:
    from agents.models import AgentTask

    qs = AgentTask.objects.filter(agent_id=agent_id)
    total = qs.count()
    if not total:
        return None
    done = qs.filter(status="completed").count()
    return {"done": done, "total": total}


async def count_task_progress(agent_id) -> dict | None:
    return await sync_to_async(_count_task_progress_sync, thread_sensitive=False)(agent_id)


def _compute_agent_total_cost_sync(agent_id, session_cost_usd) -> float:
    """Sum the latest cumulative cost snapshot from each historical session.

    SessionResult.total_cost_usd is cumulative within a session, so the total
    lifetime agent cost is the sum of the latest value for each session_id.
    Fall back to the materialized current-session field when no history exists
    yet, which covers a just-started session before its first result event.
    """
    from agents.models import SessionResult

    rows = SessionResult.objects.filter(agent_id=agent_id).order_by(
        "session_id", "created_at", "id"
    ).values_list("session_id", "total_cost_usd")

    latest_by_session: dict[str, Decimal] = {}
    for session_id, total_cost_usd in rows:
        latest_by_session[session_id] = total_cost_usd or Decimal("0")

    if latest_by_session:
        return float(sum(latest_by_session.values(), Decimal("0")))
    return float(session_cost_usd or 0)


async def compute_agent_total_cost(agent_id, session_cost_usd) -> float:
    return await sync_to_async(
        _compute_agent_total_cost_sync, thread_sensitive=False
    )(agent_id, session_cost_usd)


def _fetch_tasks_sync(agent_id) -> list[dict]:
    from agents.models import AgentTask

    return list(
        AgentTask.objects.filter(agent_id=agent_id)
        .exclude(status="deleted")
        .order_by("created_at")
        .values(
            "task_id", "title", "description", "status",
            "assignee", "active_form", "blocked_by", "created_at", "updated_at",
        )
    )


async def fetch_tasks(agent_id) -> list[dict]:
    return await sync_to_async(_fetch_tasks_sync, thread_sensitive=False)(agent_id)


def _fetch_lifecycle_attempts_sync(agent_id) -> list[dict]:
    from agents.models import AgentLifecycleAttempt

    return list(
        AgentLifecycleAttempt.objects.filter(agent_id=agent_id)
        .order_by("-started_at")[:10]
        .values(
            "id", "kind", "status", "step", "attempt_no",
            "correlation_id", "error_code", "error_detail",
            "started_at", "finished_at",
        )
    )


async def fetch_lifecycle_attempts(agent_id) -> list[dict]:
    return await sync_to_async(_fetch_lifecycle_attempts_sync, thread_sensitive=False)(agent_id)


# ---------------------------------------------------------------------------
# Agent serialization — canonical view
# ---------------------------------------------------------------------------


def derive_preview_state(agent) -> PreviewState:
    """Collapse runtime/VNC-specific state into a frontend preview contract."""
    if agent.status == "deploying":
        return "deploying"
    if (
        agent.status in PREVIEW_READY_STATUSES
        and bool(agent.sandbox_id)
        and bool(agent.vnc_url)
    ):
        return "ready"
    if agent.status == "error":
        return "error"
    return "unavailable"


def derive_preview_runtime_id(agent) -> str:
    return str(agent.sandbox_id or "") if derive_preview_state(agent) == "ready" else ""


async def serialize_agent(agent) -> dict:
    """Canonical agent view — internal representation.

    Returns camelCase dict with all computed fields.
    Both GraphQL resolvers and WS consumers adapt from this.
    """
    from agents.adapters import get_adapter

    adapter = get_adapter(agent.agent_type)

    task_progress = await count_task_progress(agent.id)
    tasks_raw = await fetch_tasks(agent.id)
    attempts_raw = await fetch_lifecycle_attempts(agent.id)
    total_cost = await compute_agent_total_cost(agent.id, agent.session_cost_usd)

    tasks = [
        {
            "__typename": "AgentTaskType",
            "taskId": t["task_id"],
            "title": t["title"],
            "description": t["description"],
            "status": t["status"],
            "assignee": t["assignee"],
            "activeForm": t["active_form"],
            "blockedBy": t["blocked_by"],
            "createdAt": t["created_at"].isoformat(),
            "updatedAt": t["updated_at"].isoformat(),
        }
        for t in tasks_raw
    ]

    lifecycle_attempts = [
        {
            "__typename": "LifecycleAttemptType",
            "id": str(a["id"]),
            "kind": a["kind"],
            "status": a["status"],
            "step": a["step"],
            "attemptNo": a["attempt_no"],
            "correlationId": a["correlation_id"],
            "errorCode": a["error_code"],
            "errorDetail": a["error_detail"],
            "startedAt": a["started_at"].isoformat() if a["started_at"] else None,
            "finishedAt": a["finished_at"].isoformat() if a["finished_at"] else None,
        }
        for a in attempts_raw
    ]

    # MCP servers: dict → list of keys
    mcp = agent.mcp_servers
    if isinstance(mcp, dict):
        mcp_list = list(mcp.keys())
    elif isinstance(mcp, list):
        mcp_list = mcp
    else:
        mcp_list = []

    if task_progress:
        task_progress["__typename"] = "TaskProgressType"

    return {
        "__typename": "AgentType",
        "id": str(agent.id),
        "name": agent.name,
        "model": agent.model,
        "role": agent.role,
        "instructions": agent.instructions,
        "runtime": agent.runtime,
        "phase": agent.phase,
        "tags": agent.tags,
        "mode": agent.mode,
        "attentionLevel": agent.attention_level,
        "relayConnected": agent.relay_connected,
        "task": agent.task,
        "errorMessage": agent.error_message or "",
        "lifecycleStatus": agent.status,
        "previewState": derive_preview_state(agent),
        "previewRuntimeId": derive_preview_runtime_id(agent),
        "desiredStatus": agent.desired_status,
        "isConverged": agent.is_converged,
        "lastOutput": adapter.last_output(agent.latest_snapshot),
        "liveAction": adapter.live_action(agent.latest_snapshot) or None,
        "cost": total_cost,
        "duration": adapter.duration(agent.latest_snapshot),
        "turns": adapter.turns(agent.latest_snapshot),
        "allowedTools": agent.allowed_tools if isinstance(agent.allowed_tools, list) else [],
        "workspacePath": agent.workspace_path,
        "mcpServers": mcp_list,
        "triggers": agent.triggers if isinstance(agent.triggers, list) else [],
        "computeSeconds": agent.compute_seconds or 0,
        "taskProgress": task_progress,
        "tasks": tasks,
        "lifecycleAttempts": lifecycle_attempts,
    }


# ---------------------------------------------------------------------------
# Feed item serialization — canonical view
# ---------------------------------------------------------------------------


def serialize_feed_item(item) -> dict:
    """Canonical feed item view — internal representation.

    Returns camelCase dict matching TeamFeedItemType GraphQL shape.
    """
    questions = None
    if item.questions:
        questions = [
            {"__typename": "FeedQuestionType", "text": q.get("text", ""), "options": q.get("options", [])}
            for q in item.questions
        ]

    return {
        "__typename": "TeamFeedItemType",
        "id": str(item.id),
        "type": item.type,
        "agent": item.agent_name or None,
        "agentId": str(item.agent_record_id) if item.agent_record_id else None,
        "text": item.text or None,
        "command": item.command or None,
        "risk": item.risk or None,
        "permStatus": item.perm_status or None,
        "title": item.title or None,
        "plan": item.plan or None,
        "planStatus": item.plan_status or None,
        "summary": item.summary or None,
        "cost": float(item.cost) if item.cost is not None else None,
        "turns": item.turns,
        "duration": item.duration or None,
        "isError": item.is_error,
        "target": item.target or None,
        "question": item.question or None,
        "options": item.options if item.options else None,
        "questions": questions,
        "from": item.from_value or None,
        "to": item.to_value or None,
    }
