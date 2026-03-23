"""Tests for agents.services.reconcile — stuck deploy detection + orphan reaping.

Covers:
- Two-tier timeout logic in _detect_stuck_deploys
- Orphan reaper container matching (sandbox_id + agent.id label)
"""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from django.utils import timezone

pytestmark = pytest.mark.unit

from agents.models import AgentStatus
from agents.services.reconcile import (
    DEPLOY_GRACE_S,
    DEPLOY_HARD_LIMIT_S,
    REASON_RECONCILER_DEAD_RUNTIME,
    REASON_RECONCILER_RELAY_DISCONNECTED,
    REASON_RECONCILER_RUNTIME_LIMBO,
    REASON_RECONCILER_RUNTIME_MISSING,
    _detect_active_relay_disconnect,
    _detect_dead_containers,
    _detect_runtime_limbo,
    _detect_stuck_deploys,
    _reap_errored_agents,
    _reap_orphans_sync,
)


def _make_agent(*, sandbox_id="container-abc", runtime="docker",
                updated_at=None, agent_id="agent-1", name="test-agent"):
    """Build a fake agent with the fields _detect_stuck_deploys reads."""
    return SimpleNamespace(
        id=agent_id,
        name=name,
        sandbox_id=sandbox_id,
        runtime=runtime,
        status=AgentStatus.DEPLOYING,
        updated_at=updated_at or timezone.now(),
        project_id="project-1",
    )


@pytest.mark.asyncio
class TestDetectStuckDeploys:
    """Unit tests for the reconciler's stuck-deploy liveness probe."""

    async def _run(self, agents, runtime_status="running"):
        """Helper: run _detect_stuck_deploys with mocked dependencies."""
        mock_runtime = AsyncMock()
        mock_runtime.get_status = AsyncMock(return_value=runtime_status)

        with (
            patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=agents),
            patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
            patch("agents.services.reconcile._mark_error", new_callable=AsyncMock, side_effect=lambda aid, **kw: _make_agent(agent_id=aid)),
            patch("agents.services.reconcile.fail_active_lifecycle_attempts", new_callable=AsyncMock),
            patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock),
            patch("agents.runtimes.get_runtime", return_value=mock_runtime),
        ):
            await _detect_stuck_deploys(timezone.now())
            return mock_terminate, mock_runtime

    async def test_running_container_soft_deadline_skipped(self):
        """Running container past soft deadline but before hard → not killed."""
        agent = _make_agent(
            updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
        )
        mock_terminate, mock_runtime = await self._run([agent], runtime_status="running")

        mock_runtime.get_status.assert_awaited_once_with("container-abc")
        mock_terminate.assert_not_awaited()

    async def test_dead_container_soft_deadline_killed(self):
        """Dead container past soft deadline → killed."""
        agent = _make_agent(
            updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
        )
        mock_terminate, mock_runtime = await self._run([agent], runtime_status="exited")

        mock_runtime.get_status.assert_awaited_once()
        mock_terminate.assert_awaited_once()

    async def test_running_container_hard_deadline_killed(self):
        """Running container past hard deadline → killed regardless."""
        agent = _make_agent(
            updated_at=timezone.now() - timedelta(seconds=DEPLOY_HARD_LIMIT_S + 10),
        )
        mock_terminate, mock_runtime = await self._run([agent], runtime_status="running")

        # Hard deadline: runtime.get_status should NOT be called (skipped)
        mock_runtime.get_status.assert_not_awaited()
        mock_terminate.assert_awaited_once()

    async def test_no_sandbox_id_killed(self):
        """Agent with no sandbox_id → killed (can't probe)."""
        agent = _make_agent(
            sandbox_id="",
            updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
        )
        mock_terminate, mock_runtime = await self._run([agent])

        mock_runtime.get_status.assert_not_awaited()
        mock_terminate.assert_awaited_once()

    async def test_status_check_fails_killed(self):
        """Runtime status check raises → killed (safe default)."""
        agent = _make_agent(
            updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
        )

        mock_runtime = AsyncMock()
        mock_runtime.get_status = AsyncMock(side_effect=Exception("Docker unreachable"))

        with (
            patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
            patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
            patch("agents.services.reconcile._mark_error", new_callable=AsyncMock, side_effect=lambda aid, **kw: agent),
            patch("agents.services.reconcile.fail_active_lifecycle_attempts", new_callable=AsyncMock),
            patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock),
            patch("agents.runtimes.get_runtime", return_value=mock_runtime),
        ):
            await _detect_stuck_deploys(timezone.now())

        mock_terminate.assert_awaited_once()

    async def test_modal_runtime_not_probed(self):
        """Non-docker runtimes skip the liveness probe (no container to check)."""
        agent = _make_agent(
            runtime="modal",
            updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
        )
        mock_terminate, mock_runtime = await self._run([agent])

        # Modal agents don't get the Docker liveness probe
        mock_runtime.get_status.assert_not_awaited()
        mock_terminate.assert_awaited_once()


