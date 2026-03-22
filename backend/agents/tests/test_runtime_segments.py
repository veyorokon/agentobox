from datetime import timedelta
from decimal import Decimal

import pytest
from asgiref.sync import sync_to_async
from django.utils import timezone

from accounts.models import User
from agents.models import Agent, AgentStatus, RuntimeSegment
from agents.services.runtime_segments import record_runtime_segment_sync
from agents.runtimes.base import RuntimeResources
from projects.models import Project


pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.integration]


@pytest.mark.asyncio
async def test_record_runtime_segment_sync_persists_runtime_adapter_facts(monkeypatch):
    def _setup():
        owner = User.objects.create_user(username="runtime_seg_owner", password="pw")
        project = Project.objects.create(name="Runtime Seg Project", owner=owner)
        return Agent.objects.create(
            name="worker-seg",
            project=project,
            runtime="modal",
            status=AgentStatus.IDLE,
            sandbox_id="sb-test-segment",
            deployed_at=timezone.now() - timedelta(seconds=12),
        )

    agent = await sync_to_async(_setup, thread_sensitive=True)()
    ended_at = timezone.now()

    class _FakeRuntime:
        def resource_snapshot(self):
            return RuntimeResources(cpu_cores=Decimal("3.5"), memory_mb=8192)

    monkeypatch.setattr("agents.services.runtime_segments.get_runtime", lambda runtime_name: _FakeRuntime())

    segment = await sync_to_async(record_runtime_segment_sync, thread_sensitive=True)(
        agent,
        ended_at=ended_at,
        close_reason="kill_agent",
        metadata={"status_before": "idle"},
    )

    assert segment is not None
    assert segment.provider == "modal"
    assert segment.sandbox_id == "sb-test-segment"
    assert segment.started_at == agent.deployed_at
    assert segment.ended_at == ended_at
    assert segment.compute_seconds >= 12
    assert float(segment.cpu_cores) == pytest.approx(3.5)
    assert segment.memory_mb == 8192
    assert segment.close_reason == "kill_agent"
    assert segment.metadata_json == {"status_before": "idle"}


@pytest.mark.asyncio
async def test_record_runtime_segment_sync_no_open_segment_returns_none(agent):
    segment = await sync_to_async(record_runtime_segment_sync, thread_sensitive=True)(
        agent,
        close_reason="noop",
    )
    assert segment is None
    assert await RuntimeSegment.objects.acount() == 0


@pytest.mark.asyncio
async def test_record_runtime_segment_sync_is_idempotent_for_same_runtime():
    def _setup():
        owner = User.objects.create_user(username="runtime_seg_dupe_owner", password="pw")
        project = Project.objects.create(name="Runtime Seg Dupe Project", owner=owner)
        return Agent.objects.create(
            name="worker-seg-dupe",
            project=project,
            runtime="modal",
            status=AgentStatus.IDLE,
            sandbox_id="sb-test-segment-dupe",
            deployed_at=timezone.now() - timedelta(seconds=7),
        )

    agent = await sync_to_async(_setup, thread_sensitive=True)()

    first = await sync_to_async(record_runtime_segment_sync, thread_sensitive=True)(
        agent,
        close_reason="kill_agent",
    )
    second = await sync_to_async(record_runtime_segment_sync, thread_sensitive=True)(
        agent,
        close_reason="kill_agent",
    )

    assert first is not None
    assert second is not None
    assert first.id == second.id
    assert await RuntimeSegment.objects.acount() == 1
