"""Shared fixtures for the agentobox test suite."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from django.contrib.auth.models import AnonymousUser

from accounts.models import User
from agents.models import Agent, AgentStatus
from projects.models import Project


@pytest.fixture(scope="session")
def django_db_setup(
    request,
    django_test_environment,  # noqa: ARG001
    django_db_blocker,
    django_db_use_migrations,  # noqa: ARG001
    django_db_keepdb,
    django_db_createdb,  # noqa: ARG001
    django_db_modify_db_settings,  # noqa: ARG001
):
    """Override pytest-django's django_db_setup to terminate leaked connections.

    Async Django ORM calls (acreate, aget, etc.) run via sync_to_async in
    background threads, each with its own thread-local DB connection. Django's
    connection management cant reach these — they outlive tests and block
    DROP DATABASE ("being accessed by other users").

    This override terminates all other sessions on the test DB before calling
    teardown_databases, preventing the OperationalError warning.
    """
    from django.test.utils import setup_databases, teardown_databases

    setup_databases_args = {}
    if django_db_keepdb and not django_db_createdb:
        setup_databases_args["keepdb"] = True

    with django_db_blocker.unblock():
        db_cfg = setup_databases(
            verbosity=request.config.option.verbose,
            interactive=False,
            **setup_databases_args,
        )

    yield

    if not django_db_keepdb:
        with django_db_blocker.unblock():
            # Kill leaked async connections before DROP DATABASE
            try:
                from django.db import connection
                db_name = connection.settings_dict.get("NAME", "")
                if db_name:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "SELECT pg_terminate_backend(pid) "
                            "FROM pg_stat_activity "
                            "WHERE datname = %s AND pid != pg_backend_pid()",
                            [db_name],
                        )
            except Exception:
                pass  # intentional: best-effort cleanup before teardown
            teardown_databases(db_cfg, verbosity=request.config.option.verbose)


@pytest.fixture
def user(db):
    """Create a test user."""
    return User.objects.create_user(
        username="testuser",
        email="test@example.com",
        password="testpass1234",
    )


@pytest.fixture
def other_user(db):
    """Create a second user for ownership / permission tests."""
    return User.objects.create_user(
        username="otheruser",
        email="other@example.com",
        password="otherpass1234",
    )


@pytest.fixture
def project(user):
    """Create a project owned by `user`."""
    return Project.objects.create(
        name="Test Project",
        owner=user,
    )


@pytest.fixture
def agent(project):
    """Create an agent in `project`."""
    return Agent.objects.create(
        name="test-agent",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
    )


def _make_info(user_obj):
    """Build a mock strawberry Info with the given user on request.

    Uses SimpleNamespace for request so hasattr checks in _get_user work
    correctly — MagicMock auto-creates any attribute, which makes the
    WebSocket scope path falsely match for HTTP-only mocks.
    """
    request = SimpleNamespace(user=user_obj)
    info = MagicMock()
    info.context = {"request": request}
    return info


@pytest.fixture
def auth_info(user):
    """A mock strawberry Info with an authenticated user."""
    return _make_info(user)


@pytest.fixture
def unauth_info():
    """A mock strawberry Info with an anonymous (unauthenticated) user."""
    return _make_info(AnonymousUser())
