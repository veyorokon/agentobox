"""Tests for agents.adapters.claude_code — shell escape utility.

_shell_escape delegates to shlex.quote(), which wraps values in single
quotes and handles all shell metacharacters. These tests verify the
contract: output is a fully-quoted shell-safe string.
"""

import uuid

from agents.adapters.claude_code import _shell_escape
import pytest

from accounts.models import User
from agents.models import (
    Agent,
    AgentLifecycleAttempt,
    AgentLifecycleAttemptStatus,
    AgentLifecycleKind,
)
from agents.services.lifecycle import (
    _create_lifecycle_attempt_sync,
    _update_lifecycle_attempt_sync,
)
from agents.services.reconcile import recover_lifecycle_attempts
from asgiref.sync import sync_to_async
from projects.models import Project


def _create_project_without_signals(*, name: str, owner: User) -> Project:
    project = Project(id=uuid.uuid4(), name=name, owner=owner)
    Project.objects.bulk_create([project])
    return project


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
