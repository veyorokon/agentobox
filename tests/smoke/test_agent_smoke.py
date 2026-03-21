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
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from helpers.polling import poll_until
from diagnosis import Diagnosis

# Timeouts — generous because cold boot + LLM inference can be slow.
BOOT_TIMEOUT_S = 120
RESPONSE_TIMEOUT_S = 180
SMOKE_RUNTIME = os.environ.get("SMOKE_RUNTIME", "docker")

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


def _build_smoke_diagnosis(
    gql, docker_ops, agent_id, agent_name, project_id,
    *, seam, contract, observed_steps, next_debug_target="",
):
    """Build and write a structured failure diagnosis artifact.

    observed_steps: dict of step_name → observed_value.
    Expected values are always True (each step should succeed).
    """
    diag = Diagnosis(
        job="agent-smoke",
        seam=seam,
        contract=contract,
        next_debug_target=next_debug_target,
    )

    # All steps in the smoke path are expected to be True
    for step in observed_steps:
        diag.expect(step, True)
    for step, value in observed_steps.items():
        diag.observe(step, value)

    diag.set_ids(agent_id=agent_id or "", project_id=project_id or "")
    diag.set_refs(runtime=SMOKE_RUNTIME)

    # Enrich with agent snapshot if available
    try:
        agent_snapshot = gql.query_agent(agent_id) if agent_id else None
        if agent_snapshot:
            diag.set_ids(sandbox_id=agent_snapshot.get("sandboxId", ""))
            diag.refs["agent_status"] = agent_snapshot.get("lifecycleStatus", "")
            diag.refs["relay_connected"] = str(agent_snapshot.get("relayConnected", ""))
            diag.refs["error_message"] = agent_snapshot.get("errorMessage", "")
    except Exception:
        pass

    path = diag.write("failure-diagnosis-agent-smoke")
    return diag, path


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------


