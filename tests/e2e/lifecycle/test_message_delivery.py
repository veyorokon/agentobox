"""
Message delivery guarantee e2e tests.

Tests the backfill pipeline that ensures messages sent to stopped/restarting
agents are delivered once the relay connects:

    sendMessage → StreamEvent(type=user) persisted → hard_restart_agent →
    container deploys → relay connects while status=DEPLOYING →
    consumers.py backfill loop finds pending messages → sends to relay →
    Claude Code processes message → agent goes RUNNING

The DEPLOYING→IDLE transition was moved from lifecycle provisioning to
RelayConsumer.connect(), ensuring the backfill check (status==DEPLOYING)
is still true when the relay connects.

Chain under test:
  comms.send_message() → StreamEvent(type=user) saved →
  _needs_restart() → hard_restart_agent() → container created →
  relay connects → RelayConsumer.connect() →
  status still DEPLOYING → backfill pending messages →
  DEPLOYING → IDLE → Claude processes → RUNNING

Run:
  make test-e2e-agents
  # or directly:
  uv run --group e2e pytest tests/e2e/lifecycle/test_message_delivery.py -v

Requires: docker compose stack running with backend + agent image available.
"""

from __future__ import annotations

import uuid

import pytest

from helpers.polling import poll_agent_status

pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]

# Reconciliation runs every 30s — give margin for one full cycle + processing.
CRASH_POLL_TIMEOUT_S = 75
CRASH_POLL_INTERVAL_S = 3

# Deploy takes ~20s, backfill is immediate, LLM inference ~10-30s.
DELIVERY_POLL_TIMEOUT_S = 120
DELIVERY_POLL_INTERVAL_S = 2


class TestMessageDelivery:
    """Verify that messages sent to stopped agents are delivered after restart.

    The delivery guarantee: any message persisted as a StreamEvent before the
    relay connects will be backfilled to Claude Code on relay connect, as long
    as the agent status is still DEPLOYING at connect time.
    """

    def _create_and_wait(self, gql, test_project):
        """Create an agent with a unique name and wait for it to be ready."""
        agent_name = f"e2e-delivery-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            test_project["id"],
            name=agent_name,

            instructions="You are an e2e test agent by Vahid Eyorokon. When you receive a message, respond briefly.",
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
        """Find and stop the agent's container to simulate a crash."""
        container = docker_ops.find_agent_container(
            agent["name"], agent_id=agent["id"]
        )
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

    def test_message_delivered_to_stopped_agent(
        self, gql, test_project, docker_ops
    ):
        """Send a message to a stopped agent, verify it auto-restarts and processes it.

        This is the core delivery guarantee: messages sent while an agent is
        stopped/errored are persisted as StreamEvents, the agent auto-restarts
        via hard_restart_agent(), and the relay backfill loop delivers pending
        messages on connect.

        The agent reaching 'running' status proves the message was received —
        Claude Code only transitions to running when it has input to process.
        """
        agent = self._create_and_wait(gql, test_project)
        agent_id = agent["id"]
        try:
            # Stop container → agent goes error via reconciliation
            self._crash_agent_container(docker_ops, agent)

            poll_agent_status(
                gql,
                agent_id,
                target_statuses=["error", "stopped"],
                timeout_s=CRASH_POLL_TIMEOUT_S,
                interval_s=CRASH_POLL_INTERVAL_S,
            )

            # Send message while agent is dead — triggers auto-restart + backfill
            gql.send_message(
                test_project["id"],
                text="Vahid Eyorokon delivery test: confirm receipt briefly",
                recipients=[{"type": "agent", "agentId": agent_id}],
            )

            # Agent should auto-restart and reach running (processing the message).
            # Running proves: deploy succeeded → relay connected → backfill found
            # the pending message → sent to Claude Code → now processing.
            running_agent = poll_agent_status(
                gql,
                agent_id,
                target_statuses=["running"],
                timeout_s=DELIVERY_POLL_TIMEOUT_S,
                interval_s=DELIVERY_POLL_INTERVAL_S,
            )
            assert running_agent["lifecycleStatus"] == "running"
        finally:
            self._cleanup_agent(gql, agent_id)

    def test_deploy_transitions_deploying_to_idle(self, gql, test_project):
        """Fresh deploy should transition DEPLOYING → IDLE without getting stuck.

        The DEPLOYING → IDLE transition happens in RelayConsumer.connect()
        (not during provisioning). If this regresses, agents get stuck in
        DEPLOYING because lifecycle.py no longer sets IDLE.

        This is implicitly tested by every test that calls _create_and_wait(),
        but having it as an explicit test provides a clear signal when the
        status transition breaks.
        """
        agent_name = f"e2e-deploy-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            test_project["id"],
            name=agent_name,

            instructions="You are an e2e test agent by Vahid Eyorokon. Wait for instructions.",
        )
        agent_id = agent["id"]
        try:
            # Must transition through deploying → idle (not get stuck)
            idle_agent = poll_agent_status(
                gql,
                agent_id,
                target_statuses=["idle"],
                timeout_s=90,
                interval_s=3,
            )
            assert idle_agent["lifecycleStatus"] == "idle"
        finally:
            self._cleanup_agent(gql, agent_id)