@pytest.mark.asyncio
async def test_reconciler_mark_error_routes_through_shared_runtime_unavailable_helper():
    marked = SimpleNamespace(id="agent-1")

    with patch(
        "agents.services.reconcile.mark_agent_runtime_unavailable",
        new_callable=AsyncMock,
        return_value=marked,
    ) as mock_mark:
        from agents.services.reconcile import _mark_error

        result = await _mark_error("agent-1", error_message="container died")

    assert result is marked
    mock_mark.assert_awaited_once_with(
        "agent-1",
        reason=REASON_RECONCILER_DEAD_RUNTIME,
        error_message="container died",
    )


@pytest.mark.asyncio
async def test_detect_dead_containers_marks_missing_runtime_explicitly():
    written_diagnostics = {}
    machine = SimpleNamespace(
        runtime_log_tail=lambda limit=10: [],
        write_runtime_diagnostics=lambda payload: written_diagnostics.update(payload),
    )
    agent = SimpleNamespace(
        id="agent-1",
        name="test-agent",
        sandbox_id="missing-container",
        runtime="docker",
        status=AgentStatus.IDLE,
        project_id="project-1",
        runtime_status_projection={"runtime_state": "ready"},
        machine=machine,
        volume=machine,
    )
    marked = SimpleNamespace(id="agent-1", name="test-agent", project_id="project-1")
    mock_runtime = AsyncMock()
    mock_runtime.get_status = AsyncMock(return_value="missing")
    mock_runtime.get_crash_info = AsyncMock(return_value=None)
    mock_runtime.get_event_tail = AsyncMock(return_value=[])

    with (
        patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
        patch("agents.services.reconcile._mark_error", new_callable=AsyncMock, return_value=marked) as mock_mark_error,
        patch("agents.services.reconcile.fail_active_lifecycle_attempts", new_callable=AsyncMock) as mock_fail_attempt,
        patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock),
        patch("agents.services.reconcile.create_feed_item", new_callable=AsyncMock),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        await _detect_dead_containers()

    mock_mark_error.assert_awaited_once_with(
        "agent-1",
        error_message="Runtime container is missing",
        reason=REASON_RECONCILER_RUNTIME_MISSING,
    )
    mock_fail_attempt.assert_awaited_once()
    assert written_diagnostics["container_status"] == "missing"
    assert written_diagnostics["runtime_status"] == {"runtime_state": "ready"}


