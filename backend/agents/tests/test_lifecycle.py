"""Tests for lifecycle state machine and shell escape utility.

Covers:
- Agent lifecycle state machine (VALID_TRANSITIONS, transition_agent_status)
- _shell_escape delegates to shlex.quote(), which wraps values in single
  quotes and handles all shell metacharacters.
"""

from datetime import timedelta
import re
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asgiref.sync import sync_to_async
from django.utils import timezone

from accounts.models import User
from config.app_config import app_config
from agents.adapters.claude_code import _shell_escape
from agents.models import (
    Agent,
    AgentLifecycleAttempt,
    AgentLifecycleAttemptStatus,
    AgentLifecycleKind,
    RuntimeSegment,
    AgentStatus,
    DesiredStatus,
    IllegalTransitionError,
    VALID_TRANSITIONS,
)
from agents.services.lifecycle import (
    _atomic_reset_for_restart,
    _build_agent_env,
    _create_lifecycle_attempt_sync,
    _load_provision_inputs,
    _mark_provisioned_ready,
    _runtime_executor,
    _update_lifecycle_attempt_sync,
    transition_agent_status,
)
from agents.services.project_volume import AgentMachinePaths, LocalProjectVolumeStore
from agents.services.volume import AgentMachine, Volume
from agents.services.reconcile import recover_lifecycle_attempts
from agents.services.utils import mark_agent_runtime_unavailable
from projects.models import Project


def _create_project_without_signals(*, name: str, owner: User) -> Project:
    project = Project(id=uuid.uuid4(), name=name, owner=owner)
    Project.objects.bulk_create([project])
    return project

pytestmark = pytest.mark.unit


def _make_volume(tmp_path: Path) -> AgentMachine:
    class _DirectStore(LocalProjectVolumeStore):
        def local_machine_root(self, machine: AgentMachinePaths) -> Path:
            return tmp_path

        def _full_path(self, machine: AgentMachinePaths, path: str = "") -> Path:
            return tmp_path / path if path else tmp_path

    vol = AgentMachine.__new__(AgentMachine)
    vol._machine = AgentMachinePaths(project_id="proj-test", agent_id="agent-test")
    vol._store = _DirectStore(tmp_path)
    vol.root = tmp_path
    return vol


def test_runtime_executor_maps_claude_code_agent_type():
    assert _runtime_executor("claude-code") == "claude_code"


def test_agent_machine_is_canonical_and_volume_is_compat_alias(monkeypatch):
    agent = Agent(id=uuid.uuid4(), project_id=uuid.uuid4(), runtime="docker")

    class _FakeRuntime:
        def machine_store(self):
            return LocalProjectVolumeStore(Path("/tmp/agent-machine-test"))

    monkeypatch.setattr("agents.runtimes.get_runtime", lambda runtime_name: _FakeRuntime())

    machine = agent.machine
    volume = agent.volume

    assert isinstance(machine, AgentMachine)
    assert isinstance(volume, Volume)
    assert machine.root == volume.root


def test_agent_machine_resolves_store_from_runtime(monkeypatch):
    agent = Agent(id=uuid.uuid4(), project_id=uuid.uuid4(), runtime="modal")

    sentinel_store = object()

    class _FakeRuntime:
        def machine_store(self):
            return sentinel_store

    captured = {}

    class _FakeMachine:
        def __init__(self, project_id, agent_id, *, store=None):
            captured["project_id"] = project_id
            captured["agent_id"] = agent_id
            captured["store"] = store

    monkeypatch.setattr("agents.runtimes.get_runtime", lambda runtime_name: _FakeRuntime())
    monkeypatch.setattr("agents.services.volume.AgentMachine", _FakeMachine)

    agent.machine

    assert captured["project_id"] == str(agent.project_id)
    assert captured["agent_id"] == str(agent.id)
    assert captured["store"] is sentinel_store


