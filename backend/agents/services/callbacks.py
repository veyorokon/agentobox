"""Handle SDK callback requests from the relay.

When the SDK fires a callback (can_use_tool, future hooks), the relay
forwards it as a {type: "callback"} event. We create a TeamFeedItem
for the dashboard and let the existing resolve mutation flow handle
the response back to the relay.

The callback_type field is data, not code — adding a new callback type
means adding a handler function here and a renderer in the dashboard.
No transport changes needed.
"""

import structlog

from agents.models import Agent, StreamEvent
from agents.services.feed import create_feed_item, recompute_attention

log = structlog.get_logger("agents.callbacks")

# Map callback_type → handler. Extensible: add hooks, future callbacks here.
_HANDLERS: dict[str, ...] = {}


def _register(callback_type: str):
    """Register a callback handler by type."""
    def _wrap(fn):
        _HANDLERS[callback_type] = fn
        return fn
    return _wrap


async def process_callback(agent: Agent, event: dict) -> None:
    """Route a callback request to the appropriate handler."""
    callback_type = event.get("callback_type", "")
    request_id = event.get("request_id", "")
    payload = event.get("payload", {})

    if not callback_type or not request_id:
        log.warning("malformed_callback", agent_id=str(agent.id))
        return

    handler = _HANDLERS.get(callback_type)
    if handler:
        await handler(agent, request_id, payload)
    else:
        log.warning("unknown_callback_type", type=callback_type, agent_id=str(agent.id))


# ---------------------------------------------------------------------------
# can_use_tool
# ---------------------------------------------------------------------------

_DESTRUCTIVE_PREFIXES = ("rm ", "sudo ", "chmod ", "chown ", "mkfs", "dd ", "kill ")


def _format_command(tool_name: str, tool_input: dict) -> str:
    """Human-readable summary for the permission card."""
    if tool_name == "Bash":
        return tool_input.get("command", tool_name)
    if tool_name in ("Write", "Edit", "MultiEdit", "Read"):
        return f"{tool_name}: {tool_input.get('file_path', '')}"
    return tool_name


def _assess_risk(tool_name: str, tool_input: dict) -> str:
    """Brief risk annotation for the permission card."""
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        if any(cmd.startswith(p) or f" {p}" in cmd for p in _DESTRUCTIVE_PREFIXES):
            return "Potentially destructive command"
    elif tool_name in ("Write", "Edit", "MultiEdit"):
        return "File modification"
    return ""


@_register("can_use_tool")
async def create_permission_request(agent: Agent, request_id: str, payload: dict) -> None:
    """Create a permission feed item from a can_use_tool SDK callback."""
    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {})

    # Audit log
    stream_event = await StreamEvent.objects.acreate(
        agent=agent,
        session_id=agent.session_id or "",
        event_type="permission_request",
        data={"callback_type": "can_use_tool", "request_id": request_id, **payload},
    )

    # Dashboard feed item — surfaces in AttentionBar + PermissionCard
    await create_feed_item(
        project_id=str(agent.project_id),
        source_event=stream_event,
        agent_record=agent,
        type="permission",
        agent_name=agent.name,
        command=_format_command(tool_name, tool_input),
        risk=_assess_risk(tool_name, tool_input),
        perm_status="pending",
        tool_use_id=request_id,
    )

    await recompute_attention(str(agent.project_id), str(agent.id))
    log.info("permission_request", agent=agent.name, tool=tool_name, request_id=request_id)