class TestAgentSmoke:
    """Full lifecycle smoke test against the auto-created team lead."""

    SMOKE_TOKEN = f"SMOKE_OK_{uuid.uuid4().hex[:12]}"

    @pytest.fixture(scope="class")
    def smoke_agent(self, gql, smoke_project, docker_ops):
        """Use the project's auto-created team lead and wait for it to be ready."""
        project_id = smoke_project["id"]

        def _team_lead_ready():
            rows = gql.query_agents(project_id)
            for row in rows:
                if row.get("name") == "team-lead":
                    return row
            return None

        try:
            idle_agent = poll_until(
                _team_lead_ready,
                lambda agent: bool(
                    agent
                    and agent.get("lifecycleStatus") == "idle"
                    and agent.get("relayConnected")
                ),
                timeout_s=BOOT_TIMEOUT_S,
                interval_s=3,
                description=f"team-lead for project {project_id} ready",
            )
        except Exception:
            # Emit structured diagnosis before failing
            _build_smoke_diagnosis(
                gql, docker_ops, "", "team-lead", project_id,
                seam="agent_boot",
                contract="team-lead must reach idle with relay connected",
                observed_steps={
                    "team_lead_exists": _team_lead_ready() is not None,
                    "status_idle": False,
                    "relay_connected": False,
                },
                next_debug_target="check agent lifecycle attempts and container logs",
            )
            artifacts = _collect_failure_artifacts(
                gql, docker_ops, "", "team-lead", ""
            )
            pytest.fail(
                f"Team lead failed to reach idle within {BOOT_TIMEOUT_S}s.{artifacts}"
            )

        agent_id = idle_agent["id"]

        yield {
            "agent": idle_agent,
            "agent_id": agent_id,
            "agent_name": "team-lead",
            "project_id": project_id,
        }

    # -- Round-trip smoke --

    def test_message_round_trip(self, gql, smoke_agent, docker_ops):
        """Send a deterministic prompt, assert exact response in feed.

        This is the core smoke test. It proves the full chain:
          dashboard → GraphQL → backend → Channels → relay WS →
          Claude Code SDK → LLM → SDK → relay → backend → feed
        """
        agent_id = smoke_agent["agent_id"]
        project_id = smoke_agent["project_id"]

        # Track each step of the message send path
        steps = {
            "mutation_accepted": False,
            "agent_running_or_idle": False,
            "feed_response_seen": False,
            "smoke_token_in_response": False,
        }

        # Step 1: Send deterministic prompt
        try:
            result = gql.send_message(
                project_id,
                text=(
                    f"Respond with exactly this text and nothing else: {self.SMOKE_TOKEN}"
                ),
                recipients=[{"type": "agent", "value": agent_id}],
            )
            steps["mutation_accepted"] = bool(result)
        except Exception:
            _build_smoke_diagnosis(
                gql, docker_ops, agent_id, smoke_agent["agent_name"], project_id,
                seam="send_message_to_runtime",
                contract="sendMessage mutation must accept and deliver message",
                observed_steps=steps,
                next_debug_target="check GraphQL error response and agent recipient resolution",
            )
            raise

        if not steps["mutation_accepted"]:
            diag, path = _build_smoke_diagnosis(
                gql, docker_ops, agent_id, smoke_agent["agent_name"], project_id,
                seam="send_message_to_runtime",
                contract="sendMessage mutation must return true (recipient resolved, inbox written, reload sent)",
                observed_steps=steps,
                next_debug_target="check recipient resolution — agent may not exist or status may prevent delivery",
            )
            pytest.fail(
                f"sendMessage returned False. Diagnosis: {path}\n"
                + "\n".join(diag.summary_lines())
            )

        # Step 2: Verify agent is processing (check status)
        try:
            agent_state = gql.query_agent(agent_id)
            if agent_state:
                steps["agent_running_or_idle"] = agent_state.get("lifecycleStatus") in (
                    "running", "idle", "waiting",
                )
        except Exception:
            pass  # non-fatal — continue to feed poll

        # Step 3: Wait for a response feed item from this agent
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
            steps["feed_response_seen"] = True
        except Exception:
            _build_smoke_diagnosis(
                gql, docker_ops, agent_id, smoke_agent["agent_name"], project_id,
                seam="send_message_to_runtime",
                contract="message sent to agent must produce feed response within timeout",
                observed_steps=steps,
                next_debug_target="check relay logs for inbox processing and SDK query invocation",
            )
            artifacts = _collect_failure_artifacts(
                gql, docker_ops, agent_id,
                smoke_agent["agent_name"], "",
            )
            pytest.fail(
                f"No response from agent within {RESPONSE_TIMEOUT_S}s.{artifacts}"
            )

        # Step 4: Verify smoke token in response
        response_texts = [
            (item.get("text") or "") + (item.get("summary") or "")
            for item in agent_responses
        ]
        token_found = any(self.SMOKE_TOKEN in text for text in response_texts)
        steps["smoke_token_in_response"] = token_found

        if not token_found:
            _build_smoke_diagnosis(
                gql, docker_ops, agent_id, smoke_agent["agent_name"], project_id,
                seam="agent_response_content",
                contract="agent response must contain the smoke token",
                observed_steps=steps,
                next_debug_target="check agent response content — LLM may have reformatted or refused",
            )
            pytest.fail(
                f"Smoke token '{self.SMOKE_TOKEN}' not found in agent responses. "
                f"Got: {response_texts}"
            )

    # -- Incident capture canary --

    def test_incident_capture(self, gql, smoke_agent):
        """Canary: captureIncident mutation produces a stored bundle.

        Proves the incident capture system works end-to-end against the
        deployed environment. Verifies both mutation acceptance and that
        the stored bundle has the expected desired/observed/applied structure.
        """
        agent_id = smoke_agent["agent_id"]
        project_id = smoke_agent["project_id"]

        # Step 1: capture the incident
        result = gql.capture_incident(agent_id, note="canary smoke test")

        assert result.get("incidentId"), (
            f"captureIncident did not return an incidentId: {result}"
        )
        assert result.get("agentId") == agent_id
        assert result.get("projectId") == project_id
        assert result.get("createdAt")

        # Step 2: retrieve the stored bundle and verify structure
        incident = gql.query_incident(result["incidentId"])

        assert incident is not None, (
            f"incident query returned None for {result['incidentId']}"
        )
        bundle = incident.get("bundle", {})
        assert isinstance(bundle, dict), f"bundle is not a dict: {type(bundle)}"

        # Verify the three diagnosis layers exist
        for key in ("desired", "observed", "applied"):
            assert key in bundle, (
                f"bundle missing '{key}' layer — incident capture contract broken"
            )

        # Verify key identifiers
        ids = bundle.get("ids", {})
        assert ids.get("agent_id") == agent_id
        assert ids.get("project_id") == project_id