def test_agent_machine_exposes_canonical_runtime_visible_paths():
    machine = AgentMachine(project_id="proj-1", agent_id="agent-1")

    assert machine.archive_entry("_abox/state.json") == "agents/agent-1/_abox/state.json"
    assert machine.mounted_root() == "/vol/agents/agent-1"
    assert machine.mounted_path("_abox/state.json") == "/vol/agents/agent-1/_abox/state.json"


def test_agent_machine_accepts_injected_store(tmp_path: Path):
    class _DirectStore(LocalProjectVolumeStore):
        def local_machine_root(self, machine: AgentMachinePaths) -> Path:
            return tmp_path

        def _full_path(self, machine: AgentMachinePaths, path: str = "") -> Path:
            return tmp_path / path if path else tmp_path

    machine = AgentMachine(project_id="proj-1", agent_id="agent-1", store=_DirectStore(tmp_path))

    assert machine.root == tmp_path


def test_runtime_executor_honors_override():
    assert _runtime_executor("claude-code", override="echo") == "echo"


def test_build_agent_env_does_not_export_bash_env():
    agent = SimpleNamespace(
        id=uuid.uuid4(),
        agent_type="claude-code",
        name="worker",
        runtime="modal",
    )
    project = SimpleNamespace(id=uuid.uuid4())

    env = _build_agent_env(agent, project)

    assert "BASH_ENV" not in env


def test_shell_escape_basic():
    """Simple safe strings pass through unquoted (shlex.quote behavior)."""
    assert _shell_escape("hello-world") == "hello-world"
    assert _shell_escape("my_agent_name") == "my_agent_name"
    assert _shell_escape("") == "''"


def test_shell_escape_single_quotes():
    """Single quotes use the close-escape-reopen pattern."""
    # shlex.quote("it's") => 'it'"'"'s'  (close single, double-quote the ', reopen single)
    result = _shell_escape("it's")
    assert result == "'it'\"'\"'s'"


def test_shell_escape_dollar_signs():
    """Dollar signs are wrapped in single quotes — no expansion."""
    assert _shell_escape("$HOME") == "'$HOME'"
    assert _shell_escape("cost=$100") == "'cost=$100'"


def test_shell_escape_backticks():
    """Backticks are wrapped in single quotes — no command substitution."""
    assert _shell_escape("`whoami`") == "'`whoami`'"
    assert _shell_escape("echo `ls`") == "'echo `ls`'"


def test_shell_escape_mixed_special_chars():
    """Strings with single quotes AND other special chars."""
    result = _shell_escape("it's $HOME `pwd`")
    # shlex.quote wraps in single quotes, breaks out for the apostrophe
    assert result == "'it'\"'\"'s $HOME `pwd`'"


@pytest.mark.asyncio
async def test_mark_provisioned_ready_syncs_modal_machine_volume(tmp_path):
    vol = _make_volume(tmp_path)
    vol.initialize()

    class _Runtime:
        await_machine_path_visible = AsyncMock(return_value=None)

    op_log = SimpleNamespace(info=lambda *args, **kwargs: None, warning=lambda *args, **kwargs: None)
    await _mark_provisioned_ready(
        "modal",
        _Runtime(),
        "sb-123",
        vol,
        "agent-test",
        "token-123",
        op_log,
    )

    assert vol.read("_abox/provisioned.ready") == "token-123"
    _Runtime.await_machine_path_visible.assert_awaited_once_with(
        "sb-123",
        "/vol/agents/agent-test/_abox/provisioned.ready",
        expected_content="token-123",
    )


@pytest.mark.asyncio
async def test_mark_provisioned_ready_skips_runtime_sync_for_docker(tmp_path):
    vol = _make_volume(tmp_path)
    vol.initialize()

    class _Runtime:
        await_machine_path_visible = AsyncMock(return_value=None)

    op_log = SimpleNamespace(info=lambda *args, **kwargs: None, warning=lambda *args, **kwargs: None)
    await _mark_provisioned_ready(
        "docker",
        _Runtime(),
        "ct-123",
        vol,
        "agent-test",
        "token-456",
        op_log,
    )

    assert vol.read("_abox/provisioned.ready") == "token-456"
    _Runtime.await_machine_path_visible.assert_awaited_once_with(
        "ct-123",
        "/vol/agents/agent-test/_abox/provisioned.ready",
        expected_content="token-456",
    )


