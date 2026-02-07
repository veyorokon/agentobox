import structlog

from agents.models import Agent, AgentEvent
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

    # Record the event
    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="inbound_message",
        data={"message": message},
    )
    await broadcast_agent_event(event)

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


async def get_pending_messages(agent: Agent) -> list[str]:
    """Retrieve and mark as delivered any pending inbound messages for an agent."""
    pending = AgentEvent.objects.filter(
        agent=agent,
        event_type="inbound_message",
        data__delivered=False,
    )

    messages = []
    async for event in pending:
        messages.append(event.data["message"])
        event.data["delivered"] = True
        await event.asave(update_fields=["data"])

    return messages