@pytest.mark.asyncio
async def test_detect_dead_containers_includes_last_runtime_event_for_missing_runtime():
    written_diagnostics = {}
    machine = SimpleNamespace(
        runtime_log_tail=lambda limit=10: [
            {"event": "provisioning.release_complete"},
            {"event": "runtime.booting"},
            {"event": "transport.connected"},
        ],
        write_runtime_diagnostics=lambda payload: written_diagnostics.update(payload),
    )
    agent = SimpleNamespace(
        id="agent-1",
        name="test-agent",
        sandbox_id="missing-container",
        runtime="docker",
        status=AgentStatus.IDLE,
        project_id="project-1",
        runtime_status_projection={"runtime_state": "stopped"},
        machine=machine,
        volume=machine,
    )
    marked = SimpleNamespace(id="agent-1", name="test-agent", project_id="project-1")
    mock_runtime = AsyncMock()
    mock_runtime.get_status = AsyncMock(return_value="missing")
    mock_runtime.get_crash_info = AsyncMock(return_value=None)
    mock_runtime.get_event_tail = AsyncMock(return_value=[{"action": "kill", "signal": "15"}])

    with (
        patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
        patch("agents.services.reconcile._mark_error", new_callable=AsyncMock, return_value=marked) as mock_mark_error,
        patch("agents.services.reconcile.fail_active_lifecycle_attempts", new_callable=AsyncMock),
        patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock),
        patch("agents.services.reconcile.create_feed_item", new_callable=AsyncMock) as mock_feed_item,
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        await _detect_dead_containers()

    mock_mark_error.assert_awaited_once_with(
        "agent-1",
        error_message="Runtime container is missing\nLast runtime event: transport.connected\nLast docker action: kill",
        reason=REASON_RECONCILER_RUNTIME_MISSING,
    )
    mock_feed_item.assert_awaited_once()
    assert mock_feed_item.await_args.kwargs["text"] == "Runtime container is missing"
    assert written_diagnostics["docker_event_tail"] == [{"action": "kill", "signal": "15"}]


@pytest.mark.asyncio
async def test_detect_runtime_limbo_marks_connected_nonready_agent_error():
    agent = SimpleNamespace(
        id="agent-1",
        name="test-agent",
        status=AgentStatus.IDLE,
        desired_status="deployed",
        relay_connected=True,
        sandbox_id="sb-123",
        vnc_url="ws://vnc",
        runtime_status_projection={},
        updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
    )
    marked = SimpleNamespace(id="agent-1", name="test-agent")

    with (
        patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
        patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
        patch("agents.services.reconcile._mark_error", new_callable=AsyncMock, return_value=marked) as mock_mark_error,
        patch("agents.services.reconcile.fail_active_lifecycle_attempts", new_callable=AsyncMock) as mock_fail_attempt,
        patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
    ):
        await _detect_runtime_limbo(timezone.now())

    mock_terminate.assert_awaited_once()
    mock_mark_error.assert_awaited_once_with(
        "agent-1",
        error_message="Relay connected but runtime never reached ready state",
        reason=REASON_RECONCILER_RUNTIME_LIMBO,
    )
    mock_fail_attempt.assert_awaited_once()
    mock_broadcast.assert_awaited_once_with(marked)


@pytest.mark.asyncio
async def test_detect_runtime_limbo_skips_ready_agent():
    agent = SimpleNamespace(
        id="agent-1",
        name="test-agent",
        status=AgentStatus.IDLE,
        desired_status="deployed",
        relay_connected=True,
        sandbox_id="sb-123",
        vnc_url="ws://vnc",
        runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
    )

    with (
        patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
        patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
        patch("agents.services.reconcile._mark_error", new_callable=AsyncMock) as mock_mark_error,
    ):
        await _detect_runtime_limbo(timezone.now())

    mock_terminate.assert_not_awaited()
    mock_mark_error.assert_not_awaited()