@pytest.mark.django_db(transaction=True)
def test_create_lifecycle_attempt_sync_persists_attempt():
    owner = User.objects.create_user(username="owner", password="pw")
    project = _create_project_without_signals(name="Test Project", owner=owner)
    agent = Agent.objects.create(
        name="worker",
        project=project,
        runtime="docker",
        status="deploying",
    )

    attempt = _create_lifecycle_attempt_sync(
        str(agent.id),
        AgentLifecycleKind.CREATE,
        "corr-123",
        step="queued",
        metadata={"runtime": "docker"},
    )

    assert attempt.agent_id == agent.id
    assert attempt.kind == AgentLifecycleKind.CREATE
    assert attempt.status == AgentLifecycleAttemptStatus.RUNNING
    assert attempt.step == "queued"
    assert attempt.correlation_id == "corr-123"
    assert attempt.metadata_json["runtime"] == "docker"


@pytest.mark.django_db(transaction=True)
def test_update_lifecycle_attempt_sync_marks_failure():
    owner = User.objects.create_user(username="owner2", password="pw")
    project = _create_project_without_signals(name="Test Project 2", owner=owner)
    agent = Agent.objects.create(
        name="worker-2",
        project=project,
        runtime="docker",
        status="deploying",
    )
    attempt = AgentLifecycleAttempt.objects.create(
        agent=agent,
        kind=AgentLifecycleKind.CREATE,
        correlation_id="corr-456",
    )

    updated = _update_lifecycle_attempt_sync(
        str(attempt.id),
        step="failed",
        status=AgentLifecycleAttemptStatus.FAILED,
        error_code="ERR-TEST",
        error_detail="boom",
        metadata={"sandbox_id": "sandbox-1"},
    )

    assert updated.status == AgentLifecycleAttemptStatus.FAILED
    assert updated.step == "failed"
    assert updated.error_code == "ERR-TEST"
    assert updated.error_detail == "boom"
    assert updated.finished_at is not None
    assert updated.metadata_json["sandbox_id"] == "sandbox-1"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_load_provision_inputs_reloads_latest_project_theme_state():
    owner = await sync_to_async(User.objects.create_user, thread_sensitive=True)(
        username="owner-theme-refresh",
        password="pw",
    )
    project = await sync_to_async(_create_project_without_signals, thread_sensitive=True)(
        name="Theme Refresh Project",
        owner=owner,
    )
    agent = await sync_to_async(Agent.objects.create, thread_sensitive=True)(
        name="theme-worker",
        project=project,
        runtime="docker",
        status=AgentStatus.DEPLOYING,
    )

    stale_agent, stale_project = await Agent.objects.select_related("project").aget(id=agent.id), project
    stale_tokens = stale_project.resolved_theme_tokens()

    await sync_to_async(
        Project.objects.filter(id=project.id).update,
        thread_sensitive=True,
    )(
        theme_document={"theme": "ember", "mode": "dark", "overrides": {}},
    )

    fresh_agent, fresh_project = await _load_provision_inputs(str(agent.id))

    assert fresh_agent.id == stale_agent.id
    assert fresh_project.id == stale_project.id
    assert fresh_project.resolved_theme_tokens() != stale_tokens
    assert fresh_project.resolved_theme_document()["theme"] == "ember"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_recover_lifecycle_attempts_marks_available_agent_succeeded():
    def _setup():
        owner = User.objects.create_user(username="owner3", password="pw")
        project = _create_project_without_signals(name="Test Project 3", owner=owner)
        agent = Agent.objects.create(
            name="worker-3",
            project=project,
            runtime="docker",
            status="idle",
            relay_connected=True,
            runtime_status_projection={
                "profile": "desktop",
                "startup_stage": "managed_ready",
                "runtime_state": "ready",
            },
        )
        attempt = AgentLifecycleAttempt.objects.create(
            agent=agent,
            kind=AgentLifecycleKind.CREATE,
            correlation_id="corr-789",
            status=AgentLifecycleAttemptStatus.RUNNING,
            step="waiting_for_relay",
        )
        return attempt.id

    attempt_id = await sync_to_async(_setup, thread_sensitive=True)()

    await recover_lifecycle_attempts()

    attempt = await AgentLifecycleAttempt.objects.aget(id=attempt_id)
    assert attempt.status == AgentLifecycleAttemptStatus.SUCCEEDED
    assert attempt.step == "runtime_ready"
    assert attempt.finished_at is not None


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_recover_lifecycle_attempts_keeps_idle_agent_running_until_runtime_ready():
    def _setup():
        owner = User.objects.create_user(username="owner3b", password="pw")
        project = _create_project_without_signals(name="Test Project 3b", owner=owner)
        agent = Agent.objects.create(
            name="worker-3b",
            project=project,
            runtime="docker",
            status="idle",
            relay_connected=True,
            runtime_status_projection={},
        )
        attempt = AgentLifecycleAttempt.objects.create(
            agent=agent,
            kind=AgentLifecycleKind.CREATE,
            correlation_id="corr-789b",
            status=AgentLifecycleAttemptStatus.RUNNING,
            step="waiting_for_runtime_ready",
        )
        return attempt.id

    attempt_id = await sync_to_async(_setup, thread_sensitive=True)()

    await recover_lifecycle_attempts()

    attempt = await AgentLifecycleAttempt.objects.aget(id=attempt_id)
    assert attempt.status == AgentLifecycleAttemptStatus.RUNNING
    assert attempt.step == "waiting_for_runtime_ready"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_recover_lifecycle_attempts_marks_terminal_agent_failed():
    def _setup():
        owner = User.objects.create_user(username="owner4", password="pw")
        project = _create_project_without_signals(name="Test Project 4", owner=owner)
        agent = Agent.objects.create(
            name="worker-4",
            project=project,
            runtime="docker",
            status="error",
            error_message="relay never connected",
        )
        attempt = AgentLifecycleAttempt.objects.create(
            agent=agent,
            kind=AgentLifecycleKind.RESTART,
            correlation_id="corr-999",
            status=AgentLifecycleAttemptStatus.RUNNING,
            step="waiting_for_relay",
        )
        return attempt.id

    attempt_id = await sync_to_async(_setup, thread_sensitive=True)()

    await recover_lifecycle_attempts()

    attempt = await AgentLifecycleAttempt.objects.aget(id=attempt_id)
    assert attempt.status == AgentLifecycleAttemptStatus.FAILED
    assert attempt.step == "agent_terminal_before_ready"
    assert attempt.error_detail == "relay never connected"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_mark_agent_runtime_unavailable_clears_stale_runtime_projection():
    def _setup():
        owner = User.objects.create_user(username="owner5", password="pw")
        project = _create_project_without_signals(name="Test Project 5", owner=owner)
        return Agent.objects.create(
            name="worker-5",
            project=project,
            runtime="docker",
            status=AgentStatus.IDLE,
            relay_connected=True,
            sandbox_id="dead-sandbox",
            vnc_url="http://agentobox-agent-dead:6080",
            runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
            deployed_at=timezone.now() - timedelta(seconds=9),
        )

    agent = await sync_to_async(_setup, thread_sensitive=True)()

    class _FakeRuntime:
        def resource_snapshot(self):
            from decimal import Decimal
            from agents.runtimes.base import RuntimeResources

            return RuntimeResources(cpu_cores=Decimal("0"), memory_mb=0)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("agents.services.runtime_segments.get_runtime", lambda runtime_name: _FakeRuntime())
        updated = await mark_agent_runtime_unavailable(
            str(agent.id),
            reason="vnc_upstream_missing",
            error_message="Desktop runtime is unavailable. Redeploy to restore preview.",
        )

    assert updated.status == AgentStatus.ERROR
    assert updated.relay_connected is False
    assert updated.sandbox_id == ""
    assert updated.vnc_url == ""
    assert updated.runtime_status_projection == {}
    assert updated.error_message == "Desktop runtime is unavailable. Redeploy to restore preview."
    segment = await RuntimeSegment.objects.aget(agent_id=agent.id)
    assert segment.close_reason == "vnc_upstream_missing"
    assert segment.compute_seconds >= 9


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_atomic_reset_for_restart_normalizes_legacy_runtime_to_current_policy():
    def _setup():
        owner = User.objects.create_user(username="owner6", password="pw")
        project = _create_project_without_signals(name="Test Project 6", owner=owner)
        return Agent.objects.create(
            name="legacy-worker",
            project=project,
            runtime="docker",
            status=AgentStatus.IDLE,
            desired_status=DesiredStatus.DEPLOYED,
            model="claude-sonnet-4-5-20250929",
            config_snapshot={
                "runtime": "docker",
                "model": "claude-sonnet-4-5-20250929",
                "agent_type": "claude-code",
                "mcp_servers": {},
                "workspace_path": "",
                "instructions": "",
                "role": "worker",
                "volume_mounts": [],
            },
        )

    agent = await sync_to_async(_setup, thread_sensitive=True)()

    old_runtime = app_config.agent.runtime
    app_config.agent.runtime = "modal"
    try:
        result = await _atomic_reset_for_restart(str(agent.id))
    finally:
        app_config.agent.runtime = old_runtime

    assert result is not None
    reset_agent, _old_sandbox_id, _previous_runtime, _resume_session_id, config = result
    assert config["runtime"] == "modal"
    assert reset_agent.runtime == "modal"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_atomic_reset_for_restart_clears_stale_runtime_projection():
    def _setup():
        owner = User.objects.create_user(username="owner6b", password="pw")
        project = _create_project_without_signals(name="Test Project 6b", owner=owner)
        return Agent.objects.create(
            name="legacy-worker-projection",
            project=project,
            runtime="docker",
            status=AgentStatus.IDLE,
            desired_status=DesiredStatus.DEPLOYED,
            relay_connected=True,
            runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
            config_snapshot={
                "runtime": "docker",
                "model": "claude-sonnet-4-5-20250929",
                "agent_type": "claude-code",
                "mcp_servers": {},
                "workspace_path": "",
                "instructions": "",
                "role": "worker",
                "volume_mounts": [],
            },
        )

    agent = await sync_to_async(_setup, thread_sensitive=True)()

    result = await _atomic_reset_for_restart(str(agent.id))
    assert result is not None
    reset_agent, _old_sandbox_id, _previous_runtime, _resume_session_id, _config = result
    assert reset_agent.runtime_status_projection == {}


