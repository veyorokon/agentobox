"""Shared fixtures for agent-side tests.

Tests run inside the agent Docker image where code lives at /opt/abox/.
On the host, agent/tests/ is bind-mounted to /opt/abox/tests/.
"""

import os
import sys
import tempfile

import pytest

# Add /opt/abox to path so tests can import relay, abox_logging, etc.
# On host this resolves to agent/rootfs/opt/abox/ — doesn't matter,
# tests only run inside the container.
sys.path.insert(0, "/opt/abox")


@pytest.fixture(autouse=True)
def _relay_env(monkeypatch):
    """Set minimum env vars that relay.py reads at module level."""
    monkeypatch.setenv("AGENT_ID", "test-agent-001")
    monkeypatch.setenv("ABOX_CALLBACK_URL", "http://backend:8000")
    monkeypatch.setenv("RELAY_AUTH_TOKEN", "test-token-abc123")


@pytest.fixture
def secrets_dir(tmp_path):
    """Create a temp /run/secrets/ directory with test secret files."""
    d = tmp_path / "secrets"
    d.mkdir()
    return d


@pytest.fixture
def env_file(tmp_path):
    """Create a temp secrets env file."""
    f = tmp_path / "env"
    return f
