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
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

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
        relay_token="test-relay-token-abc",
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
        "desired",
        "observed",
        "applied",
        "raw_support",
        "agent",
        "lifecycle_attempts",
        "stream_events",
        "feed_items",
        "runtime_logs",
        "runtime_status",
        "platform_crash_info",
        "platform_events",
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


async def test_bundle_desired_observed_applied_structure(setup_project_with_agents):
    """Bundle must have desired/observed/applied sections with provenance."""
    _, target, _, _ = setup_project_with_agents

    mock_logs = [
        {"event": "theme.projected", "ts": 1.0, "fingerprint": "abc123def456", "theme_name": "Test"},
        {"event": "theme.consumer_applied", "ts": 2.0, "consumer": "awesome"},
        {"event": "desktop.display_ready", "ts": 3.0, "display": ":99", "attempts": 5},
        {"event": "desktop.launch_requested", "ts": 4.0, "command": "chromium"},
    ]

    with patch("agents.services.incident._read_runtime_logs", return_value=mock_logs):
        bundle, _ = await capture_incident_bundle(target)

    # desired section — includes canonical theme fingerprint
    desired = bundle["desired"]
    assert "desired_status" in desired
    assert "theme_fingerprint" in desired
    assert desired["source"] == "agent_model"

    # observed section
    observed = bundle["observed"]
    assert "lifecycle_status" in observed
    assert "relay_connected" in observed
    assert observed["source"] == "agent_model+runtime_projection"

    # applied section — stable schema, all fields always present
    applied = bundle["applied"]
    assert applied["source"] == "runtime_file+runtime_log"
    assert applied["theme_fingerprint_source"] == "runtime_file"
    # theme_fingerprint is file-backed (read from volume), not from mock logs
    # ephemeral outcomes from events:
    assert applied["theme_notify_result"] == "succeeded"
    assert applied["theme_notify_error"] is None  # no error when succeeded
    assert applied["last_launcher_request"] == "chromium"
    assert applied["display_ready"] is True
    assert applied["display_ready_attempts"] == 5


async def test_applied_section_nullable_when_no_events(setup_project_with_agents):
    """Applied section should be null for ephemeral fields when no events exist."""
    _, target, _, _ = setup_project_with_agents

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(target)

    applied = bundle["applied"]
    # theme_fingerprint may be null (file not on volume) or populated (file exists)
    assert applied["theme_fingerprint_source"] == "runtime_file"
    # ephemeral fields should all be null
    assert applied["theme_notify_result"] is None
    assert applied["theme_notify_error"] is None
    assert applied["last_launcher_request"] is None
    assert applied["display_ready"] is None
    assert applied["display_ready_attempts"] is None
    assert applied["source"] == "runtime_file+runtime_log"


async def test_applied_section_captures_consumer_failure(setup_project_with_agents):
    """Applied section should surface consumer failure with error."""
    _, target, _, _ = setup_project_with_agents

    mock_logs = [
        {"event": "theme.projected", "ts": 1.0, "fingerprint": "xyz789"},
        {"event": "theme.consumer_failed", "ts": 2.0, "error": "awesome not ready"},
    ]

    with patch("agents.services.incident._read_runtime_logs", return_value=mock_logs):
        bundle, _ = await capture_incident_bundle(target)

    applied = bundle["applied"]
    assert applied["theme_notify_result"] == "failed"
    assert applied["theme_notify_error"] == "awesome not ready"


