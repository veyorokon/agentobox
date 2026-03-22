"""Runtime compute segment ledger helpers."""

from __future__ import annotations

from asgiref.sync import sync_to_async
from django.utils import timezone

from agents.models import RuntimeSegment
from agents.runtimes import get_runtime


def record_runtime_segment_sync(agent, *, ended_at=None, close_reason: str = "", metadata: dict | None = None):
    """Persist a provider runtime segment if the agent currently has one open."""
    if not agent.deployed_at:
        return None

    finished_at = ended_at or timezone.now()
    compute_seconds = max(0, int((finished_at - agent.deployed_at).total_seconds()))
    resources = get_runtime(agent.runtime).resource_snapshot()

    segment, _created = RuntimeSegment.objects.get_or_create(
        agent=agent,
        project_id=agent.project_id,
        provider=agent.runtime,
        sandbox_id=agent.sandbox_id or "",
        started_at=agent.deployed_at,
        defaults={
            "ended_at": finished_at,
            "compute_seconds": compute_seconds,
            "close_reason": close_reason,
            "cpu_cores": resources.cpu_cores,
            "memory_mb": resources.memory_mb,
            "metadata_json": metadata or {},
        },
    )
    return segment


record_runtime_segment = sync_to_async(record_runtime_segment_sync, thread_sensitive=False)