@pytest.mark.django_db(transaction=True)
async def test_atomic_reset_for_restart_clears_task_timestamps():
    def _setup():
        owner = User.objects.create_user(username="owner6c", password="pw")
        project = _create_project_without_signals(name="Test Project 6c", owner=owner)
        return Agent.objects.create(
            name="timestamp-reset-agent",
            project=project,
            runtime="docker",
            status=AgentStatus.IDLE,
            desired_status=DesiredStatus.DEPLOYED,
            task_started_at=timezone.now(),
            last_execution_event_at=timezone.now(),
            config_snapshot={
                "runtime": "docker",
                "model": "claude-sonnet-4-5-20250929",
                "agent_type": "claude-code",
                "mcp_servers": {},
                "workspace_path": "",
                "instructions": "",
                "role": "worker",
                "volume_mounts": [],
            },
        )

    agent = await sync_to_async(_setup, thread_sensitive=True)()

    # Verify timestamps are set before restart
    assert agent.task_started_at is not None
    assert agent.last_execution_event_at is not None

    result = await _atomic_reset_for_restart(str(agent.id))
    assert result is not None
    reset_agent = result[0]
    assert reset_agent.task_started_at is None
    assert reset_agent.last_execution_event_at is None

    # Verify persisted to DB, not just in-memory
    refreshed = await Agent.objects.aget(id=agent.id)
    assert refreshed.task_started_at is None
    assert refreshed.last_execution_event_at is None


