"""
MCP Coordination Server for agent-to-agent communication.

Tool names and parameter shapes align with Claude Code's native team tools
(SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList). Transport differs
(MCP HTTP → backend routing instead of filesystem), but the interface is
identical so models trained on CC's native schemas work out of the box.

Auth: Each tool call authenticates by extracting the Bearer token from
the Authorization header and looking up the Agent by relay_token.

See: docs/ARCHITECTURE.md, "MCP Coordination Server"
"""

import uuid

import structlog
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers

log = structlog.get_logger("abox.mcp")

mcp = FastMCP("team")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def _authenticate():
    """Authenticate the calling agent via Bearer token in HTTP headers.

    Returns the Agent ORM object. Raises ToolError on auth failure.
    """
    from agents.services.auth_relay import get_relay_agent

    # IMPORTANT: include={"authorization"} is required because get_http_headers()
    # excludes the authorization header by default to prevent accidental forwarding.
    # We explicitly need it for agent authentication.
    headers = get_http_headers(include={"authorization"}) or {}
    auth_header = headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise ToolError("Missing or invalid Authorization header")

    token = auth_header[7:]
    try:
        return await get_relay_agent(token)
    except ValueError as e:
        raise ToolError(str(e))


# ---------------------------------------------------------------------------
# Messaging — matches CC's SendMessage tool
# ---------------------------------------------------------------------------

async def deliver_message(agent, *, type: str, content: str = "", recipient: str = "", summary: str = "") -> dict:
    """Core send_message logic. Called by MCP tool and hook bridge."""
    from agents.models import Agent, AgentStatus

    if type == "message":
        if not recipient:
            raise ToolError("recipient is required for type='message'")
        try:
            target = await Agent.objects.aget(
                project_id=agent.project_id, name=recipient,
            )
        except Agent.DoesNotExist:
            raise ToolError(f"Teammate '{recipient}' not found")

        from agents.services.interagent import deliver_to_stdin
        sent = await deliver_to_stdin(agent.name, target, content)

        # Create feed item so the team feed shows inter-agent messages
        try:
            from agents.services.feed import create_feed_item
            await create_feed_item(
                project_id=str(agent.project_id),
                agent_record=agent,
                type="agent-message",
                agent_name=agent.name,
                from_value=agent.name,
                to_value=recipient,
                text=content[:500],
            )
        except Exception:  # intentional: feed is secondary — message delivery already succeeded
            log.warning("mcp.message_feed_item_failed", sender=agent.name, recipient=recipient, exc_info=True)

        log.info("mcp.message_sent", sender=agent.name, recipient=recipient, delivered=sent)
        if not sent:
            return {"ok": True, "recipient": recipient, "queued": True,
                    "note": f"'{recipient}' is disconnected. Message queued for delivery on reconnect."}
        return {"ok": True, "recipient": recipient}

    elif type == "broadcast":
        from agents.services.interagent import deliver_broadcast
        await deliver_broadcast(agent, content, summary=summary)

        # Create feed item for the broadcast
        try:
            from agents.services.feed import create_feed_item
            await create_feed_item(
                project_id=str(agent.project_id),
                agent_record=agent,
                type="agent-message",
                agent_name=agent.name,
                from_value=agent.name,
                to_value="all",
                text=content[:500],
            )
        except Exception:  # intentional: feed is secondary — broadcast delivery already succeeded
            log.warning("mcp.broadcast_feed_item_failed", sender=agent.name, exc_info=True)

        log.info("mcp.broadcast_sent", sender=agent.name)
        return {"ok": True}

    elif type == "shutdown_request":
        if not recipient:
            raise ToolError("recipient is required for type='shutdown_request'")
        try:
            target = await Agent.objects.aget(
                project_id=agent.project_id, name=recipient,
            )
        except Agent.DoesNotExist:
            raise ToolError(f"Teammate '{recipient}' not found")

        # Actually kill the container — same path as the killAgent mutation.
        # The team-lead's authority is sufficient; no approval needed.
        from agents.services.lifecycle import kill_agent
        await kill_agent(str(target.id))

        log.info("mcp.shutdown_requested", sender=agent.name, target=recipient)
        return {"ok": True, "recipient": recipient}

    else:
        raise ToolError(f"Invalid message type: {type}. Must be 'message', 'broadcast', or 'shutdown_request'.")


@mcp.tool
async def send_message(
    type: str,
    content: str = "",
    recipient: str = "",
    summary: str = "",
) -> dict:
    """Send messages to agent teammates.

    Args:
        type: Message type — "message" for DMs, "broadcast" to all teammates,
              "shutdown_request" to request a teammate shut down.
        content: The message text.
        recipient: Agent name of the recipient (required for "message" and
                   "shutdown_request").
        summary: A 5-10 word summary shown as preview in the UI.
    """
    agent = await _authenticate()
    return await deliver_message(agent, type=type, content=content, recipient=recipient, summary=summary)


