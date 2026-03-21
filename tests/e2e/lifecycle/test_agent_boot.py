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
import sys
import uuid

import pytest

from helpers.graphql import AboxGraphQL
from helpers.polling import AgentTerminalError, PollTimeout, poll_agent_status

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from diagnosis import Diagnosis

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")
SMOKE_RUNTIME = os.environ.get("SMOKE_RUNTIME", "docker")

pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]

# Timeouts
BOOT_TIMEOUT_S = 120
BOOT_POLL_INTERVAL_S = 3


def _build_bootstrap_diagnosis(agent_dict, *, seam, contract, observed_steps, next_debug_target=""):
    """Build and write a structured failure diagnosis artifact for bootstrap."""
    diag = Diagnosis(
        job="agent-bootstrap",
        seam=seam,
        contract=contract,
        next_debug_target=next_debug_target,
    )

    for step in observed_steps:
        diag.expect(step, True)
    for step, value in observed_steps.items():
        diag.observe(step, value)

    agent_id = agent_dict.get("id", "") if agent_dict else ""
    diag.set_ids(agent_id=agent_id)
    diag.set_refs(runtime=SMOKE_RUNTIME)

    if agent_dict:
        diag.refs["agent_status"] = agent_dict.get("lifecycleStatus", "")
        diag.refs["relay_connected"] = str(agent_dict.get("relayConnected", ""))
        diag.refs["error_message"] = agent_dict.get("errorMessage", "")

        # Include lifecycle attempt details if available
        attempts = agent_dict.get("lifecycleAttempts", [])
        if attempts:
            latest = attempts[0]
            diag.refs["attempt_step"] = latest.get("step", "")
            diag.refs["attempt_status"] = latest.get("status", "")
            diag.refs["attempt_error_code"] = latest.get("errorCode", "")
            diag.refs["attempt_error_detail"] = latest.get("errorDetail", "")

    path = diag.write("failure-diagnosis-agent-bootstrap")
    return diag, path


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
        try:
            idle_agent = poll_agent_status(
                gql,
                agent_id,
                target_statuses=["idle"],
                timeout_s=BOOT_TIMEOUT_S,
                interval_s=BOOT_POLL_INTERVAL_S,
            )
        except AgentTerminalError as exc:
            # Agent hit error/failed — immediate diagnosis
            _build_bootstrap_diagnosis(
                exc.agent,
                seam="agent_provisioning",
                contract="agent must reach idle after create (provision + relay connect)",
                observed_steps={
                    "agent_created": True,
                    "status_not_terminal": False,
                    "relay_connected": bool(exc.agent.get("relayConnected")),
                    "status_idle": False,
                },
                next_debug_target=(
                    f"agent reached terminal state '{exc.agent.get('lifecycleStatus')}': "
                    f"check lifecycle attempts and error message"
                ),
            )
            raise
        except PollTimeout as exc:
            # Timed out — fetch latest agent state for diagnosis
            latest = exc.last_value or {}
            _build_bootstrap_diagnosis(
                latest,
                seam="agent_provisioning",
                contract="agent must reach idle within timeout",
                observed_steps={
                    "agent_created": True,
                    "status_not_terminal": latest.get("lifecycleStatus") not in ("error", "failed", "crashed"),
                    "relay_connected": bool(latest.get("relayConnected")),
                    "status_idle": latest.get("lifecycleStatus") == "idle",
                },
                next_debug_target=(
                    f"agent stuck in '{latest.get('lifecycleStatus', 'unknown')}' after {BOOT_TIMEOUT_S}s: "
                    f"check container status and relay logs"
                ),
            )
            raise

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
