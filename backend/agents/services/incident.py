"""Incident capture: assemble a bounded, redacted diagnosis bundle for one agent.

Captures recent evidence from DB + agent volume, scoped to one agent and
a time window. Each source is best-effort — partial failures go into
collection_errors, not total failure.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.utils import timezone

import structlog

from agents.errors import ERR_INCIDENT_SOURCE_FAILED
from agents.models import Agent, StreamEvent, TeamFeedItem
from agents.services.task_health import classify_task_health

log = structlog.get_logger("abox.incident")

BUNDLE_SCHEMA_VERSION = "4"

# Caps to keep bundles bounded
MAX_STREAM_EVENTS = 200
MAX_FEED_ITEMS = 100
MAX_RUNTIME_LOG_LINES = 50
MAX_LIFECYCLE_ATTEMPTS = 10

# Raw support bundle limits
MAX_RAW_FILE_BYTES = 8192  # 8KB per file read limit (enforced at read time)
RAW_BUNDLE_FILES = (
    # Control plane desired state
    "_abox/state.json",
    # Runtime observed state
    "_abox/status.json",
    # Task submission evidence
    "_abox/inbox.jsonl",
    # Applied theme artifacts
    "tmp/abox-theme/tokens.json",
    "tmp/abox-theme/theme.json",
    # Desktop config
    "home/agent/.config/awesome/rc.lua",
)
# Commands to capture generic runtime evidence (best-effort, bounded output)
RAW_BUNDLE_COMMANDS = (
    {"name": "process_list", "cmd": ["ps", "aux", "--no-header"], "max_bytes": 4096},
)

# Field names that must be redacted from the bundle.
REDACTED_FIELDS = frozenset({
    "relay_token",
    "encrypted_value",
    "api_key",
    "apiKey",
    "secret",
    "password",
    "proxy_key",
})

# Fields whose names contain "token" but are safe to keep.
SAFE_FIELDS = frozenset({
    "relay_connected",
    "token_hash",
    "smoke_token",
    "schema_version",
})

REDACTED = "[REDACTED]"


def _json_safe(obj: Any) -> Any:
    """Recursively convert UUIDs, datetimes, and other non-JSON types to strings."""
    import uuid as _uuid
    from datetime import date, datetime

    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(item) for item in obj]
    if isinstance(obj, _uuid.UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    from decimal import Decimal
    if isinstance(obj, Decimal):
        return float(obj)
    return obj


def _redact(obj: Any) -> Any:
    """Recursively redact sensitive field values from a dict/list tree."""
    if isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            if key in SAFE_FIELDS:
                result[key] = _redact(value)
            elif key in REDACTED_FIELDS:
                result[key] = REDACTED
            elif "token" in key.lower() and key not in SAFE_FIELDS:
                result[key] = REDACTED
            else:
                result[key] = _redact(value)
        return result
    if isinstance(obj, list):
        return [_redact(item) for item in obj]
    return obj


async def _read_runtime_logs(agent: Agent) -> list[dict]:
    """Read runtime log tail from the agent's machine volume."""
    from asgiref.sync import sync_to_async

    return await sync_to_async(
        agent.machine.runtime_log_tail, thread_sensitive=False
    )(limit=MAX_RUNTIME_LOG_LINES)


