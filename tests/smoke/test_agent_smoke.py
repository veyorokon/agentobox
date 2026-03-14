"""
Agent deployment smoke tests.

Mechanical yes/no signal that the full agent round-trip works:
  create → provision → relay connect → health ready →
  send message → LLM response → teardown

Bootstrap-to-idle is covered separately in tests/bootstrap/.
This suite assumes bootstrap succeeds and focuses on the actual
message round-trip contract. It runs against the real runtime (Docker or
Modal) with a real API key. Not for every PR — only pre-deploy to main.

Run:
  # Docker (local dev)
  uv run --group e2e pytest tests/smoke/ -v --timeout=300

  # Modal (staging)
  SMOKE_RUNTIME=modal uv run --group e2e pytest tests/smoke/ -v --timeout=300

Requires:
  - docker compose stack running (or Modal credentials for modal runtime)
  - ANTHROPIC_API_KEY set (project must have it, or env var)
  - demo user seeded (make seed)
"""

from __future__ import annotations

import json
import os
import sys
import uuid

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "e2e"))
from helpers.polling import poll_agent_status, poll_until

# Timeouts — generous because cold boot + LLM inference can be slow.
BOOT_TIMEOUT_S = 120
RESPONSE_TIMEOUT_S = 180

pytestmark = [pytest.mark.e2e, pytest.mark.smoke]


# ---------------------------------------------------------------------------
# Failure artifact collection
# ---------------------------------------------------------------------------


def _collect_failure_artifacts(gql, docker_ops, agent_id, agent_name, health_url):
    """Collect diagnostic info on test failure. Returns a formatted string."""
    lines = ["\n=== SMOKE TEST FAILURE ARTIFACTS ===\n"]

    # 1. Agent state from backend
    try:
        agent = gql.query_agent(agent_id)
        lines.append(f"Agent state: {json.dumps(agent, indent=2)}")
    except Exception as exc:
        lines.append(f"Agent query failed: {exc}")

    # 2. Health endpoint
    if health_url:
        try:
            resp = httpx.get(f"{health_url}/status", timeout=5.0)
            lines.append(f"Health /status ({resp.status_code}): {resp.text}")
        except Exception as exc:
            lines.append(f"Health /status unreachable: {exc}")

    # 3. Container logs (Docker only)
    if docker_ops:
        try:
            container = docker_ops.find_agent_container(agent_name, agent_id=agent_id)
            if container:
                _, relay_log = docker_ops.exec_in_container(
                    container.id,
                    ["bash", "-c", "cat /run/uncaught-logs/current 2>/dev/null | tail -50"],
                )
                lines.append(f"Relay logs (last 50 lines):\n{relay_log}")
            else:
                lines.append("Container not found")
        except Exception as exc:
            lines.append(f"Container log collection failed: {exc}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------


class TestAgentSmoke:
    """Full lifecycle smoke test. One agent, three verification layers."""

    SMOKE_TOKEN = f"SMOKE_OK_{uuid.uuid4().hex[:12]}"

    @pytest.fixture(scope="class")
    def smoke_agent(self, gql, smoke_project, docker_ops):
        """Create one smoke agent. All tests in this class share it.

        The agent gets deterministic instructions: respond with an exact
        token so we can assert the full round-trip mechanically.
        """
        agent_name = f"smoke-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            smoke_project["id"],
            name=agent_name,
            model="claude-haiku-4-5-20251001",
            instructions=(
                "You are a smoke test agent by Vahid Eyorokon. "
                "When you receive ANY message, respond with EXACTLY this text "
                "and nothing else — no explanation, no formatting, no quotes:\n\n"
                f"{self.SMOKE_TOKEN}"
            ),
            mode="auto",
        )
        agent_id = agent["id"]

        # Wait for agent to reach idle (relay connected, ready for work)
        try:
            idle_agent = poll_agent_status(
                gql,
                agent_id,
                target_statuses=["idle"],
                timeout_s=BOOT_TIMEOUT_S,
                interval_s=3,
            )
        except Exception:
            artifacts = _collect_failure_artifacts(
                gql, docker_ops, agent_id, agent_name, ""
            )
            pytest.fail(f"Agent failed to reach idle within {BOOT_TIMEOUT_S}s.{artifacts}")

        yield {
            "agent": idle_agent,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "project_id": smoke_project["id"],
        }

        # Cleanup
        try:
            gql.kill_agent(agent_id)
        except Exception:
            pass
        try:
            gql.remove_agent(agent_id)
        except Exception:
            pass

    # -- Round-trip smoke --

    def test_message_round_trip(self, gql, smoke_agent, docker_ops):
        """Send a deterministic prompt, assert exact response in feed.

        This is the core smoke test. It proves the full chain:
          dashboard → GraphQL → backend → Channels → relay WS →
          Claude Code SDK → LLM → SDK → relay → backend → feed
        """
        agent_id = smoke_agent["agent_id"]
        project_id = smoke_agent["project_id"]

        # Send deterministic prompt — include the token in the message
        # so the LLM has it in context (instructions alone aren't reliable)
        gql.send_message(
            project_id,
            text=(
                f"Respond with exactly this text and nothing else: {self.SMOKE_TOKEN}"
            ),
            recipients=[{"type": "agent", "value": agent_id}],
        )

        # Wait for a response feed item from this agent.
        # Don't poll for running→idle transitions — the agent can process
        # so fast that we miss the running state entirely. Instead, poll
        # the feed directly for a response.
        def _has_agent_response():
            feed = gql.query_feed(project_id)
            return [
                item for item in feed
                if item.get("agentId") == agent_id
                and item.get("type") in ("result", "assistant", "summary")
            ]

        try:
            agent_responses = poll_until(
                _has_agent_response,
                lambda items: len(items) > 0,
                timeout_s=RESPONSE_TIMEOUT_S,
                interval_s=3,
                description=f"agent {agent_id} response in feed",
            )
        except Exception:
            artifacts = _collect_failure_artifacts(
                gql, docker_ops, agent_id,
                smoke_agent["agent_name"], "",
            )
            pytest.fail(
                f"No response from agent within {RESPONSE_TIMEOUT_S}s.{artifacts}"
            )

        # At least one response should contain the smoke token
        response_texts = [
            (item.get("text") or "") + (item.get("summary") or "")
            for item in agent_responses
        ]
        token_found = any(self.SMOKE_TOKEN in text for text in response_texts)
        assert token_found, (
            f"Smoke token '{self.SMOKE_TOKEN}' not found in agent responses. "
            f"Got: {response_texts}"
        )

    # -- Teardown verification --

    def test_agent_can_be_killed(self, gql, smoke_agent):
        """Agent can be stopped cleanly after smoke test."""
        agent_id = smoke_agent["agent_id"]
        result = gql.kill_agent(agent_id)
        assert result is True

        # Verify it transitions to stopped
        stopped = poll_agent_status(
            gql,
            agent_id,
            target_statuses=["stopped"],
            timeout_s=30,
            interval_s=2,
        )
        assert stopped["lifecycleStatus"] == "stopped"
