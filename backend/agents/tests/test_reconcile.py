"""Tests for agents.services.reconcile — stuck deploy detection.

Covers the two-tier timeout logic in _detect_stuck_deploys:
- Soft deadline (120s): skip running containers, kill dead/missing ones
- Hard deadline (300s): kill regardless of container state
"""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from django.utils import timezone

from agents.models import AgentStatus
from agents.services.reconcile import (
    DEPLOY_GRACE_S,
    DEPLOY_HARD_LIMIT_S,
    _detect_stuck_deploys,
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
