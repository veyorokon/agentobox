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

log = structlog.get_logger("abox.incident")

BUNDLE_SCHEMA_VERSION = "1"

# Caps to keep bundles bounded
MAX_STREAM_EVENTS = 200
MAX_FEED_ITEMS = 100
MAX_RUNTIME_LOG_LINES = 50
MAX_LIFECYCLE_ATTEMPTS = 10

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

    # -- Runtime status projection --
    runtime_status = {}
    try:
        runtime_status = agent.runtime_status_projection or {}
    except Exception as exc:  # intentional: best-effort source — field may not be populated
        log.warning("incident.source_failed", source="runtime_status", error_code=ERR_INCIDENT_SOURCE_FAILED, error_class=type(exc).__name__)
        errors.append(f"runtime_status: {type(exc).__name__}: {exc}")

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
            "session_id": agent.session_id or "",
        },
        "agent": agent_snapshot,
        "lifecycle_attempts": lifecycle_attempts,
        "stream_events": stream_events,
        "feed_items": feed_items,
        "runtime_logs": runtime_logs,
        "runtime_status": runtime_status,
        "collection_errors": errors,
    }

    return _redact(_json_safe(bundle)), errors
