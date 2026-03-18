"""Agent boot health e2e tests.

Runtime-agnostic bootstrap smoke: all assertions go through GraphQL.
Docker container access is used only for diagnostic log collection on
failure, never for assertions. This suite works identically against
Docker (local CI) and Modal (post-deploy).

Verifies:
  1. backend can create and provision an agent
  2. the managed runtime reaches idle with relay connected
  3. agent can be killed and reaches stopped
"""

from __future__ import annotations

import os
import uuid

import pytest

from helpers.graphql import AboxGraphQL
from helpers.polling import poll_agent_status

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")
SMOKE_RUNTIME = os.environ.get("SMOKE_RUNTIME", "docker")

pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]

# Timeouts
BOOT_TIMEOUT_S = 120
BOOT_POLL_INTERVAL_S = 3


@pytest.mark.bootstrap
class TestAgentBoot:
    """Verify an agent boots and reaches idle via GraphQL polling."""

    @pytest.fixture(scope="class")
    def booted_agent(self, auth_token, test_project):
        """Create one agent for all boot tests. Cleaned up after class."""
        gql = AboxGraphQL(API_URL, auth_token)

        agent_name = f"e2e-boot-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            test_project["id"],
            name=agent_name,
            instructions="You are an e2e boot test agent by Vahid Eyorokon. Wait for instructions.",
        )
        agent_id = agent["id"]

        # Wait for idle — proves provisioning + relay connect worked
        idle_agent = poll_agent_status(
            gql,
            agent_id,
            target_statuses=["idle"],
            timeout_s=BOOT_TIMEOUT_S,
            interval_s=BOOT_POLL_INTERVAL_S,
        )

        yield {"agent": idle_agent, "gql": gql}

        # Cleanup
        try:
            gql.kill_agent(agent_id)
        except Exception:
            pass
        try:
            gql.remove_agent(agent_id)
        except Exception:
            pass
        gql.close()

    def test_agent_reached_idle(self, booted_agent):
        """Agent must reach idle status after boot."""
        agent = booted_agent["agent"]
        assert agent["lifecycleStatus"] == "idle"

    def test_relay_connected(self, booted_agent):
        """Relay must be connected when agent is idle."""
        agent = booted_agent["agent"]
        assert agent["relayConnected"] is True

    def test_no_error_message(self, booted_agent):
        """Agent should have no error after clean boot."""
        agent = booted_agent["agent"]
        assert not agent.get("errorMessage"), (
            f"Agent has error after boot: {agent.get('errorMessage')}"
        )

    def test_agent_can_be_killed(self, booted_agent):
        """Killing an idle agent should transition it to stopped."""
        gql = booted_agent["gql"]
        agent_id = booted_agent["agent"]["id"]

        gql.kill_agent(agent_id)
        stopped = poll_agent_status(
            gql,
            agent_id,
            target_statuses=["stopped"],
            timeout_s=30,
            interval_s=2,
        )
        assert stopped["lifecycleStatus"] == "stopped"
