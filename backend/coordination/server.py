"""
MCP Coordination Server for agent-to-agent communication.

Exposes tools for messaging, task management, and team status via the
MCP protocol. Mounted at /mcp on the ASGI server so agents can call
these tools directly without going through stream observation.

Auth: Each tool call authenticates by extracting the Bearer token from
the Authorization header and looking up the Agent by relay_token.

See: docs/ARCHITECTURE.md, "MCP Coordination Server"
"""

import uuid

import structlog
from fastmcp import FastMCP, Context
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers

log = structlog.get_logger("coordination.server")

mcp = FastMCP("abox-coord")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def _authenticate():
    """Authenticate the calling agent via Bearer token in HTTP headers.

    Returns the Agent ORM object. Raises ToolError on auth failure.
    """
    from agents.models import Agent

    headers = get_http_headers() or {}
    auth_header = headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise ToolError("Missing or invalid Authorization header")

    token = auth_header[7:]
    try:
        return await Agent.objects.aget(relay_token=token)
    except Agent.DoesNotExist:
        raise ToolError("Invalid relay token")


# ---------------------------------------------------------------------------
# Messaging tools
# ---------------------------------------------------------------------------

@mcp.tool
async def teammate_message(recipient: str, content: str) -> dict:
    """Send a direct message to a teammate by name.

    Args:
        recipient: The teammate's name (e.g. "backend", "frontend").
        content: The message content to send.
    """
    agent = await _authenticate()
    from agents.models import Agent

    try:
        target = await Agent.objects.aget(
            project_id=agent.project_id, name=recipient,
        )
    except Agent.DoesNotExist:
        raise ToolError(f"Teammate '{recipient}' not found")

    from agents.services.interagent import _deliver_to_stdin
    await _deliver_to_stdin(agent.name, target, content)

    log.info("mcp_teammate_message", sender=agent.name, recipient=recipient)
    return {"ok": True, "recipient": recipient}


@mcp.tool
async def teammate_broadcast(content: str) -> dict:
    """Broadcast a message to all teammates. Use sparingly.

    Args:
        content: The message content to broadcast.
    """
    agent = await _authenticate()

    from agents.services.interagent import _handle_broadcast
    await _handle_broadcast(agent, content, "")

    log.info("mcp_teammate_broadcast", sender=agent.name)
    return {"ok": True}


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

    log.info("mcp_teammate_spawn", spawner=agent.name, new_agent=name)
    return {"ok": True, "agent_id": str(new_agent.id), "name": new_agent.name}


# ---------------------------------------------------------------------------
# Task tools
# ---------------------------------------------------------------------------

@mcp.tool
async def task_add(subject: str, description: str = "") -> dict:
    """Create a new task for the team.

    Args:
        subject: Brief task title in imperative form.
        description: Detailed description of what needs to be done.
    """
    agent = await _authenticate()
    from agents.models import AgentTask

    task = await AgentTask.objects.acreate(
        agent=agent,
        project_id=agent.project_id,
        task_id=f"mcp_{uuid.uuid4().hex[:12]}",
        subject=subject[:500],
        description=description,
        status="pending",
    )

    log.info("mcp_task_add", agent=agent.name, subject=subject[:80])
    return {"ok": True, "task_id": task.task_id}


@mcp.tool
async def task_claim(task_id: str) -> dict:
    """Claim a task and mark it as in-progress.

    Args:
        task_id: The ID of the task to claim.
    """
    agent = await _authenticate()
    from agents.models import AgentTask

    updated = await AgentTask.objects.filter(
        project_id=agent.project_id, task_id=task_id,
    ).aupdate(owner=agent.name, status="in_progress")

    if not updated:
        raise ToolError(f"Task '{task_id}' not found")

    log.info("mcp_task_claim", agent=agent.name, task_id=task_id)
    return {"ok": True}


@mcp.tool
async def task_complete(task_id: str) -> dict:
    """Mark a task as completed.

    Args:
        task_id: The ID of the task to complete.
    """
    agent = await _authenticate()
    from agents.models import AgentTask

    updated = await AgentTask.objects.filter(
        project_id=agent.project_id, task_id=task_id,
    ).aupdate(status="completed")

    if not updated:
        raise ToolError(f"Task '{task_id}' not found")

    log.info("mcp_task_complete", agent=agent.name, task_id=task_id)
    return {"ok": True}


@mcp.tool
async def task_list() -> list[dict]:
    """List all tasks for your project."""
    agent = await _authenticate()
    from agents.models import AgentTask

    tasks = [
        {
            "task_id": t.task_id,
            "subject": t.subject,
            "status": t.status,
            "owner": t.owner,
        }
        async for t in AgentTask.objects.filter(
            project_id=agent.project_id,
        ).order_by("-created_at")
    ]

    return tasks


# ---------------------------------------------------------------------------
# Team tools
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


