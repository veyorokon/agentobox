from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from agents.models import AgentStatus, DesiredStatus
from agents.services.non_converged import classify_non_converged_active_agent


pytestmark = pytest.mark.unit


def _agent(**overrides):
    now = timezone.now()
    base = dict(
        id="agent-1",
        project_id="project-1",
        name="test-agent",
        status=AgentStatus.IDLE,
        desired_status=DesiredStatus.DEPLOYED,
        relay_connected=True,
        relay_disconnected_at=None,
        sandbox_id="sb-123",
        updated_at=now - timedelta(seconds=180),
        runtime_status_projection={},
        is_converged=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_classify_non_converged_active_agent_detects_relay_connected_not_ready():
    agent = _agent(runtime_status_projection={})

    with patch(
        "agents.services.non_converged._derive_preview_state_safe",
        return_value="deploying",
    ):
        candidate = classify_non_converged_active_agent(
            agent,
            now=timezone.now(),
            grace_seconds=120,
        )

    assert candidate is not None
    assert candidate.signature == "relay_connected_not_ready"
    assert candidate.relay_connected is True


def test_classify_non_converged_active_agent_detects_active_relay_disconnected():
    agent = _agent(
        relay_connected=False,
        relay_disconnected_at=timezone.now() - timedelta(seconds=180),
        runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        is_converged=False,
    )

    with patch(
        "agents.services.non_converged._derive_preview_state_safe",
        return_value="ready",
    ):
        candidate = classify_non_converged_active_agent(
            agent,
            now=timezone.now(),
            grace_seconds=120,
        )

    assert candidate is not None
    assert candidate is not None
    assert candidate.signature == "active_relay_disconnected"
    assert candidate.relay_connected is False


def test_classify_non_converged_active_agent_skips_healthy_ready_agent():
    agent = _agent(
        runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        is_converged=True,
    )

    with patch(
        "agents.services.non_converged._derive_preview_state_safe",
        return_value="ready",
    ):
        candidate = classify_non_converged_active_agent(
            agent,
            now=timezone.now(),
            grace_seconds=120,
        )

    assert candidate is None


def test_classify_non_converged_active_agent_skips_recent_agent_inside_grace():
    agent = _agent(updated_at=timezone.now() - timedelta(seconds=30))

    with patch(
        "agents.services.non_converged._derive_preview_state_safe",
        return_value="deploying",
    ):
        candidate = classify_non_converged_active_agent(
            agent,
            now=timezone.now(),
            grace_seconds=120,
        )

    assert candidate is None


def test_list_non_converged_active_agents_command_json_output(capsys):
    fake_candidate = SimpleNamespace(
        asdict=lambda: {
            "agent_id": "agent-1",
            "project_id": "project-1",
            "agent_name": "test-agent",
            "signature": "relay_connected_not_ready",
        }
    )

    with patch(
        "agents.management.commands.list_non_converged_active_agents.list_non_converged_active_agent_candidates",
        return_value=[fake_candidate],
    ):
        call_command("list_non_converged_active_agents", "--json")

    out = capsys.readouterr().out
    assert '"signature": "relay_connected_not_ready"' in out


def test_list_non_converged_active_agents_command_human_output(capsys):
    fake_candidate = SimpleNamespace(
        agent_name="test-agent",
        agent_id="agent-1",
        project_id="project-1",
        signature="relay_connected_not_ready",
        age_seconds=180,
        lifecycle_status="idle",
        preview_state="deploying",
        relay_connected=True,
        is_converged=False,
        preview_runtime_id="sb-123",
    )

    with patch(
        "agents.management.commands.list_non_converged_active_agents.list_non_converged_active_agent_candidates",
        return_value=[fake_candidate],
    ):
        call_command("list_non_converged_active_agents")

    out = capsys.readouterr().out
    assert "signature=relay_connected_not_ready" in out
    assert "agent=test-agent" in out
