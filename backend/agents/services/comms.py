import structlog

from agents.models import Agent, AgentMessage, AgentStatus
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event, broadcast_agent_update

log = structlog.get_logger("agents.comms")


async def send_message(agent_id: str, message: str) -> bool:
    """Send a message to an agent's Claude Code session via tmux."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    # Persist inbound message
    await AgentMessage.objects.acreate(
        agent=agent, direction="inbound", content=message
    )

    await broadcast_agent_event(agent, "inbound_message", {"message": message})

    # Deliver immediately via tmux send-keys
    if agent.sandbox_id:
        try:
            runtime = get_runtime(agent.runtime)
            # -l sends the message as literal text (no key interpretation)
            # Enter is sent separately as a key name
            await runtime.exec(
                agent.sandbox_id,
                ["tmux", "send-keys", "-t", "claude", "-l", message],
            )
            await runtime.exec(
                agent.sandbox_id,
                ["tmux", "send-keys", "-t", "claude", "Enter"],
            )
            op_log.info("message_delivered")

            # Mark agent as running now that it has work
            if agent.status != AgentStatus.RUNNING:
                agent.status = AgentStatus.RUNNING
                await agent.asave(update_fields=["status"])
                await broadcast_agent_update(agent)
        except Exception:
            op_log.exception("message_delivery_failed")
            return False
    else:
        op_log.warning("no_sandbox_for_delivery")
        return False

    return True


async def attach_mcp(agent_id: str, server_name: str, command: str, args: list[str]) -> bool:
    """Attach an MCP server to a running agent via Claude Code's /mcp command."""
    op_log = log.bind(agent_id=agent_id, mcp=server_name)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    if not agent.sandbox_id:
        op_log.warning("no_sandbox_for_mcp")
        return False

    try:
        runtime = get_runtime(agent.runtime)
        cmd_parts = [command] + args
        mcp_cmd = f"/mcp add {server_name} -- {' '.join(cmd_parts)}"
        await runtime.exec(
            agent.sandbox_id,
            ["tmux", "send-keys", "-t", "claude", "-l", mcp_cmd],
        )
        await runtime.exec(
            agent.sandbox_id,
            ["tmux", "send-keys", "-t", "claude", "Enter"],
        )
        op_log.info("mcp_attached")

        # Update the agent's mcp_servers field
        mcp_servers = agent.mcp_servers or {}
        mcp_servers[server_name] = {"command": command, "args": args}
        agent.mcp_servers = mcp_servers
        await agent.asave(update_fields=["mcp_servers"])

        return True
    except Exception:
        op_log.exception("mcp_attach_failed")
        return False