async def capture_incident_bundle(
    agent: Agent,
    *,
    note: str = "",
    screenshot_url: str = "",
    window_minutes: int = 30,
) -> tuple[dict, list[str]]:
    """Assemble a diagnosis bundle for one agent.

    Returns (bundle_dict, collection_errors). Each source is best-effort:
    if a source fails, the error is appended to collection_errors and the
    bundle still contains whatever other sources succeeded.
    """
    from agents.serializers import fetch_lifecycle_attempts, serialize_agent

    errors: list[str] = []
    now = timezone.now()
    cutoff = now - timedelta(minutes=window_minutes)
    agent_id = str(agent.id)
    project_id = str(agent.project_id)

    # -- Agent snapshot --
    agent_snapshot = {}
    try:
        agent_snapshot = await serialize_agent(agent)
    except Exception as exc:  # intentional: best-effort source — partial failure goes to collection_errors
        log.warning("incident.source_failed", source="agent_snapshot", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"agent_snapshot: {type(exc).__name__}: {exc}")

    # -- Lifecycle attempts --
    lifecycle_attempts = []
    try:
        lifecycle_attempts = await fetch_lifecycle_attempts(agent_id)
        lifecycle_attempts = lifecycle_attempts[:MAX_LIFECYCLE_ATTEMPTS]
    except Exception as exc:  # intentional: best-effort source — partial failure goes to collection_errors
        log.warning("incident.source_failed", source="lifecycle_attempts", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"lifecycle_attempts: {type(exc).__name__}: {exc}")

    # -- Recent stream events (canonical only, no stream_event deltas) --
    stream_events = []
    try:
        qs = (
            StreamEvent.canonical.filter(
                agent_id=agent_id,
                created_at__gte=cutoff,
            )
            .exclude(event_type="stream_event")
            .order_by("-created_at")[:MAX_STREAM_EVENTS]
        )
        raw = [
            {
                "id": e.id,
                "event_type": e.event_type,
                "session_id": e.session_id,
                "task_id": e.task_id,
                "data": e.data,
                "created_at": e.created_at.isoformat(),
            }
            async for e in qs
        ]
        raw.reverse()
        stream_events = raw
    except Exception as exc:  # intentional: best-effort source — partial failure goes to collection_errors
        log.warning("incident.source_failed", source="stream_events", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"stream_events: {type(exc).__name__}: {exc}")

    # -- Recent feed items (scoped to this agent only) --
    feed_items = []
    try:
        qs = (
            TeamFeedItem.objects.filter(
                project_id=project_id,
                agent_record_id=agent_id,
                created_at__gte=cutoff,
            )
            .order_by("-created_at")[:MAX_FEED_ITEMS]
        )
        raw = [
            {
                "id": str(fi.id),
                "type": fi.type,
                "agent_name": fi.agent_name,
                "text": fi.text,
                "created_at": fi.created_at.isoformat(),
            }
            async for fi in qs
        ]
        raw.reverse()
        feed_items = raw
    except Exception as exc:  # intentional: best-effort source — partial failure goes to collection_errors
        log.warning("incident.source_failed", source="feed_items", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"feed_items: {type(exc).__name__}: {exc}")

    # -- Runtime logs (from agent volume, best-effort) --
    runtime_logs = []
    try:
        runtime_logs = await _read_runtime_logs(agent)
    except Exception as exc:  # intentional: best-effort source — volume may not be mounted
        log.warning("incident.source_failed", source="runtime_logs", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"runtime_logs: {type(exc).__name__}: {exc}")

    # -- Platform crash info (provider-level, best-effort) --
    platform_crash_info = None
    if agent.sandbox_id:
        try:
            from agents.runtimes import get_runtime
            runtime = get_runtime(agent.runtime)
            platform_crash_info = await runtime.get_crash_info(agent.sandbox_id)
        except Exception as exc:  # intentional: best-effort — platform API may be unavailable
            log.warning("incident.source_failed", source="platform_crash_info", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
            errors.append(f"platform_crash_info: {type(exc).__name__}: {exc}")

    # -- Platform events (provider-level, best-effort) --
    platform_events: list[dict] = []
    if agent.sandbox_id:
        try:
            from agents.runtimes import get_runtime
            runtime = get_runtime(agent.runtime)
            platform_events = await runtime.get_event_tail(agent.sandbox_id)
        except Exception as exc:  # intentional: best-effort — platform API may be unavailable
            log.warning("incident.source_failed", source="platform_events", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
            errors.append(f"platform_events: {type(exc).__name__}: {exc}")

    # -- Runtime status projection --
    runtime_status = {}
    try:
        runtime_status = agent.runtime_status_projection or {}
    except Exception as exc:  # intentional: best-effort source — field may not be populated
        log.warning("incident.source_failed", source="runtime_status", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"runtime_status: {type(exc).__name__}: {exc}")

    # -- Desired theme fingerprint (computed in async path, not via sync agent.project) --
    desired_theme_fingerprint = None
    try:
        from asgiref.sync import sync_to_async
        from projects.models import Project
        project = await Project.objects.aget(id=agent.project_id)
        desired_theme_fingerprint = _canonical_theme_fingerprint_from_project(project)
    except Exception as exc:  # intentional: best-effort — supplementary diagnosis field
        log.debug("incident.source_failed", source="desired_theme", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)

    # -- Derive session_id: prefer agent model, fall back to runtime projection --
    runtime_session_id = ""
    if isinstance(runtime_status, dict):
        rt = runtime_status.get("runtime", {})
        if isinstance(rt, dict):
            runtime_session_id = rt.get("session_id", "") or ""

    # -- Structural diagnosis layers --
    desired = _extract_desired(agent, desired_theme_fingerprint)
    observed = _extract_observed(agent, runtime_status)
    applied = _extract_applied(agent, runtime_logs)

    # -- Raw support bundle (bounded file snapshots from agent volume) --
    raw_support = {}
    try:
        raw_support = await _collect_raw_support(agent, errors)
    except Exception as exc:  # intentional: best-effort — raw bundle is supplementary evidence
        log.warning("incident.source_failed", source="raw_support", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"raw_support: {type(exc).__name__}: {exc}")

    # -- Task state discrepancy detection --
    task_state_discrepancy = _compute_task_state_discrepancy(
        runtime_status, stream_events,
    )

    bundle = {
        "schema_version": BUNDLE_SCHEMA_VERSION,
        "captured_at": now.isoformat(),
        "note": note,
        "screenshot_url": screenshot_url,
        "window_minutes": window_minutes,
        "ids": {
            "agent_id": agent_id,
            "project_id": project_id,
            "sandbox_id": agent.sandbox_id or "",
            "session_id": agent.session_id or runtime_session_id,
        },
        "desired": desired,
        "observed": observed,
        "applied": applied,
        "raw_support": raw_support,
        "agent": agent_snapshot,
        "lifecycle_attempts": lifecycle_attempts,
        "stream_events": stream_events,
        "feed_items": feed_items,
        "runtime_logs": runtime_logs,
        "runtime_status": runtime_status,
        "platform_crash_info": platform_crash_info,
        "platform_events": platform_events,
        "task_state_discrepancy": task_state_discrepancy,
        "collection_errors": errors,
    }

    return _redact(_json_safe(bundle)), errors


def _canonical_theme_fingerprint_from_project(project) -> str | None:
    """Compute fingerprint from an already-fetched project instance."""
    import hashlib
    from agents.services.themes import format_theme_document
    tokens = project.resolved_theme_tokens()
    if tokens:
        payload = format_theme_document(tokens, name=project.name)
        return hashlib.sha256(payload.encode()).hexdigest()[:12]
    return None


def _extract_desired(agent: Agent, theme_fingerprint: str | None) -> dict:
    """What the control plane wanted."""
    return {
        "desired_status": getattr(agent, "desired_status", None),
        "model": agent.model or None,
        "mode": agent.mode or None,
        "theme_fingerprint": theme_fingerprint,
        "source": "agent_model",
    }


def _extract_observed(agent: Agent, runtime_status: dict) -> dict:
    """What the backend/runtime believes is true."""
    rt = runtime_status.get("runtime", {}) if isinstance(runtime_status.get("runtime"), dict) else {}
    transport = runtime_status.get("transport", {}) if isinstance(runtime_status.get("transport"), dict) else {}
    build = runtime_status.get("build", {}) if isinstance(runtime_status.get("build"), dict) else {}
    task_health = classify_task_health(
        runtime_task_state=rt.get("task_state") or None,
        task_started_at=getattr(agent, "task_started_at", None),
        last_execution_event_at=getattr(agent, "last_execution_event_at", None),
    )

    return {
        "lifecycle_status": agent.status,
        "preview_state": _derive_preview_state_safe(agent),
        "relay_connected": getattr(agent, "relay_connected", None),
        "runtime_startup_stage": runtime_status.get("startup_stage"),
        "runtime_profile": runtime_status.get("profile"),
        "runtime_state": runtime_status.get("runtime_state"),
        # Runtime executor task state (not AgentTask team-board)
        "runtime_task_id": rt.get("task_id") or None,
        "runtime_task_state": rt.get("task_state") or None,
        "runtime_client_active": rt.get("client_active"),
        # Runtime health diagnosis
        "fatal": runtime_status.get("fatal"),
        "degraded": runtime_status.get("degraded", []),
        "transport_state": transport.get("state"),
        "transport_last_error": transport.get("last_error"),
        # Build provenance
        "build_image_ref": build.get("image_ref") or None,
        "build_git_commit": build.get("git_commit") or None,
        # Task timing (for watchdog classification)
        "task_started_at": getattr(agent, "task_started_at", None),
        "last_execution_event_at": getattr(agent, "last_execution_event_at", None),
        "task_health": task_health,
        "source": "agent_model+runtime_projection",
    }


_TERMINAL_TASK_STATES = frozenset({"completed", "failed", "cleared"})


def _compute_task_state_discrepancy(
    runtime_status: dict, stream_events: list[dict],
) -> dict | None:
    """Compare runtime-projected task state vs latest persisted task_update.

    Returns None if no runtime task_id. Otherwise returns a diagnostic dict
    with discrepancy_kind:
      - none: states match
      - missing_terminal_update: runtime is terminal but persisted is missing or non-terminal
      - state_mismatch: persisted and runtime are both terminal but disagree
      - in_progress: runtime is non-terminal, no discrepancy to flag
    """
    rt = runtime_status.get("runtime", {}) if isinstance(runtime_status.get("runtime"), dict) else {}
    runtime_task_id = rt.get("task_id") or None
    runtime_task_state = rt.get("task_state") or None

    if not runtime_task_id:
        return None

    # Find latest persisted task_update for this specific task_id
    persisted_state = None
    for evt in reversed(stream_events):
        if evt.get("event_type") == "task_update":
            data = evt.get("data", {})
            if isinstance(data, dict) and data.get("task_id") == runtime_task_id:
                persisted_state = data.get("state")
                break

    if persisted_state == runtime_task_state:
        kind = "none"
    elif runtime_task_state not in _TERMINAL_TASK_STATES:
        # Runtime is non-terminal (queued, running, idle) — no discrepancy to flag
        kind = "in_progress"
    elif persisted_state is None or persisted_state not in _TERMINAL_TASK_STATES:
        # Runtime is terminal but persisted is missing or still non-terminal —
        # the terminal event never arrived (transport drop)
        kind = "missing_terminal_update"
    else:
        # Both terminal but disagree (e.g. persisted=failed, runtime=completed)
        kind = "state_mismatch"

    return {
        "runtime_task_id": runtime_task_id,
        "runtime_task_state": runtime_task_state,
        "persisted_task_state": persisted_state,
        "discrepancy_kind": kind,
    }


def _derive_preview_state_safe(agent: Agent) -> str | None:
    from agents.serializers import derive_preview_state
    try:
        return derive_preview_state(agent)
    except Exception as exc:  # intentional: best-effort — preview state is derived, not critical
        log.debug("incident.source_failed", source="preview_state", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        return None


# ---------------------------------------------------------------------------
# Applied state — registry-based projection from runtime logs
# ---------------------------------------------------------------------------

# Stable schema: every field is always present, nullable when no signal.
_APPLIED_SCHEMA: dict[str, Any] = {
    "theme_fingerprint": None,
    "theme_fingerprint_source": "runtime_file",
    "theme_projected_at": None,
    "theme_notify_result": None,
    "theme_notify_error": None,
    "last_launcher_request": None,
    "display_ready": None,
    "display_ready_attempts": None,
    "source": "runtime_file+runtime_log",
}


def _on_theme_projected(s: dict, e: dict) -> None:
    # theme_fingerprint is file-backed (set before registry scan).
    # only capture the ephemeral timestamp from the event.
    if s["theme_projected_at"] is None:
        s["theme_projected_at"] = e.get("ts")


def _on_theme_consumer_applied(s: dict, e: dict) -> None:
    if s["theme_notify_result"] is None:
        s["theme_notify_result"] = "succeeded"


def _on_theme_consumer_failed(s: dict, e: dict) -> None:
    if s["theme_notify_result"] is None:
        s["theme_notify_result"] = "failed"
        s["theme_notify_error"] = e.get("error")


def _on_desktop_launch_requested(s: dict, e: dict) -> None:
    if s["last_launcher_request"] is None:
        s["last_launcher_request"] = e.get("command")


def _on_desktop_display_ready(s: dict, e: dict) -> None:
    if s["display_ready"] is None:
        s["display_ready"] = True
        s["display_ready_attempts"] = e.get("attempts")


def _on_desktop_display_timeout(s: dict, e: dict) -> None:
    if s["display_ready"] is None:
        s["display_ready"] = False


# Registry: event name → updater. Adding a new event = one entry + one function.
_APPLIED_HANDLERS: dict[str, Any] = {
    "theme.projected": _on_theme_projected,
    "theme.consumer_applied": _on_theme_consumer_applied,
    "theme.consumer_failed": _on_theme_consumer_failed,
    "desktop.launch_requested": _on_desktop_launch_requested,
    "desktop.display_ready": _on_desktop_display_ready,
    "desktop.display_timeout": _on_desktop_display_timeout,
}


def _read_runtime_theme_fingerprint(agent: Agent) -> str | None:
    """Read theme fingerprint from the canonical runtime file, not from logs.

    Source: tmp/abox-theme/tokens.json on the agent volume.
    """
    try:
        import hashlib
        content = agent.machine.read("tmp/abox-theme/tokens.json")
        if content:
            return hashlib.sha256(content.encode()).hexdigest()[:12]
    except Exception as exc:  # intentional: best-effort — file may not exist or volume may not be mounted
        log.debug("incident.source_failed", source="runtime_theme_fingerprint", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
    return None


def _extract_applied(agent: Agent, runtime_logs: list[dict]) -> dict:
    """What the desktop/runtime consumer actually applied.

    Durable state (theme fingerprint) comes from canonical runtime files.
    Ephemeral outcomes (consumer result, launcher, display) come from
    runtime log events via the handler registry.

    Every field in _APPLIED_SCHEMA is always present (nullable when no signal).
    """
    snapshot = dict(_APPLIED_SCHEMA)

    # File-backed durable state
    snapshot["theme_fingerprint"] = _read_runtime_theme_fingerprint(agent)
    snapshot["theme_fingerprint_source"] = "runtime_file"

    # Event-backed ephemeral outcomes
    for event in reversed(runtime_logs):
        handler = _APPLIED_HANDLERS.get(event.get("event", ""))
        if handler:
            handler(snapshot, event)
    return snapshot


# ---------------------------------------------------------------------------
# Raw support bundle — bounded file snapshots from agent volume
# ---------------------------------------------------------------------------


def _bounded_read_sync(machine, path: str, max_bytes: int) -> tuple[bytes, bool]:
    """Read a file from the machine volume with a byte limit.

    Returns (content_bytes, was_truncated). Uses the public
    machine.read_bytes_limited() seam for bounded reads.
    """
    if not machine.exists(path):
        raise FileNotFoundError(path)
    return machine.read_bytes_limited(path, max_bytes)


async def _collect_raw_support(agent: Agent, errors: list[str]) -> dict:
    """Collect bounded raw evidence from canonical runtime artifacts.

    Files are read with a strict byte cap at read time (not post-load
    truncation). Process list and other command-based evidence is
    collected via runtime.exec when a sandbox exists.
    """
    import hashlib
    from asgiref.sync import sync_to_async

    file_artifacts: list[dict] = []

    for path in RAW_BUNDLE_FILES:
        entry: dict[str, Any] = {
            "path": path,
            "content": None,
            "sha256": None,
            "truncated": False,
            "error": None,
        }
        try:
            raw_bytes, truncated = await sync_to_async(
                _bounded_read_sync, thread_sensitive=False
            )(agent.machine, path, MAX_RAW_FILE_BYTES)
            entry["sha256"] = hashlib.sha256(raw_bytes).hexdigest()[:16]
            entry["truncated"] = truncated
            entry["content"] = raw_bytes.decode("utf-8", errors="replace")
        except FileNotFoundError:
            entry["error"] = "not_found"
        except Exception as exc:  # intentional: best-effort per file — one failure must not block others
            log.debug("incident.raw_file_failed", path=path, error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
            entry["error"] = f"{type(exc).__name__}: {exc}"
            errors.append(f"raw_support:{path}: {type(exc).__name__}: {exc}")
        file_artifacts.append(entry)

    # Command-based evidence (process list, etc.) — requires live sandbox
    command_artifacts: list[dict] = []
    if agent.sandbox_id:
        from agents.runtimes import get_runtime
        runtime = get_runtime(agent.runtime)
        for spec in RAW_BUNDLE_COMMANDS:
            cmd_entry: dict[str, Any] = {
                "name": spec["name"],
                "content": None,
                "truncated": False,
                "error": None,
            }
            try:
                output = await runtime.exec(agent.sandbox_id, spec["cmd"])
                max_cmd = spec.get("max_bytes", MAX_RAW_FILE_BYTES)
                raw = output.encode("utf-8") if isinstance(output, str) else output
                cmd_entry["truncated"] = len(raw) > max_cmd
                cmd_entry["content"] = raw[:max_cmd].decode("utf-8", errors="replace")
            except Exception as exc:  # intentional: best-effort per command — sandbox may be dead
                log.debug("incident.raw_cmd_failed", name=spec["name"], error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
                cmd_entry["error"] = f"{type(exc).__name__}: {exc}"
            command_artifacts.append(cmd_entry)

    return {
        "files": file_artifacts,
        "commands": command_artifacts,
        "max_file_bytes": MAX_RAW_FILE_BYTES,
        "source": "agent_volume+runtime_exec",
    }
