"""Shared fixtures for the agentobox test suite."""

from unittest.mock import MagicMock

import pytest
from django.contrib.auth.models import AnonymousUser

from accounts.models import User
from agents.models import Agent, AgentStatus
from projects.models import Project


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
    """Build a mock strawberry Info with the given user on request."""
    request = MagicMock()
    request.user = user_obj
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
