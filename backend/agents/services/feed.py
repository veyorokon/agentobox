"""
TeamFeedItem creation and attention management.

This is the materialized view layer. StreamEvent = raw audit log.
TeamFeedItem = curated dashboard feed items created when feed-worthy events occur.
"""

import structlog
from channels.layers import get_channel_layer

from agents.models import Agent, TeamFeedItem

log = structlog.get_logger("agents.feed")

ATTENTION_PRIORITY = {"none": 0, "review": 1, "plan": 2, "permission": 3}


async def create_feed_item(project_id, source_event=None, agent_record=None, **kwargs) -> TeamFeedItem:
    """Create a TeamFeedItem and broadcast it to subscribers."""
    item = await TeamFeedItem.objects.acreate(
        project_id=project_id,
        source_event=source_event,
        agent_record=agent_record,
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


async def recompute_attention(project_id, agent_name: str, after_result: bool = False) -> None:
    """Recompute attention_level from pending TeamFeedItems.

    after_result: if True and no pending items, set "review" instead of "none"
    (agent just finished a turn, output available for review).
    """
    has_perm = await TeamFeedItem.objects.filter(
        project_id=project_id,
        agent_name=agent_name,
        type="permission",
        perm_status="pending",
    ).aexists()

    if has_perm:
        level = "permission"
    elif await TeamFeedItem.objects.filter(
        project_id=project_id,
        agent_name=agent_name,
        type="plan",
        plan_status="pending",
    ).aexists():
        level = "plan"
    elif after_result:
        level = "review"
    else:
        level = "none"

    try:
        agent = await Agent.objects.aget(project_id=project_id, name=agent_name)
    except Agent.DoesNotExist:
        return

    if agent.attention_level != level:
        agent.attention_level = level
        await agent.asave(update_fields=["attention_level"])
        from agents.services.broadcast import broadcast_agent_update
        await broadcast_agent_update(agent)


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
    except Exception:
        log.exception("broadcast_feed_item_failed", item_id=str(feed_item.id))