# ── Lifecycle state machine tests ──


def _fake_agent(status):
    """Create a lightweight agent-like object for transition testing."""
    return SimpleNamespace(id=uuid.uuid4(), status=status)


class TestValidTransitionsComplete:
    """test_inv_life_003_valid_transitions_are_complete"""

    def test_every_status_is_a_key(self):
        """Every AgentStatus value appears as a key in VALID_TRANSITIONS."""
        for status in AgentStatus:
            assert status.value in VALID_TRANSITIONS or status in VALID_TRANSITIONS, (
                f"AgentStatus.{status.name} ({status.value}) missing from VALID_TRANSITIONS"
            )

    def test_every_target_is_valid_status(self):
        """Every target in VALID_TRANSITIONS is a real AgentStatus value."""
        valid_values = {s.value for s in AgentStatus}
        for source, targets in VALID_TRANSITIONS.items():
            for target in targets:
                assert target in valid_values, (
                    f"VALID_TRANSITIONS[{source}] contains invalid target: {target}"
                )

    def test_no_self_transitions(self):
        """No status should transition to itself, except idempotent ones.

        error → error is allowed: relay retry loops can produce multiple
        process_exit events for the same agent before recovery.
        """
        allowed_self = {AgentStatus.ERROR}
        for source, targets in VALID_TRANSITIONS.items():
            if source in allowed_self:
                continue
            assert source not in targets, (
                f"VALID_TRANSITIONS[{source}] allows self-transition"
            )


