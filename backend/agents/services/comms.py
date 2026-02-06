import structlog

from agents.models import Agent, AgentEvent
from agents.services.broadcast import broadcast_agent_event

log = structlog.get_logger("agents.comms")


async def send_message(project_id: str, agent_name: str, message: str) -> bool:
    """Queue a message for delivery to an agent via the next post-tool hook."""
    op_log = log.bind(project_id=project_id, agent=agent_name)

    try:
        agent = await Agent.objects.aget(project_id=project_id, name=agent_name)
    except Agent.DoesNotExist:
        op_log.warning("agent_not_found")
        return False

    event = await AgentEvent.objects.acreate(
        agent=agent,
        event_type="inbound_message",
        data={"message": message, "delivered": False},
    )
    await broadcast_agent_event(event)

    op_log.info("message_queued")
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