@pytest.mark.asyncio
async def test_detect_active_relay_disconnect_marks_non_converged_agent_error():
    agent = SimpleNamespace(
        id="agent-1",
        name="test-agent",
        project_id="project-1",
        status=AgentStatus.IDLE,
        desired_status="deployed",
        relay_connected=False,
        relay_disconnected_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 10),
        sandbox_id="sb-123",
        vnc_url="ws://vnc",
        runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        updated_at=timezone.now() - timedelta(seconds=DEPLOY_GRACE_S + 30),
        is_converged=False,
    )
    marked = SimpleNamespace(id="agent-1", name="test-agent")

    with (
        patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
        patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
        patch("agents.services.reconcile._mark_error", new_callable=AsyncMock, return_value=marked) as mock_mark_error,
        patch("agents.services.reconcile.fail_active_lifecycle_attempts", new_callable=AsyncMock) as mock_fail_attempt,
        patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
    ):
        await _detect_active_relay_disconnect(timezone.now())

    mock_terminate.assert_awaited_once()
    mock_mark_error.assert_awaited_once_with(
        "agent-1",
        error_message="Agent remains active while relay is disconnected and the agent is not converged",
        reason=REASON_RECONCILER_RELAY_DISCONNECTED,
    )
    mock_fail_attempt.assert_awaited_once()
    mock_broadcast.assert_awaited_once_with(marked)


class TestReapOrphans:
    """Unit tests for orphan reaper — verifies sandbox_id + agent.id label matching.

    The TOCTOU race: agent is DEPLOYING with sandbox_id="" (container exists
    but sandbox_id not yet written to DB). Without the agent.id label check,
    the orphan reaper would kill the container because its ID doesn't match
    any active_sandbox_ids (which contains "" for the deploying agent).

    These tests mock the data into the vulnerable state and verify the reaper
    handles it correctly — no actual concurrency needed.
    """

    def _make_container(self, container_id="container-xyz", labels=None):
        """Build a mock Docker container."""
        c = MagicMock()
        c.id = container_id
        c.labels = labels or {"agentobox.managed": "true"}
        return c

    def _make_queryset(self, agents):
        """Build a mock Agent queryset with values_list support."""
        qs = MagicMock()
        def values_list_side_effect(field, flat=False):
            inner = MagicMock()
            if field == "sandbox_id":
                inner.__iter__ = lambda s: iter(a.sandbox_id for a in agents)
            elif field == "id":
                inner.__iter__ = lambda s: iter(a.id for a in agents)
            return inner
        qs.values_list = MagicMock(side_effect=values_list_side_effect)
        return qs

    @patch("agents.services.reconcile.Agent.objects")
    @patch("agents.runtimes.get_runtime")
    def test_deploying_agent_empty_sandbox_not_reaped(self, mock_get_runtime, mock_objects):
        """TOCTOU regression: container with agent.id label matching DEPLOYING
        agent with sandbox_id='' must NOT be reaped."""
        agent = _make_agent(sandbox_id="", agent_id="agent-deploy-1")
        container = self._make_container(
            container_id="new-container-123",
            labels={
                "agentobox.managed": "true",
                "agentobox.agent.id": "agent-deploy-1",
            },
        )

        mock_client = MagicMock()
        mock_client.containers.list.return_value = [container]
        mock_runtime = MagicMock()
        mock_runtime._client = mock_client
        mock_get_runtime.return_value = mock_runtime

        mock_objects.filter.return_value = self._make_queryset([agent])

        # Call the underlying sync function directly (unwrap @_db decorator)
        _reap_orphans_sync.__wrapped__()

        container.stop.assert_not_called()
        container.remove.assert_not_called()

    @patch("agents.services.reconcile.Agent.objects")
    @patch("agents.runtimes.get_runtime")
    def test_true_orphan_reaped(self, mock_get_runtime, mock_objects):
        """Container with no matching sandbox_id or agent.id label → reaped."""
        agent = _make_agent(sandbox_id="other-container", agent_id="agent-alive")
        container = self._make_container(
            container_id="orphan-container-456",
            labels={
                "agentobox.managed": "true",
                "agentobox.agent.id": "agent-long-gone",
            },
        )

        mock_client = MagicMock()
        mock_client.containers.list.return_value = [container]
        mock_runtime = MagicMock()
        mock_runtime._client = mock_client
        mock_get_runtime.return_value = mock_runtime

        mock_objects.filter.return_value = self._make_queryset([agent])

        _reap_orphans_sync.__wrapped__()

        container.stop.assert_called_once_with(timeout=5)
        container.remove.assert_called_once_with(force=True)

    @patch("agents.services.reconcile.Agent.objects")
    @patch("agents.runtimes.get_runtime")
    def test_container_matched_by_sandbox_id_survives(self, mock_get_runtime, mock_objects):
        """Normal case: container.id matches active sandbox_id → not reaped."""
        agent = _make_agent(sandbox_id="container-normal-789", agent_id="agent-normal")
        container = self._make_container(
            container_id="container-normal-789",
            labels={"agentobox.managed": "true"},
        )

        mock_client = MagicMock()
        mock_client.containers.list.return_value = [container]
        mock_runtime = MagicMock()
        mock_runtime._client = mock_client
        mock_get_runtime.return_value = mock_runtime

        mock_objects.filter.return_value = self._make_queryset([agent])

        _reap_orphans_sync.__wrapped__()

        container.stop.assert_not_called()
        container.remove.assert_not_called()

    @patch("agents.services.reconcile.Agent.objects")
    @patch("agents.runtimes.get_runtime")
    def test_no_label_no_sandbox_match_reaped(self, mock_get_runtime, mock_objects):
        """Container without agent.id label and no sandbox_id match → reaped."""
        agent = _make_agent(sandbox_id="different-container", agent_id="agent-other")
        container = self._make_container(
            container_id="stale-container-000",
            labels={"agentobox.managed": "true"},  # no agentobox.agent.id label
        )

        mock_client = MagicMock()
        mock_client.containers.list.return_value = [container]
        mock_runtime = MagicMock()
        mock_runtime._client = mock_client
        mock_get_runtime.return_value = mock_runtime

        mock_objects.filter.return_value = self._make_queryset([agent])

        _reap_orphans_sync.__wrapped__()

        container.stop.assert_called_once_with(timeout=5)
        container.remove.assert_called_once_with(force=True)