async def test_applied_theme_fingerprint_is_file_backed(setup_project_with_agents):
    """Key architectural contract: applied.theme_fingerprint reads from the
    canonical runtime file, not from log events.

    This test writes tokens.json to the agent volume and asserts the bundle
    reads the file content for the fingerprint, ignoring any log-based value.
    """
    import hashlib
    import json

    _, target, _, _ = setup_project_with_agents

    # Write a real tokens.json to the agent's machine volume
    theme_content = json.dumps({
        "schema_version": "1",
        "name": "File Test",
        "tokens": {"surface": "#111111", "accent": "#ff0000"},
    })
    expected_fingerprint = hashlib.sha256(theme_content.encode()).hexdigest()[:12]

    # Mock the machine.read to return our file content
    mock_machine = MagicMock()
    mock_machine.read.return_value = theme_content
    mock_machine.runtime_log_tail.return_value = []

    # Log events have a DIFFERENT fingerprint — bundle must prefer file
    mock_logs = [
        {"event": "theme.projected", "ts": 1.0, "fingerprint": "wrong_from_log"},
    ]

    with (
        patch("agents.services.incident._read_runtime_logs", return_value=mock_logs),
        patch.object(type(target), "machine", new_callable=PropertyMock, return_value=mock_machine),
    ):
        bundle, _ = await capture_incident_bundle(target)

    applied = bundle["applied"]
    assert applied["theme_fingerprint"] == expected_fingerprint, (
        f"Expected file-backed fingerprint {expected_fingerprint}, "
        f"got {applied['theme_fingerprint']}. "
        "applied.theme_fingerprint must come from the runtime file, not from logs."
    )
    assert applied["theme_fingerprint"] != "wrong_from_log", (
        "applied.theme_fingerprint must not come from log events"
    )
    assert applied["theme_fingerprint_source"] == "runtime_file"


