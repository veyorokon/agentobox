"""
Agent communication: send messages, signals, and mode changes.

Commands are delivered to agents via two paths:

    1. State changes: write to volume → WS reload {"type": "reload", "path": "..."}
       Relay reads the file, applies it, updates status.json.

    2. Ephemeral signals: WS push {"type": "signal", "action": "interrupt|restart|clear"}
       No state — just a control signal. Relay acts immediately.

Messages to agents go through the inbox (volume + reload). Signals
(interrupt, restart, clear) go directly over WS since they're ephemeral
control signals, not state.
"""

import copy
import json
import uuid

import structlog
from asgiref.sync import sync_to_async as _s2a
from channels.layers import get_channel_layer

from agents.errors import (
    ERR_COMMS_DASHBOARD_PUSH_FAILED,
    ERR_COMMS_RELAY_CHECK_FAILED,
    ERR_COMMS_SESSION_CLEANUP_FAILED,
    ERR_COMMS_SKILL_CLEANUP_FAILED,
    ERR_COMMS_SKILL_PUSH_FAILED,
    ERR_COMMS_THEME_PUSH_FAILED,
    ERR_COMMS_URL_TO_BASE64_FAILED,
)
from agents.models import Agent, AgentStatus
from agents.services.broadcast import broadcast_agent_update
from agents.services.relay_commands import (
    ReloadCommand,
    RelayCommand,
    SignalAction,
    SignalCommand,
)
from agents.services.utils import create_stream_event
from agents.utils import sanitize_skill_name

log = structlog.get_logger("abox.comms")


def _needs_restart(agent: Agent) -> bool:
    """Check if an agent needs a hard restart before receiving a message."""
    return (
        agent.status in (AgentStatus.STOPPED, AgentStatus.ERROR)
        or (agent.status != AgentStatus.DEPLOYING and not agent.sandbox_id)
    )


def _normalize_content(content: list) -> list:
    """Normalize image content blocks for the Anthropic API.

    - URL sources: strip media_type (only valid for base64).
    - Non-HTTPS URLs (LocalStack in dev): convert to base64 inline so
      the API can read them.
    """
    import base64
    from urllib.parse import urlparse
    from urllib.request import urlopen

    for block in content:
        source = block.get("source") if isinstance(block, dict) else None
        if not source or source.get("type") != "url":
            continue

        url = source.get("url", "")
        source.pop("media_type", None)

        if not url.startswith("https://"):
            parsed = urlparse(url)
            if parsed.hostname not in ("localhost", "localstack", "127.0.0.1"):
                log.warning("comms.url_fetch_blocked", url=url, reason="untrusted_host")
                continue
            fetch_url = url.replace("localhost:", "localstack:", 1)
            try:
                resp = urlopen(fetch_url, timeout=10)
                raw = resp.read()
                ct = resp.headers.get("Content-Type", "image/png")
                b64 = base64.b64encode(raw).decode()
                source.clear()
                source["type"] = "base64"
                source["media_type"] = ct
                source["data"] = b64
            except Exception as exc:  # intentional: URL-to-base64 conversion is best-effort — keep original block
                log.warning(
                    "comms.url_to_base64_failed",
                    url=url,
                    error_code=ERR_COMMS_URL_TO_BASE64_FAILED,
                    error_class=type(exc).__name__,
                    operation="url_to_base64",
                )

    return content


async def deliver_input(agent: Agent, content: list, task_id: str = "") -> bool:
    """Durably enqueue a task for an agent and notify the relay.

    Writes the canonical task envelope to the inbox:
        {"type": "task", "task_id": "...", "input": {"role": "user", "content": [...]}}

    Content blocks follow the ACP/MCP content model — text, image, tool_result, etc.
    The agent runtime owns how these are mapped to executor-specific formats.

    Returns True when the relay reload was accepted, False when the relay is
    known disconnected. The task is still durable either way because it
    was appended to the inbox first.
    """
    if not task_id:
        task_id = uuid.uuid4().hex[:16]
    agent.volume.append_task(task_id=task_id, content=content)
    return await push_to_relay(str(agent.id), ReloadCommand(path="_abox/inbox.jsonl"))


async def push_to_relay(agent_id: str, command: RelayCommand) -> bool:
    """Push a typed command to the relay via Channels group_send.

    Used for reload commands and ephemeral signals. Payloads are tiny
    notifications — no state data crosses the wire.

    Returns False if the relay is known to be disconnected.
    """
    try:
        connected = await Agent.objects.filter(
            id=agent_id,
        ).values_list("relay_connected", flat=True).afirst()
    except Exception as exc:  # intentional: DB error checking relay state — fall through and attempt send anyway
        log.warning(
            "comms.relay_check_failed",
            agent_id=str(agent_id),
            error_code=ERR_COMMS_RELAY_CHECK_FAILED,
            error_class=type(exc).__name__,
            operation="check_relay_connected",
            exc_info=True,
        )
        connected = None

    if connected is False:
        log.warning("comms.relay_push_failed", agent_id=agent_id, command_type=command.to_wire()["type"])
        return False

    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        f"relay_{agent_id}",
        {"type": "relay.command", "command": command.to_wire()},
    )
    return True