class TestIllegalTransitionRaises:
    """test_inv_life_003_illegal_transition_raises"""

    def test_stopped_to_running(self):
        agent = _fake_agent(AgentStatus.STOPPED)
        with pytest.raises(IllegalTransitionError) as exc_info:
            transition_agent_status(agent, AgentStatus.RUNNING)
        assert "ERR-LIFECYCLE-STATE-ILLEGAL" in str(exc_info.value)
        assert agent.status == AgentStatus.STOPPED  # unchanged

    def test_stopped_to_idle(self):
        agent = _fake_agent(AgentStatus.STOPPED)
        with pytest.raises(IllegalTransitionError):
            transition_agent_status(agent, AgentStatus.IDLE)

    def test_deploying_to_running(self):
        agent = _fake_agent(AgentStatus.DEPLOYING)
        with pytest.raises(IllegalTransitionError):
            transition_agent_status(agent, AgentStatus.RUNNING)

    def test_error_to_running(self):
        agent = _fake_agent(AgentStatus.ERROR)
        with pytest.raises(IllegalTransitionError):
            transition_agent_status(agent, AgentStatus.RUNNING)

    def test_error_to_idle(self):
        agent = _fake_agent(AgentStatus.ERROR)
        with pytest.raises(IllegalTransitionError):
            transition_agent_status(agent, AgentStatus.IDLE)


