"""Tests for lifecycle state machine and shell escape utility.

Covers:
- Agent lifecycle state machine (VALID_TRANSITIONS, transition_agent_status)
- _shell_escape delegates to shlex.quote(), which wraps values in single
  quotes and handles all shell metacharacters.
"""

import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from asgiref.sync import sync_to_async

from accounts.models import User
from agents.adapters.claude_code import _shell_escape
from agents.models import (
    Agent,
    AgentLifecycleAttempt,
    AgentLifecycleAttemptStatus,
    AgentLifecycleKind,
    AgentStatus,
    IllegalTransitionError,
    VALID_TRANSITIONS,
)
from agents.services.lifecycle import (
    _create_lifecycle_attempt_sync,
    _update_lifecycle_attempt_sync,
    transition_agent_status,
)
from agents.services.reconcile import recover_lifecycle_attempts
from projects.models import Project


def _create_project_without_signals(*, name: str, owner: User) -> Project:
    project = Project(id=uuid.uuid4(), name=name, owner=owner)
    Project.objects.bulk_create([project])
    return project

pytestmark = pytest.mark.unit


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
async def test_recover_lifecycle_attempts_marks_available_agent_succeeded():
    def _setup():
        owner = User.objects.create_user(username="owner3", password="pw")
        project = _create_project_without_signals(name="Test Project 3", owner=owner)
        agent = Agent.objects.create(
            name="worker-3",
            project=project,
            runtime="docker",
            status="idle",
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
    assert attempt.step == "agent_available"
    assert attempt.finished_at is not None


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
        """No status should transition to itself."""
        for source, targets in VALID_TRANSITIONS.items():
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