@pytest.mark.asyncio
@pytest.mark.chaos
class TestErrorReapDebugMode:
    """Failure-injection coverage for errored-agent cleanup behavior."""

    async def test_keep_failed_containers_skips_reap(self, monkeypatch):
        from config.app_config import app_config
        monkeypatch.setattr(app_config.reconciler, "keep_failed_containers", True)
        agent = _make_agent(agent_id="error-agent-1")

        with (
            patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
            patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
            patch("agents.services.reconcile._mark_stopped", new_callable=AsyncMock) as mock_mark_stopped,
            patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
        ):
            await _reap_errored_agents(timezone.now())

        mock_terminate.assert_not_awaited()
        mock_mark_stopped.assert_not_awaited()
        mock_broadcast.assert_not_awaited()

    async def test_default_mode_reaps_failed_agents(self, monkeypatch):
        from config.app_config import app_config
        monkeypatch.setattr(app_config.reconciler, "keep_failed_containers", False)
        agent = _make_agent(agent_id="error-agent-2")

        with (
            patch("agents.services.reconcile._get_agents", new_callable=AsyncMock, return_value=[agent]),
            patch("agents.services.reconcile.terminate_sandbox", new_callable=AsyncMock) as mock_terminate,
            patch("agents.services.reconcile._mark_stopped", new_callable=AsyncMock, return_value=agent) as mock_mark_stopped,
            patch("agents.services.reconcile.broadcast_agent_update", new_callable=AsyncMock) as mock_broadcast,
        ):
            await _reap_errored_agents(timezone.now())

        mock_terminate.assert_awaited_once()
        mock_mark_stopped.assert_awaited_once_with(
            agent.id,
            reason="reconciler.error_reap",
        )
        mock_broadcast.assert_awaited_once_with(agent)