async def update_volume_and_reload(agent, path: str, content: str | bytes) -> bool:
    """Write to the agent volume and notify the relay to re-read.

    Combines volume.mutate() + push_to_relay in a single service call
    so callers outside the service layer dont need to import push_to_relay.
    """
    reload_cmd = agent.volume.mutate(path, content)
    return await push_to_relay(str(agent.id), reload_cmd)


async def send_message(
    agent_id: str, message: str, content: list | None = None,
    source: str = "user",
    correlation_id: str = "",
) -> bool:
    """Send a message to an agent via volume inbox + reload.

    The message is:
    1. Stored as a StreamEvent (audit log, never lost)
    2. Appended to the agent's inbox.jsonl on the volume
    3. Reload sent to the relay so it reads the inbox

    If the agent is dead, it's auto-restarted. The inbox message
    survives on the volume — no backfill logic needed.

    Args:
        correlation_id: Optional ID to trace this message through the system.
            Generated automatically if not provided.
    """
    if not correlation_id:
        correlation_id = uuid.uuid4().hex[:16]
    op_log = log.bind(agent_id=agent_id, source=source, correlation_id=correlation_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("comms.agent_not_found")
        return False

    # Build parts from content blocks or plain text
    if content:
        parts = content
        api_parts = await _s2a(_normalize_content, thread_sensitive=False)(copy.deepcopy(parts))
    else:
        parts = [{"type": "text", "text": message}]
        api_parts = parts

    # Store as StreamEvent BEFORE restart so the message is persisted
    event_data = {
        "type": "user",
        "message": {"role": "user", "content": parts},
        "session_id": agent.session_id or "",
    }
    if source != "user":
        event_data["source"] = source

    await create_stream_event(
        agent,
        event_type="user",
        data=event_data,
        message_id=f"user_{uuid.uuid4().hex[:16]}",
    )

    # Push agent update to dashboard
    try:
        from agents.serializers import serialize_agent
        channel_layer = get_channel_layer()
        payload = await serialize_agent(agent)
        payload["_t"] = "agent"
        await channel_layer.group_send(
            f"dashboard_{agent.project_id}",
            {"type": "dashboard.agent_update", "payload": payload},
        )
    except Exception as exc:  # intentional: dashboard push failure must not break message delivery
        op_log.warning(
            "comms.dashboard_push_failed",
            error_code=ERR_COMMS_DASHBOARD_PUSH_FAILED,
            error_class=type(exc).__name__,
            operation="push_agent_update",
            agent_id=agent_id,
            exc_info=True,
        )

    # Append to inbox (persists on volume even if agent is dead)
    await deliver_input(agent, api_parts)

    # Auto-restart dead agents — inbox message already on volume
    if _needs_restart(agent):
        from agents.services.lifecycle import hard_restart_agent
        op_log.info("comms.auto_restarting", current_status=agent.status)
        await hard_restart_agent(str(agent_id))
        op_log.info("comms.message_sent", delivery="inbox_then_restart")
        return True

    op_log.info("comms.message_sent")
    return True


async def answer_question(agent_id: str, tool_use_id: str, answer_text: str) -> bool:
    """Send a tool_result for an AskUserQuestion back to the agent."""
    op_log = log.bind(agent_id=agent_id, tool_use_id=tool_use_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("comms.agent_not_found")
        return False

    parts = [{"type": "tool_result", "tool_use_id": tool_use_id, "content": answer_text}]

    # Store as StreamEvent
    await create_stream_event(
        agent,
        event_type="user",
        data={
            "type": "user",
            "message": {"role": "user", "content": parts},
            "session_id": agent.session_id or "",
        },
        message_id=f"answer_{uuid.uuid4().hex[:16]}",
    )

    # Append to inbox (persists on volume even if agent is dead)
    await deliver_input(agent, parts)

    # Auto-restart dead agents — inbox message already on volume
    if _needs_restart(agent):
        from agents.services.lifecycle import hard_restart_agent
        op_log.info("comms.auto_restarting", current_status=agent.status)
        await hard_restart_agent(str(agent_id))
        op_log.info("comms.question_answered", delivery="inbox_then_restart")
        return True

    op_log.info("comms.question_answered")
    return True


async def broadcast_message(
    agent_ids: list[str], message: str, content: list | None = None,
) -> bool:
    """Send a message to multiple agents with broadcast dedup metadata."""
    from agents.services.lifecycle import hard_restart_agent

    if not agent_ids:
        return False

    broadcast_id = uuid.uuid4().hex[:16]
    op_log = log.bind(broadcast_id=broadcast_id, agent_count=len(agent_ids))

    if content:
        parts = content
        api_parts = await _s2a(_normalize_content, thread_sensitive=False)(copy.deepcopy(parts))
    else:
        parts = [{"type": "text", "text": message}]
        api_parts = parts

    agents: list[Agent] = [a async for a in Agent.objects.filter(id__in=agent_ids)]
    found_ids = {str(a.id) for a in agents}
    for aid in agent_ids:
        if aid not in found_ids:
            op_log.warning("comms.agent_not_found", agent_id=aid)

    if not agents:
        return False

    target_names = [a.name for a in agents]
    target_ids = [str(a.id) for a in agents]

    broadcast_meta = {
        "type": "_broadcast",
        "broadcast_id": broadcast_id,
        "target_agent_ids": target_ids,
        "target_names": target_names,
    }
    parts_with_meta = [*parts, broadcast_meta]

    for agent in agents:
        await create_stream_event(
            agent,
            event_type="user",
            data={
                "type": "user",
                "message": {"role": "user", "content": parts_with_meta},
                "session_id": agent.session_id or "",
            },
            message_id=f"user_{broadcast_id}_{agent.id}",
        )

        # Append to inbox (persists on volume even if agent is dead)
        await deliver_input(agent, api_parts)

        if _needs_restart(agent):
            op_log.info("comms.auto_restarting", agent_id=str(agent.id))
            await hard_restart_agent(str(agent.id))

    op_log.info("comms.broadcast_sent", targets=target_names)
    return True


async def set_agent_mode(agent_id: str, mode: str) -> Agent:
    """Change an agent's permission mode via volume state.json + reload.

    Writes mode to DB (source of truth for GraphQL) and to state.json
    on the volume. Relay reads state.json on reload and applies via SDK.
    No revert-on-failure — file is on volume, will be read eventually.
    """
    from agents.adapters import get_adapter

    agent = await Agent.objects.aget(id=agent_id)
    adapter = get_adapter(getattr(agent, "agent_type", "claude-code"))

    # Accept both frontend and CC vocabularies
    wire_mode = adapter.mode_to_wire(mode)
    if wire_mode:
        frontend_mode = mode
    else:
        frontend_mode = adapter.wire_to_mode(mode)
        wire_mode = mode
        if not frontend_mode:
            raise ValueError(f"Invalid mode: {mode}. Use: auto, plan, supervised")

    op_log = log.bind(agent_id=agent_id, mode=frontend_mode)

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        raise ValueError(f"Agent must be running or idle (current: {agent.status})")

    if agent.mode == frontend_mode:
        op_log.info("comms.mode_noop")
        return agent

    agent.mode = frontend_mode
    agent.permission_mode = wire_mode
    await agent.asave(update_fields=["mode", "permission_mode"])  # DB cache for GraphQL — volume is source of truth

    await broadcast_agent_update(agent)

    # Store mode change as StreamEvent
    await create_stream_event(
        agent, event_type="mode_change", data={"mode": frontend_mode},
    )

    # Write state.json and reload relay
    reload_cmd = agent.volume.mutate_state(agent.model, frontend_mode, agent.allowed_tools or [])
    await push_to_relay(agent_id, reload_cmd)

    op_log.info("comms.mode_changed")
    return agent


async def push_theme_to_agents(project) -> None:
    """Push theme tokens to all running agents via volume write + reload.

    Writes tokens.json to each agent's volume. The relay's reload handler
    runs converters.py to generate CSS/lua and reloads AwesomeWM + Firefox.
    """
    from agents.models import Agent, AgentStatus
    from agents.services.themes import BUILTIN_THEMES

    tokens = project.theme_tokens
    if not tokens:
        tokens = BUILTIN_THEMES.get("claude-dark", {})

    if not tokens:
        return

    running_agents = [
        a async for a in Agent.objects.filter(
            project=project,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
        ).exclude(sandbox_id="")
    ]

    for agent in running_agents:
        try:
            reload_cmd = agent.volume.mutate_theme_document(tokens, name=project.name)
            await push_to_relay(str(agent.id), reload_cmd)
        except Exception as exc:  # intentional: theme push is best-effort — one agent failure must not block others
            log.exception(
                "comms.theme_push_failed",
                agent_name=agent.name,
                error_code=ERR_COMMS_THEME_PUSH_FAILED,
                error_class=type(exc).__name__,
                operation="push_theme",
                agent_id=str(agent.id),
            )


async def interrupt_agent(agent_id: str) -> bool:
    """Send SIGINT to an agent's Claude Code session.

    Ephemeral signal — goes directly over WS, no volume state.
    """
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("comms.agent_not_found")
        return False

    await create_stream_event(agent, event_type="interrupted", data={})

    sent = await push_to_relay(agent_id, SignalCommand(action=SignalAction.INTERRUPT))
    if not sent:
        op_log.warning("comms.interrupt_failed")
        return False

    op_log.info("comms.interrupt_sent")
    return True


async def restart_agent(agent_id: str) -> bool:
    """Soft restart an agent's Claude Code session."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("comms.agent_not_found")
        return False

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("comms.restart_skipped", status=agent.status)
        return False

    await create_stream_event(agent, event_type="restarting", data={})

    sent = await push_to_relay(agent_id, SignalCommand(action=SignalAction.RESTART))
    if not sent:
        op_log.warning("comms.restart_failed")
        return False

    op_log.info("comms.restart_sent")
    return True


async def push_skill_to_agents(skill, operation: str = "write") -> None:
    """Push a skill write/delete to all matching running agents.

    Skills are written directly to the volume — CC discovers them via
    filesystem. No reload needed; CC reads .claude/skills/ at startup and
    picks up changes on the next invocation.
    """
    import shutil

    all_agents = [
        a async for a in Agent.objects.filter(
            project_id=skill.project_id,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
        )
    ]

    matching_agents = [
        a for a in all_agents
        if skill.assigned_to_all or any(tag in (a.tags or []) for tag in (skill.assigned_tags or []))
    ]

    safe_name = sanitize_skill_name(skill.name)
    if not safe_name:
        return

    for agent in matching_agents:
        try:
            skill_path = f"home/agent/workspace/.claude/skills/{safe_name}/SKILL.md"
            if operation == "write":
                agent.volume.write(skill_path, skill.content)
            elif operation == "delete":
                skill_dir = agent.volume.root / f"home/agent/workspace/.claude/skills/{safe_name}"
                if skill_dir.exists():
                    shutil.rmtree(skill_dir)
        except Exception as exc:  # intentional: one agent's skill push failure must not block other agents
            log.exception(
                "comms.skill_push_failed",
                agent_name=agent.name,
                agent_id=str(agent.id),
                error_code=ERR_COMMS_SKILL_PUSH_FAILED,
                error_class=type(exc).__name__,
                operation="push_skill",
            )


async def push_skill_delete_to_specific_agents(skill_name: str, agent_ids: set[str]) -> None:
    """Push skill deletion to specific agents by ID."""
    import shutil

    safe_name = sanitize_skill_name(skill_name)
    if not safe_name:
        return

    for agent_id in agent_ids:
        try:
            agent = await Agent.objects.aget(id=agent_id)
            skill_dir = agent.volume.root / f"home/agent/workspace/.claude/skills/{safe_name}"
            if skill_dir.exists():
                shutil.rmtree(skill_dir)
        except Exception as exc:  # intentional: one agent's skill cleanup failure must not block other agents
            log.exception(
                "comms.skill_cleanup_failed",
                agent_id=agent_id,
                error_code=ERR_COMMS_SKILL_CLEANUP_FAILED,
                error_class=type(exc).__name__,
                operation="delete_skill",
            )


async def clear_agent_session(agent_id: str) -> bool:
    """Clear an agent's conversation history and restart fresh."""
    op_log = log.bind(agent_id=agent_id)

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        op_log.warning("comms.agent_not_found")
        return False

    if agent.status not in (AgentStatus.RUNNING, AgentStatus.IDLE):
        op_log.warning("comms.clear_session_skipped", status=agent.status)
        return False

    # Clear session files from container — these are on abox-state volume,
    # not the new agent volume, so still need runtime.exec()
    from agents.runtimes import get_runtime
    agent_state_dir = f"/mnt/abox-state/agents/{agent.id}/.claude"
    try:
        runtime = get_runtime(agent.runtime)
        await runtime.exec(agent.sandbox_id, [
            "bash", "-c",
            f"rm -rf {agent_state_dir}/projects/*/",
        ])
    except Exception as exc:  # intentional: session file cleanup is best-effort — restart still proceeds
        op_log.warning(
            "comms.clear_session_failed",
            error_code=ERR_COMMS_SESSION_CLEANUP_FAILED,
            error_class=type(exc).__name__,
            operation="clear_session_files",
            agent_id=agent_id,
            exc_info=True,
        )

    agent.session_id = ""
    await agent.asave(update_fields=["session_id"])

    await create_stream_event(
        agent, event_type="cleared", data={}, session_id="",
    )

    # Ephemeral signal — relay handles clear by discarding session
    sent = await push_to_relay(agent_id, SignalCommand(action=SignalAction.CLEAR))
    if not sent:
        op_log.warning("comms.clear_session_lost")

    op_log.info("comms.session_cleared")
    return True
