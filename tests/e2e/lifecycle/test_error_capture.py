"""
Agent error capture e2e tests.

Tests the error detection pipeline: container dies → reconciliation loop
detects "exited" container via docker inspect → backend marks agent ERROR
with crash info (exit code, OOM status, last log lines) → TeamFeedItem
created with type=error.

Chain under test:
  container.stop() → container state "exited" →
  reconcile._detect_dead_containers() → runtime.get_crash_info() →
  _mark_error(agent_id, error_message) → TeamFeedItem(type=error)

We stop the entire container (not just kill processes inside it) because
s6-overlay keeps the container alive when individual processes die, and
the reconciliation loop only checks container-level state.

Note: when processes die inside a running container (relay dies but s6
keeps container alive), the agent gets stuck idle — a separate issue from
container-level death detection tested here.

Run:
  make test-e2e-agents
  # or directly:
  uv run --group e2e pytest tests/e2e/lifecycle/test_error_capture.py -v

Requires: docker compose stack running with backend + agent image available.
"""

from __future__ import annotations

import uuid

import pytest

from helpers.polling import poll_agent_status, poll_feed_for

pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]

# Reconciliation loop runs every 30s. Give margin for one full cycle + processing.
ERROR_POLL_TIMEOUT_S = 75
ERROR_POLL_INTERVAL_S = 3


class TestErrorCapture:
    """Verify that stopping an agent container produces the correct error
    state, persisted error message, and error feed item."""

    def _create_and_wait(self, gql, test_project):
        """Create an agent with a unique name and wait for it to be ready."""
        agent_name = f"e2e-error-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            test_project["id"],
            name=agent_name,
            instructions="You are an e2e test agent. Wait for instructions.",
        )
        ready_agent = poll_agent_status(
            gql,
            agent["id"],
            target_statuses=["idle", "running", "waiting"],
            timeout_s=90,
            interval_s=3,
        )
        return ready_agent

    def _crash_agent_container(self, docker_ops, agent):
        """Find and stop the agent's container to simulate a crash.

        Stopping the container makes it state="exited", which the
        reconciliation loop detects and marks as ERROR.
        """
        container = docker_ops.find_agent_container(agent["name"], agent_id=agent["id"])
        assert container is not None, (
            f"Could not find container for agent {agent['name']}. "
            f"Running containers: "
            f"{[c.name for c in docker_ops._client.containers.list()]}"
        )
        docker_ops.stop_container(container.id, timeout=1)

    def _cleanup_agent(self, gql, agent_id):
        """Best-effort agent cleanup."""
        try:
            gql.kill_agent(agent_id)
        except Exception:
            pass
        try:
            gql.remove_agent(agent_id)
        except Exception:
            pass

    def test_container_stop_sets_error_status(
        self, gql, test_project, docker_ops
    ):
        """Stopping the container should transition the agent to error status."""
        agent = self._create_and_wait(gql, test_project)
        agent_id = agent["id"]
        try:
            self._crash_agent_container(docker_ops, agent)

            errored = poll_agent_status(
                gql,
                agent_id,
                target_statuses=["error"],
                timeout_s=ERROR_POLL_TIMEOUT_S,
                interval_s=ERROR_POLL_INTERVAL_S,
            )
            assert errored["lifecycleStatus"] == "error"
        finally:
            self._cleanup_agent(gql, agent_id)

    def test_error_message_persisted(self, gql, test_project, docker_ops):
        """Error message should be persisted on the agent record after crash."""
        agent = self._create_and_wait(gql, test_project)
        agent_id = agent["id"]
        try:
            self._crash_agent_container(docker_ops, agent)

            errored = poll_agent_status(
                gql,
                agent_id,
                target_statuses=["error"],
                timeout_s=ERROR_POLL_TIMEOUT_S,
                interval_s=ERROR_POLL_INTERVAL_S,
            )
            assert errored["errorMessage"], (
                "Expected non-empty errorMessage after container stop, "
                f"got: {errored['errorMessage']!r}"
            )
        finally:
            self._cleanup_agent(gql, agent_id)

    def test_error_status_feed_item_created(self, gql, test_project, docker_ops):
        """A status transition feed item (to=error) should appear after crash.

        Reconciliation creates both status-type feed items (idle→error) and
        error-type feed items with crash diagnostics.
        """
        agent = self._create_and_wait(gql, test_project)
        agent_id = agent["id"]
        agent_name = agent["name"]
        try:
            self._crash_agent_container(docker_ops, agent)

            def is_error_transition_for_agent(item):
                return (
                    item.get("type") == "status"
                    and item.get("agent") == agent_name
                    and item.get("to") == "error"
                )

            status_item = poll_feed_for(
                gql,
                test_project["id"],
                predicate=is_error_transition_for_agent,
                timeout_s=ERROR_POLL_TIMEOUT_S,
                interval_s=ERROR_POLL_INTERVAL_S,
                description=f"error status transition for agent {agent_name}",
            )
            assert status_item["type"] == "status"
            assert status_item["to"] == "error"
            assert status_item["agent"] == agent_name
        finally:
            self._cleanup_agent(gql, agent_id)
