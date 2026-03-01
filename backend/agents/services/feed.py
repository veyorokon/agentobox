"""
TeamFeedItem creation and attention management.

This is the materialized view layer. StreamEvent = raw audit log.
TeamFeedItem = curated dashboard feed items created when feed-worthy events occur.
"""

import structlog
from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer

from agents.models import Agent, TeamFeedItem

log = structlog.get_logger("agents.feed")

ATTENTION_PRIORITY = {"none": 0, "review": 1, "plan": 2, "permission": 3}


def _create_feed_item_sync(project_id, source_event, agent_record, **kwargs) -> TeamFeedItem:
    """Sync helper: create a TeamFeedItem row.

    Used via sync_to_async(thread_sensitive=False) so it gets its own thread
    instead of the request's CurrentThreadExecutor — which may already be
    torn down if this runs inside an asyncio.create_task() that outlives
    the original HTTP request (e.g. _provision_agent).
    """
    return TeamFeedItem.objects.create(
        project_id=project_id,
        source_event=source_event,
        agent_record=agent_record,
        **kwargs,
    )


_create_feed_item_db = sync_to_async(_create_feed_item_sync, thread_sensitive=False)


async def create_feed_item(project_id, source_event=None, agent_record=None, **kwargs) -> TeamFeedItem:
    """Create a TeamFeedItem and broadcast it to subscribers."""
    item = await _create_feed_item_db(
        project_id,
        source_event,
        agent_record,
        **kwargs,
    )
    await broadcast_feed_item(item)
    return item


async def update_feed_item(item: TeamFeedItem, **kwargs) -> TeamFeedItem:
    """Update a TeamFeedItem's fields and re-broadcast."""
    update_fields = []
    for field, value in kwargs.items():
        setattr(item, field, value)
        update_fields.append(field)
    if update_fields:
        await item.asave(update_fields=update_fields)
        await broadcast_feed_item(item)
    return item


async def recompute_attention(project_id, agent_id: str, after_result: bool = False) -> None:
    """Recompute attention_level from pending TeamFeedItems.

    after_result: if True and no pending items, set "review" instead of "none"
    (agent just finished a turn, output available for review).
    """
    has_perm = await TeamFeedItem.objects.filter(
        project_id=project_id,
        agent_record_id=agent_id,
        type="permission",
        perm_status="pending",
    ).aexists()

    if has_perm:
        level = "permission"
    elif await TeamFeedItem.objects.filter(
        project_id=project_id,
        agent_record_id=agent_id,
        type="plan",
        plan_status="pending",
    ).aexists():
        level = "plan"
    elif after_result:
        level = "review"
    else:
        level = "none"

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        return

    if agent.attention_level != level:
        agent.attention_level = level
        await agent.asave(update_fields=["attention_level"])
        from agents.services.broadcast import broadcast_agent_update
        await broadcast_agent_update(agent)


async def resolve_permission(
    item: TeamFeedItem, verdict: str, *, always_allow: bool = False,
) -> TeamFeedItem:
    """Resolve a permission prompt feed item.

    verdict: 'allowed' | 'denied'
    always_allow: if True and verdict is 'allowed', persist the tool name
        to Agent.allowed_tools so the SDK skips can_use_tool for it on
        future sessions. This is the "Always Allow" button flow — a
        state facet update (see Agent model docstring for the pattern).

    Sends callback_response to relay, resolving the pending Future
    so the SDK's can_use_tool callback returns.
    Recomputes attention for affected agent.
    """
    if verdict not in ("allowed", "denied"):
        raise ValueError(f"Invalid verdict: {verdict}")
    if item.perm_status != "pending":
        return item  # Already resolved — idempotent no-op

    item = await update_feed_item(item, perm_status=verdict)

    # Send callback_response to relay (resolves the pending Future)
    if item.tool_use_id and item.agent_record_id:
        from agents.services.comms import push_to_relay
        result = (
            {"behavior": "allow"}
            if verdict == "allowed"
            else {"behavior": "deny", "message": "Denied by user"}
        )
        await push_to_relay(str(item.agent_record_id), {
            "type": "callback_response",
            "request_id": item.tool_use_id,
            "result": result,
        })

    # Persist "Always Allow" — add tool to agent's allowed_tools facet.
    # Takes effect on next SDK session spawn (provision-only facet).
    if always_allow and verdict == "allowed" and item.agent_record_id and item.source_event_id:
        await _persist_allowed_tool(item)

    if item.agent_record_id:
        await recompute_attention(str(item.project_id), str(item.agent_record_id))

    return item


async def _persist_allowed_tool(item: TeamFeedItem) -> None:
    """Extract tool_name from source event and add to Agent.allowed_tools."""
    from agents.models import Agent, StreamEvent

    try:
        event = await StreamEvent.objects.aget(id=item.source_event_id)
    except StreamEvent.DoesNotExist:
        return

    tool_name = event.data.get("tool_name", "")
    if not tool_name:
        return

    agent = await Agent.objects.aget(id=item.agent_record_id)
    if tool_name not in agent.allowed_tools:
        agent.allowed_tools = [*agent.allowed_tools, tool_name]
        await agent.asave(update_fields=["allowed_tools"])
        from agents.services.broadcast import broadcast_agent_update
        await broadcast_agent_update(agent)


async def resolve_plan(item: TeamFeedItem, verdict: str) -> TeamFeedItem:
    """Resolve a plan proposal feed item.

    verdict: 'approved' | 'rejected'
    Sends tool_result back to agent.
    Recomputes attention for affected agent.
    """
    if verdict not in ("approved", "rejected"):
        raise ValueError(f"Invalid verdict: {verdict}")
    if item.plan_status != "pending":
        return item  # Already resolved — idempotent no-op

    item = await update_feed_item(item, plan_status=verdict)

    if item.agent_record_id:
        from agents.models import Agent, AgentStatus

        try:
            agent = await Agent.objects.aget(id=item.agent_record_id)
        except Agent.DoesNotExist:
            agent = None

        # Don't restart a dead agent just to tell it "rejected"
        is_dead = agent and agent.status in (AgentStatus.STOPPED, AgentStatus.ERROR)
        if not (verdict == "rejected" and is_dead):
            from agents.services.comms import send_message
            msg = (
                "Plan approved. Proceed with the implementation."
                if verdict == "approved"
                else "Plan rejected. Stop and wait for new instructions."
            )
            await send_message(str(item.agent_record_id), msg)

    if item.agent_record_id:
        await recompute_attention(str(item.project_id), str(item.agent_record_id))

    return item


async def broadcast_feed_item(feed_item: TeamFeedItem) -> None:
    """Push new/updated TeamFeedItem to team_feed subscribers."""
    channel_layer = get_channel_layer()
    try:
        await channel_layer.group_send(
            f"project_{feed_item.project_id}_team_feed",
            {
                "type": "team_feed.changed",
                "item_id": str(feed_item.id),
            },
        )
    except Exception:  # intentional: channel layer failure must not break feed item creation
        log.exception("broadcast_feed_item_failed", item_id=str(feed_item.id))