async def test_raw_support_bundle_captures_files_with_provenance(setup_project_with_agents):
    """Raw support bundle reads canonical artifacts with hash and truncation flag."""
    _, target, _, _ = setup_project_with_agents

    state_json = b'{"model": "claude-sonnet", "mode": "auto"}'
    status_json = b'{"startup_stage": "managed_ready", "profile": "desktop"}'

    # Use _bounded_read_sync mock via patching the function directly
    def mock_bounded_read(machine, path, max_bytes):
        if path == "_abox/state.json":
            return state_json, False
        if path == "_abox/status.json":
            return status_json, False
        raise FileNotFoundError(path)

    mock_runtime = MagicMock()
    mock_runtime.exec = AsyncMock(return_value="root  1  0.0  /sbin/init\nagent 42  0.1  python")

    with (
        patch("agents.services.incident._read_runtime_logs", return_value=[]),
        patch("agents.services.incident._bounded_read_sync", side_effect=mock_bounded_read),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        bundle, errors = await capture_incident_bundle(target)

    raw = bundle["raw_support"]
    assert raw["source"] == "agent_volume+runtime_exec"
    assert raw["max_file_bytes"] > 0

    files = {a["path"]: a for a in raw["files"]}

    # state.json should be captured
    state = files["_abox/state.json"]
    assert state["content"] == state_json.decode()
    assert state["sha256"] is not None
    assert state["truncated"] is False
    assert state["error"] is None

    # missing files should report not_found
    tokens = files["tmp/abox-theme/tokens.json"]
    assert tokens["content"] is None
    assert tokens["error"] == "not_found"

    # command-based evidence (process list)
    commands = {c["name"]: c for c in raw["commands"]}
    assert "process_list" in commands
    assert "root" in commands["process_list"]["content"]


async def test_raw_support_bundle_truncates_at_read_time(setup_project_with_agents):
    """Files are bounded at READ time, not post-load truncation."""
    from agents.services.incident import MAX_RAW_FILE_BYTES

    _, target, _, _ = setup_project_with_agents

    # Simulate bounded read returning truncated content
    truncated_bytes = b"x" * MAX_RAW_FILE_BYTES

    def mock_bounded_read(machine, path, max_bytes):
        return truncated_bytes, True  # truncated=True

    mock_runtime = MagicMock()
    mock_runtime.exec = AsyncMock(return_value="")

    with (
        patch("agents.services.incident._read_runtime_logs", return_value=[]),
        patch("agents.services.incident._bounded_read_sync", side_effect=mock_bounded_read),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        bundle, _ = await capture_incident_bundle(target)

    for artifact in bundle["raw_support"]["files"]:
        if artifact["content"] is not None:
            assert len(artifact["content"].encode()) <= MAX_RAW_FILE_BYTES
            assert artifact["truncated"] is True


@pytest.fixture
def setup_agent_empty_session():
    """Agent with empty session_id but populated runtime_status_projection."""
    owner = User.objects.create_user(
        username=f"incident-sessid-{uuid.uuid4().hex[:6]}", password="pw"
    )
    project = _create_project_without_signals(name="Vahid Session Test", owner=owner)
    agent = Agent.objects.create(
        name="sessid-fallback-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        session_id="",
        runtime_status_projection={
            "startup_stage": "managed_ready",
            "runtime": {"session_id": "live-sess-456", "client_active": True},
        },
    )
    return agent


async def test_session_id_falls_back_to_runtime_status(setup_agent_empty_session):
    """ids.session_id uses runtime projection when agent model field is empty."""
    agent = setup_agent_empty_session

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(agent)

    # Fallback: runtime projection session_id used when model field empty
    assert bundle["ids"]["session_id"] == "live-sess-456"

    # Now verify model field takes precedence when populated
    agent.session_id = "model-sess-789"
    await agent.asave(update_fields=["session_id"])

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle2, _ = await capture_incident_bundle(agent)

    assert bundle2["ids"]["session_id"] == "model-sess-789"


async def test_platform_crash_info_captured_in_bundle(setup_project_with_agents):
    """Platform crash info is included when sandbox has exited."""
    _, target, _, _ = setup_project_with_agents

    mock_runtime = MagicMock()
    mock_runtime.get_crash_info = AsyncMock(return_value={
        "exit_code": 1,
        "oom_killed": False,
        "logs": "PermissionError: [Errno 13] Permission denied: '/vol/agents'",
    })
    mock_runtime.get_event_tail = AsyncMock(return_value=[])

    with (
        patch("agents.services.incident._read_runtime_logs", return_value=[]),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        bundle, errors = await capture_incident_bundle(target)

    assert bundle["platform_crash_info"] is not None
    assert bundle["platform_crash_info"]["exit_code"] == 1
    assert "PermissionError" in bundle["platform_crash_info"]["logs"]
    assert isinstance(bundle["platform_events"], list)


async def test_platform_logs_unavailable_does_not_break_capture(setup_project_with_agents):
    """Platform API failure goes to collection_errors, not total failure."""
    _, target, _, _ = setup_project_with_agents

    mock_runtime = MagicMock()
    mock_runtime.get_crash_info = AsyncMock(side_effect=Exception("Modal API down"))
    mock_runtime.get_event_tail = AsyncMock(side_effect=Exception("Modal API down"))

    with (
        patch("agents.services.incident._read_runtime_logs", return_value=[]),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        bundle, errors = await capture_incident_bundle(target)

    # Bundle still assembled
    assert bundle["platform_crash_info"] is None
    assert isinstance(bundle["platform_events"], list)
    # Errors captured
    assert any("platform_crash_info" in e for e in errors)
    assert any("platform_events" in e for e in errors)


@pytest.fixture
def setup_agent_no_sandbox():
    """Agent with no sandbox_id — platform APIs should be skipped."""
    owner = User.objects.create_user(
        username=f"no-sandbox-{uuid.uuid4().hex[:6]}", password="pw"
    )
    project = _create_project_without_signals(name="Vahid No Sandbox Test", owner=owner)
    agent = Agent.objects.create(
        name="no-sandbox-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        sandbox_id="",
    )
    return agent


async def test_platform_crash_info_skipped_without_sandbox(setup_agent_no_sandbox):
    """No platform API calls when agent has no sandbox_id."""
    agent = setup_agent_no_sandbox

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, errors = await capture_incident_bundle(agent)

    assert bundle["platform_crash_info"] is None
    assert bundle["platform_events"] == []
    assert not any("platform_crash_info" in e for e in errors)
    assert not any("platform_events" in e for e in errors)


@pytest.fixture
def setup_agent_with_task_failure():
    """Agent with runtime_status_projection showing a failed executor task."""
    owner = User.objects.create_user(
        username=f"task-fail-{uuid.uuid4().hex[:6]}", password="pw"
    )
    project = _create_project_without_signals(name="Vahid Task Failure Test", owner=owner)
    agent = Agent.objects.create(
        name="task-fail-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        sandbox_id="sandbox-task-fail",
        runtime_status_projection={
            "startup_stage": "managed_ready",
            "runtime_state": "running",
            "profile": "desktop",
            "runtime": {
                "session_id": "sess-task-abc",
                "client_active": False,
                "task_id": "task-abc",
                "task_state": "failed",
            },
            "fatal": "executor crashed",
            "degraded": ["api-proxy"],
            "transport": {
                "enabled": True,
                "state": "connected",
                "connected": True,
                "last_error": "",
            },
            "build": {
                "image_ref": "ghcr.io/veyorokon/agentobox:sha-abc123",
                "image_digest": "sha256:deadbeef",
                "git_commit": "abc123",
            },
        },
    )
    return agent


async def test_observed_includes_runtime_task_and_diagnosis_fields(setup_agent_with_task_failure):
    """Observed layer surfaces executor task state and runtime diagnosis fields."""
    agent = setup_agent_with_task_failure

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(agent)

    observed = bundle["observed"]
    # Executor task fields
    assert observed["runtime_task_id"] == "task-abc"
    assert observed["runtime_task_state"] == "failed"
    assert observed["runtime_client_active"] is False
    # Runtime health diagnosis
    assert observed["fatal"] == "executor crashed"
    assert observed["degraded"] == ["api-proxy"]
    assert observed["transport_state"] == "connected"
    assert observed["transport_last_error"] == ""
    # Build provenance
    assert observed["build_image_ref"] == "ghcr.io/veyorokon/agentobox:sha-abc123"
    assert observed["build_git_commit"] == "abc123"


async def test_observed_task_fields_null_without_projection(setup_agent_no_sandbox):
    """Observed task/diagnosis fields degrade to None/empty without projection."""
    agent = setup_agent_no_sandbox

    with patch("agents.services.incident._read_runtime_logs", return_value=[]):
        bundle, _ = await capture_incident_bundle(agent)

    observed = bundle["observed"]
    assert observed["runtime_task_id"] is None
    assert observed["runtime_task_state"] is None
    assert observed["runtime_client_active"] is None
    assert observed["fatal"] is None
    assert observed["degraded"] == []
    assert observed["transport_state"] is None
    assert observed["build_image_ref"] is None
    assert observed["build_git_commit"] is None


async def test_inbox_in_raw_support(setup_project_with_agents):
    """inbox.jsonl is captured in raw support bundle."""
    _, target, _, _ = setup_project_with_agents

    inbox_content = b'{"type":"task","task_id":"task-1","input":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n'

    def mock_bounded_read(machine, path, max_bytes):
        if "inbox.jsonl" in path:
            return inbox_content, False
        return b"", False

    mock_runtime = MagicMock()
    mock_runtime.exec = AsyncMock(return_value="")

    with (
        patch("agents.services.incident._read_runtime_logs", return_value=[]),
        patch("agents.services.incident._bounded_read_sync", side_effect=mock_bounded_read),
        patch("agents.runtimes.get_runtime", return_value=mock_runtime),
    ):
        bundle, _ = await capture_incident_bundle(target)

    files = {f["path"]: f for f in bundle["raw_support"]["files"]}
    assert "_abox/inbox.jsonl" in files
    inbox = files["_abox/inbox.jsonl"]
    assert inbox["content"] is not None
    assert "task-1" in inbox["content"]