class TestLegalTransitionSucceeds:
    """test_inv_life_003_legal_transition_succeeds"""

    def test_deploying_to_idle(self):
        agent = _fake_agent(AgentStatus.DEPLOYING)
        result = transition_agent_status(agent, AgentStatus.IDLE, reason="relay_connected")
        assert result.status == AgentStatus.IDLE

    def test_idle_to_running(self):
        agent = _fake_agent(AgentStatus.IDLE)
        result = transition_agent_status(agent, AgentStatus.RUNNING)
        assert result.status == AgentStatus.RUNNING

    def test_running_to_idle(self):
        agent = _fake_agent(AgentStatus.RUNNING)
        result = transition_agent_status(agent, AgentStatus.IDLE, reason="result_event")
        assert result.status == AgentStatus.IDLE

    def test_running_to_error(self):
        agent = _fake_agent(AgentStatus.RUNNING)
        result = transition_agent_status(agent, AgentStatus.ERROR)
        assert result.status == AgentStatus.ERROR

    def test_idle_to_deploying(self):
        agent = _fake_agent(AgentStatus.IDLE)
        result = transition_agent_status(agent, AgentStatus.DEPLOYING, reason="hard_restart")
        assert result.status == AgentStatus.DEPLOYING

    def test_stopped_to_deploying(self):
        agent = _fake_agent(AgentStatus.STOPPED)
        result = transition_agent_status(agent, AgentStatus.DEPLOYING)
        assert result.status == AgentStatus.DEPLOYING

    def test_error_to_deploying(self):
        agent = _fake_agent(AgentStatus.ERROR)
        result = transition_agent_status(agent, AgentStatus.DEPLOYING)
        assert result.status == AgentStatus.DEPLOYING

    def test_error_to_stopped(self):
        agent = _fake_agent(AgentStatus.ERROR)
        result = transition_agent_status(agent, AgentStatus.STOPPED)
        assert result.status == AgentStatus.STOPPED

    def test_running_to_waiting(self):
        agent = _fake_agent(AgentStatus.RUNNING)
        result = transition_agent_status(agent, AgentStatus.WAITING)
        assert result.status == AgentStatus.WAITING

    def test_waiting_to_running(self):
        agent = _fake_agent(AgentStatus.WAITING)
        result = transition_agent_status(agent, AgentStatus.RUNNING)
        assert result.status == AgentStatus.RUNNING


class TestForceTransition:
    """Force flag bypasses validation for recovery paths."""

    def test_force_allows_illegal_transition(self):
        agent = _fake_agent(AgentStatus.STOPPED)
        result = transition_agent_status(
            agent, AgentStatus.RUNNING, force=True, reason="recovery"
        )
        assert result.status == AgentStatus.RUNNING

    def test_force_allows_error_to_idle(self):
        agent = _fake_agent(AgentStatus.ERROR)
        result = transition_agent_status(
            agent, AgentStatus.IDLE, force=True, reason="reconciler_fix"
        )
        assert result.status == AgentStatus.IDLE


class TestNoDirectStatusWrites:
    """test_inv_arch_001_no_direct_status_writes

    Architecture check: no service file outside lifecycle.py directly writes
    agent.status = AgentStatus.X — all must use transition_agent_status().
    """

    SERVICES_DIR = Path(__file__).resolve().parent.parent / "services"
    CONSUMERS_PATH = Path(__file__).resolve().parent.parent / "consumers.py"
    ALLOWED_FILES = {"lifecycle.py"}
    # Match attribute assignment: .status = AgentStatus.X
    # Excludes: kwarg filters (status=AgentStatus.X), local vars (new_status = ...)
    PATTERN = re.compile(r'\.\s*status\s*=\s*AgentStatus\.')

    def _check_file(self, path):
        src = path.read_text(encoding="utf-8")
        violations = []
        for i, line in enumerate(src.splitlines(), 1):
            if self.PATTERN.search(line):
                violations.append(f"{path.name}:{i}: {line.strip()}")
        return violations

    def test_services_no_direct_writes(self):
        violations = []
        for f in sorted(self.SERVICES_DIR.glob("*.py")):
            if f.name.startswith("__") or f.name in self.ALLOWED_FILES:
                continue
            violations.extend(self._check_file(f))
        assert violations == [], (
            "Direct agent status writes found outside lifecycle.py:\n"
            + "\n".join(f"  {v}" for v in violations)
        )

    def test_consumers_no_direct_writes(self):
        if not self.CONSUMERS_PATH.exists():
            return
        violations = self._check_file(self.CONSUMERS_PATH)
        assert violations == [], (
            "Direct agent status writes found in consumers.py:\n"
            + "\n".join(f"  {v}" for v in violations)
        )


