"""Tests for incident capture bundle assembly.

Proves:
- bundle has required schema fields
- redaction strips sensitive values
- time window excludes old events
- scoping excludes other agents in same project
- scoping excludes other projects entirely
- partial source failure → collection_errors, not crash
"""

import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from accounts.models import User
from agents.models import (
    Agent,
    AgentStatus,
    StreamEvent,
    TeamFeedItem,
)
from agents.services.incident import (
    BUNDLE_SCHEMA_VERSION,
    REDACTED,
    _redact,
    capture_incident_bundle,
)
from projects.models import Project

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


def _create_project_without_signals(*, name: str, owner: User) -> Project:
    project = Project(id=uuid.uuid4(), name=name, owner=owner)
    Project.objects.bulk_create([project])
    return project


@pytest.fixture
def setup_project_with_agents():
    """Create a project with two agents and seed some events."""
    owner = User.objects.create_user(
        username=f"incident-test-{uuid.uuid4().hex[:6]}", password="pw"
    )
    project = _create_project_without_signals(name="Incident Test", owner=owner)

    target_agent = Agent.objects.create(
        name="target-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        sandbox_id="sandbox-target",
        relay_token="secret-relay-token-value",
        session_id="session-123",
    )

    other_agent = Agent.objects.create(
        name="other-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        sandbox_id="sandbox-other",
    )

    now = timezone.now()

    # Seed 3 recent events for target agent
    for i in range(3):
        StreamEvent.objects.create(
            agent=target_agent,
            session_id="session-123",
            event_type="assistant",
            data={"type": "assistant", "index": i},
            is_canonical=True,
        )

    # Seed an old event outside default 30min window
    old_event = StreamEvent.objects.create(
        agent=target_agent,
        session_id="session-123",
        event_type="assistant",
        data={"type": "assistant", "old": True},
        is_canonical=True,
    )
    StreamEvent.objects.filter(id=old_event.id).update(
        created_at=now - timedelta(hours=2)
    )

    # Seed event for OTHER agent (must not appear in target's bundle)
    StreamEvent.objects.create(
        agent=other_agent,
        session_id="session-other",
        event_type="assistant",
        data={"type": "assistant", "agent": "other"},
        is_canonical=True,
    )

    # Seed feed items
    TeamFeedItem.objects.create(
        project=project,
        type="summary",
        agent_name="target-agent",
        agent_record=target_agent,
        text="target agent did something",
    )
    TeamFeedItem.objects.create(
        project=project,
        type="summary",
        agent_name="other-agent",
        agent_record=other_agent,
        text="other agent did something",
    )

    return project, target_agent, other_agent, owner


@pytest.fixture
def setup_other_project():
    """Separate project — events must never appear in target's bundle."""
    owner = User.objects.create_user(
        username=f"other-proj-{uuid.uuid4().hex[:6]}", password="pw"
    )
    project = _create_project_without_signals(name="Other Project", owner=owner)
    agent = Agent.objects.create(
        name="foreign-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        sandbox_id="sandbox-foreign",
    )
    StreamEvent.objects.create(
        agent=agent,
        session_id="foreign-session",
        event_type="assistant",
        data={"type": "assistant", "project": "other"},
        is_canonical=True,
    )
    TeamFeedItem.objects.create(
        project=project,
        type="summary",
        agent_name="foreign-agent",
        agent_record=agent,
        text="foreign project event",
    )
    return project, agent


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_bundle_has_required_fields(setup_project_with_agents):
    project, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, errors = await capture_incident_bundle(target, note="test note")

    required = {
        "schema_version",
        "captured_at",
        "note",
        "screenshot_url",
        "window_minutes",
        "ids",
        "agent",
        "lifecycle_attempts",
        "stream_events",
        "feed_items",
        "runtime_logs",
        "runtime_status",
        "collection_errors",
    }
    assert required.issubset(set(bundle.keys())), (
        f"Missing fields: {required - set(bundle.keys())}"
    )
    assert bundle["schema_version"] == BUNDLE_SCHEMA_VERSION
    assert bundle["note"] == "test note"
    assert bundle["ids"]["agent_id"] == str(target.id)
    assert bundle["ids"]["project_id"] == str(project.id)


async def test_bundle_redacts_sensitive_fields(setup_project_with_agents):
    _, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(target)

    agent_data = bundle["agent"]
    # relay_token should be redacted (camelCase in serialized output)
    assert agent_data.get("relayToken") == REDACTED or "relayToken" not in agent_data

    # Test the redact function directly
    test_data = {
        "relay_token": "secret-value",
        "api_key": "sk-ant-xxx",
        "name": "safe-value",
        "nested": {"password": "hunter2", "status": "ok"},
    }
    redacted = _redact(test_data)
    assert redacted["relay_token"] == REDACTED
    assert redacted["api_key"] == REDACTED
    assert redacted["name"] == "safe-value"
    assert redacted["nested"]["password"] == REDACTED
    assert redacted["nested"]["status"] == "ok"


async def test_bundle_respects_time_window(setup_project_with_agents):
    _, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(target, window_minutes=30)

    assert len(bundle["stream_events"]) == 3, (
        f"Expected 3 recent events, got {len(bundle['stream_events'])}"
    )
    for event in bundle["stream_events"]:
        assert event["data"].get("old") is not True, (
            "Old event outside time window should not appear in bundle"
        )


async def test_bundle_excludes_other_agents(setup_project_with_agents):
    _, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(target)

    for event in bundle["stream_events"]:
        assert event["data"].get("agent") != "other", (
            "Other agent's stream events should not appear in target's bundle"
        )

    for item in bundle["feed_items"]:
        assert item["agent_name"] == "target-agent", (
            f"Feed item for '{item['agent_name']}' should not appear in target's bundle"
        )


async def test_bundle_excludes_other_projects(
    setup_project_with_agents, setup_other_project,
):
    _, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(target)

    for event in bundle["stream_events"]:
        assert event["data"].get("project") != "other", (
            "Other project's events must not appear in bundle"
        )
    for item in bundle["feed_items"]:
        assert "foreign" not in item.get("text", ""), (
            "Other project's feed items must not appear in bundle"
        )


async def test_partial_source_failure_captured(setup_project_with_agents):
    _, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", side_effect=OSError("volume not mounted")):
        bundle, errors = await capture_incident_bundle(target)

    # Bundle should still have other sources
    assert len(bundle["stream_events"]) > 0
    assert bundle["agent"] != {}

    # collection_errors should capture the failure
    assert len(errors) > 0
    assert any("runtime_logs" in e for e in errors), (
        f"Expected runtime_logs error in collection_errors, got: {errors}"
    )
    assert len(bundle["collection_errors"]) > 0