# ---------------------------------------------------------------------------
# Spawning — agentobox extra (CC uses Task tool for spawning)
# ---------------------------------------------------------------------------

@mcp.tool
async def teammate_spawn(name: str, instructions: str, model: str = "") -> dict:
    """Create a new teammate agent in the same project.

    Args:
        name: Role name for the new agent (e.g. "qa", "devops").
        instructions: Responsibilities and initial task for the agent.
        model: Optional model override. Defaults to your model.
    """
    agent = await _authenticate()
    from agents.services.lifecycle import create_agent

    try:
        new_agent = await create_agent(
            project_id=str(agent.project_id),
            name=name,
            runtime_name=agent.runtime,
            model=model or agent.model,
            workspace_path=agent.workspace_path,
            instructions=instructions,
            role="worker",
            volume_mounts=agent.volume_mounts,
        )
    except ValueError as e:
        raise ToolError(str(e))

    log.info("mcp.teammate_spawned", spawner=agent.name, new_agent=name)
    return {"ok": True, "agent_id": str(new_agent.id), "name": new_agent.name}


# ---------------------------------------------------------------------------
# Task tools — matches CC's TaskCreate/TaskUpdate/TaskGet/TaskList
# ---------------------------------------------------------------------------

async def create_task(agent, *, title: str, description: str = "", active_form: str = "", metadata: dict | None = None, assignee: str | None = None) -> dict:
    """Core task_create logic. Called by MCP tool and hook bridge.

    Args:
        assignee: Agent name to assign. None = auto-assign to creator.
               Empty string = leave unassigned.
    """
    from agents.models import AgentTask

    task = await AgentTask.objects.acreate(
        agent=agent,
        project_id=agent.project_id,
        task_id=uuid.uuid4().hex[:16],
        title=title[:500],
        description=description,
        active_form=active_form,
        metadata=metadata or {},
        assignee=agent.name if assignee is None else assignee,
        status="pending",
    )

    # Secondary: feed item + broadcast. Must not fail the tool call.
    try:
        from agents.services.feed import create_feed_item
        await create_feed_item(
            project_id=str(agent.project_id),
            agent_record=agent,
            type="task",
            agent_name=agent.name,
            text=title[:200],
            from_value="",
            to_value="pending",
        )
        from agents.services.broadcast import broadcast_agent_update
        await broadcast_agent_update(agent)
    except Exception:  # intentional: feed/broadcast is secondary — task creation already succeeded
        log.warning("mcp.task_create_broadcast_failed", agent_name=agent.name, exc_info=True)

    log.info("mcp.task_created", agent_name=agent.name, title=title[:80])
    return {"task_id": task.task_id, "title": task.title}


@mcp.tool
async def task_create(
    title: str,
    description: str = "",
    active_form: str = "",
    metadata: dict | None = None,
) -> dict:
    """Create a new task for the team.

    Args:
        title: Brief task title in imperative form (e.g. "Fix auth bug").
        description: Detailed description of what needs to be done.
        active_form: Present continuous form shown in spinner when in_progress
                     (e.g. "Fixing auth bug").
        metadata: Arbitrary metadata to attach to the task.
    """
    agent = await _authenticate()
    return await create_task(agent, title=title, description=description, active_form=active_form, metadata=metadata)