# ---------------------------------------------------------------------------
# State ownership: desired vs reported
# ---------------------------------------------------------------------------


class TestDesiredStatusEnum:
    """Enum values are part of the wire/DB contract. Never rename."""

    def test_desired_status_values_are_locked(self):
        assert DesiredStatus.DEPLOYED.value == "deployed"
        assert DesiredStatus.STOPPED.value == "stopped"

    def test_desired_status_has_exactly_two_values(self):
        assert len(DesiredStatus.choices) == 2


class TestConvergence:
    """is_converged / needs_reconcile reflect desired vs reported state."""

    @staticmethod
    def _converged(desired, status, *, relay_connected=False, runtime_status_projection=None):
        """Evaluate Agent.is_converged property logic without a DB instance."""
        return Agent.is_converged.fget(
            SimpleNamespace(
                desired_status=desired,
                status=status,
                relay_connected=relay_connected,
                runtime_status_projection=runtime_status_projection or {},
            )
        )

    def test_deployed_and_running_is_converged(self):
        assert self._converged(
            DesiredStatus.DEPLOYED,
            AgentStatus.RUNNING,
            relay_connected=True,
            runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        ) is True

    def test_deployed_and_idle_is_converged(self):
        assert self._converged(
            DesiredStatus.DEPLOYED,
            AgentStatus.IDLE,
            relay_connected=True,
            runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        ) is True

    def test_deployed_and_waiting_is_converged(self):
        assert self._converged(
            DesiredStatus.DEPLOYED,
            AgentStatus.WAITING,
            relay_connected=True,
            runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
        ) is True

    def test_deployed_but_idle_without_runtime_ready_needs_reconcile(self):
        assert self._converged(
            DesiredStatus.DEPLOYED,
            AgentStatus.IDLE,
            relay_connected=True,
            runtime_status_projection={},
        ) is False
        ns = SimpleNamespace(
            desired_status=DesiredStatus.DEPLOYED,
            status=AgentStatus.IDLE,
            relay_connected=True,
            runtime_status_projection={},
        )
        assert Agent.needs_reconcile.fget(ns) is True

    def test_deployed_but_stopped_needs_reconcile(self):
        assert self._converged(DesiredStatus.DEPLOYED, AgentStatus.STOPPED) is False

    def test_deployed_but_error_needs_reconcile(self):
        assert self._converged(DesiredStatus.DEPLOYED, AgentStatus.ERROR) is False

    def test_deployed_and_deploying_not_converged(self):
        """Deploying is in-progress — not yet converged."""
        assert self._converged(DesiredStatus.DEPLOYED, AgentStatus.DEPLOYING) is False

    def test_stopped_and_stopped_is_converged(self):
        assert self._converged(DesiredStatus.STOPPED, AgentStatus.STOPPED) is True

    def test_stopped_but_running_needs_reconcile(self):
        assert self._converged(DesiredStatus.STOPPED, AgentStatus.RUNNING) is False

    def test_needs_reconcile_is_inverse_of_converged(self):
        """needs_reconcile is always the inverse of is_converged."""
        for desired in DesiredStatus:
            for status in AgentStatus:
                kwargs = {}
                if desired == DesiredStatus.DEPLOYED and status in {
                    AgentStatus.IDLE, AgentStatus.RUNNING, AgentStatus.WAITING,
                }:
                    kwargs = {
                        "relay_connected": True,
                        "runtime_status_projection": {"profile": "desktop", "startup_stage": "managed_ready"},
                    }
                converged = self._converged(desired, status, **kwargs)
                ns = SimpleNamespace(
                    desired_status=desired,
                    status=status,
                    relay_connected=kwargs.get("relay_connected", False),
                    runtime_status_projection=kwargs.get("runtime_status_projection", {}),
                )
                reconcile = Agent.needs_reconcile.fget(ns)
                assert reconcile == (not converged), (
                    f"desired={desired}, status={status}: "
                    f"is_converged={converged}, needs_reconcile={reconcile}"
                )
