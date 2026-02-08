import structlog

from agents.models import Agent
from agents.runtimes import get_runtime
from agents.services.broadcast import broadcast_agent_event

log = structlog.get_logger("agents.comms")


async def send_message(agent_id: str, message: str) -> bool:
    """Send a message to an agent's Claude Code session via tmux."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    await broadcast_agent_event(agent, "inbound_message", {"message": message})

    # Deliver immediately via tmux send-keys
    if agent.sandbox_id:
        try:
            runtime = get_runtime(agent.runtime)
            await runtime.exec(
                agent.sandbox_id,
                ["tmux", "send-keys", "-t", "claude", message, "Enter"],
            )
            op_log.info("message_delivered")
        except Exception:
            op_log.exception("message_delivery_failed")
            return False
    else:
        op_log.warning("no_sandbox_for_delivery")
        return False

    return True