async def update_task(
    agent,
    *,
    task_id: str,
    status: str = "",
    title: str = "",
    description: str = "",
    assignee: str = "",
    active_form: str = "",
    add_blocks: list[str] | None = None,
    add_blocked_by: list[str] | None = None,
    metadata: dict | None = None,
) -> dict:
    """Core task_update logic. Called by MCP tool and hook bridge."""
    from agents.models import AgentTask

    try:
        task = await AgentTask.objects.aget(
            project_id=agent.project_id, task_id=task_id,
        )
    except AgentTask.DoesNotExist:
        raise ToolError(f"Task '{task_id}' not found")

    update_fields = []
    old_status = task.status

    if status:
        if status == "deleted":
            await task.adelete()
            try:
                from agents.services.broadcast import broadcast_agent_update
                await broadcast_agent_update(agent)
            except Exception:  # intentional: broadcast is secondary — task deletion already committed
                log.warning("mcp.task_delete_broadcast_failed", agent_name=agent.name, exc_info=True)
            log.info("mcp.task_deleted", agent_name=agent.name, task_id=task_id)
            return {"ok": True, "deleted": True}
        task.status = status
        update_fields.append("status")

    if title:
        task.title = title[:500]
        update_fields.append("title")

    if description:
        task.description = description
        update_fields.append("description")

    if assignee:
        task.assignee = assignee
        update_fields.append("assignee")

    if active_form:
        task.active_form = active_form
        update_fields.append("active_form")

    if add_blocks:
        existing = task.blocks or []
        task.blocks = list(set(existing + add_blocks))
        update_fields.append("blocks")

    if add_blocked_by:
        existing = task.blocked_by or []
        task.blocked_by = list(set(existing + add_blocked_by))
        update_fields.append("blocked_by")

    if metadata is not None:
        merged = task.metadata or {}
        for k, v in metadata.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        task.metadata = merged
        update_fields.append("metadata")

    if update_fields:
        await task.asave(update_fields=update_fields)

    # Secondary: feed item + broadcast. Must not fail the tool call.
    try:
        if "status" in update_fields and task.status != old_status:
            from agents.services.feed import create_feed_item
            await create_feed_item(
                project_id=str(agent.project_id),
                agent_record=agent,
                type="task",
                agent_name=agent.name,
                text=task.title[:200],
                from_value=old_status,
                to_value=task.status,
                target=task.assignee or "",
            )

        if "status" in update_fields or "assignee" in update_fields:
            from agents.services.broadcast import broadcast_agent_update
            await broadcast_agent_update(agent)
    except Exception:  # intentional: feed/broadcast is secondary — task update already committed
        log.warning("mcp.task_update_broadcast_failed", agent_name=agent.name, exc_info=True)

    log.info("mcp.task_updated", agent_name=agent.name, task_id=task_id, fields=update_fields)
    return {"ok": True, "task_id": task_id}


@mcp.tool
async def task_update(
    task_id: str,
    status: str = "",
    title: str = "",
    description: str = "",
    assignee: str = "",
    active_form: str = "",
    add_blocks: list[str] | None = None,
    add_blocked_by: list[str] | None = None,
    metadata: dict | None = None,
) -> dict:
    """Update a task. Only provided (non-empty) fields are changed.

    Args:
        task_id: The ID of the task to update.
        status: New status — "pending", "in_progress", "completed", or "deleted".
        title: New task title.
        description: New description.
        assignee: New assignee (agent name).
        active_form: Present continuous form for spinner.
        add_blocks: Task IDs that this task blocks (appended).
        add_blocked_by: Task IDs that block this task (appended).
        metadata: Metadata keys to merge. Set a key to null to delete it.
    """
    agent = await _authenticate()
    return await update_task(
        agent, task_id=task_id, status=status, title=title,
        description=description, assignee=assignee, active_form=active_form,
        add_blocks=add_blocks, add_blocked_by=add_blocked_by, metadata=metadata,
    )


async def get_task(agent, *, task_id: str) -> dict:
    """Core task_get logic. Called by MCP tool and hook bridge."""
    from agents.models import AgentTask

    try:
        task = await AgentTask.objects.aget(
            project_id=agent.project_id, task_id=task_id,
        )
    except AgentTask.DoesNotExist:
        raise ToolError(f"Task '{task_id}' not found")

    return {
        "task_id": task.task_id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "assignee": task.assignee,
        "active_form": task.active_form,
        "metadata": task.metadata,
        "blocks": task.blocks,
        "blocked_by": task.blocked_by,
    }


@mcp.tool
async def task_get(task_id: str) -> dict:
    """Get full details of a task by ID.

    Args:
        task_id: The ID of the task to retrieve.
    """
    agent = await _authenticate()
    return await get_task(agent, task_id=task_id)


async def list_tasks(agent) -> list[dict]:
    """Core task_list logic. Called by MCP tool and hook bridge."""
    from agents.models import AgentTask

    tasks = [
        {
            "id": t.task_id,
            "title": t.title,
            "status": t.status,
            "assignee": t.assignee,
            "active_form": t.active_form,
            "blocked_by": t.blocked_by,
        }
        async for t in AgentTask.objects.filter(
            project_id=agent.project_id,
        ).order_by("created_at")
    ]

    return tasks


@mcp.tool
async def task_list() -> list[dict]:
    """List all tasks for your project."""
    agent = await _authenticate()
    return await list_tasks(agent)


# ---------------------------------------------------------------------------
# Team tools — agentobox extra (no CC equivalent)
# ---------------------------------------------------------------------------

@mcp.tool
async def team_status() -> list[dict]:
    """Get the status of all active agents in your project."""
    agent = await _authenticate()
    from agents.models import Agent, AgentStatus

    agents = [
        {
            "name": a.name,
            "status": a.status,
            "role": a.role,
            "session_cost_usd": float(a.session_cost_usd) if a.session_cost_usd else 0.0,
        }
        async for a in Agent.objects.filter(
            project_id=agent.project_id,
        ).exclude(status=AgentStatus.STOPPED)
    ]

    return agents
