"""Shared fixtures for agent-side tests.

Tests should run both:
- inside the agent Docker image where code lives at ``/opt/abox/``
- on the host against the checked-out repo
"""

import os
from pathlib import Path
import sys

import pytest


def _bootstrap_pythonpath() -> None:
    """Make relay/shared modules importable in both host and container runs."""
    repo_agent_dir = Path(__file__).resolve().parents[1]
    container_path = Path("/opt/abox")
    host_paths = [
        repo_agent_dir / "claude" / "rootfs" / "opt" / "abox",
        repo_agent_dir / "rootfs" / "opt" / "abox",
    ]

    candidate_paths = []
    if container_path.exists():
        candidate_paths.append(container_path)
    candidate_paths.extend(path for path in host_paths if path.exists())

    for path in reversed(candidate_paths):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


_bootstrap_pythonpath()


@pytest.fixture(scope="session")
def agent_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def hooks_dir(agent_repo_root: Path) -> Path:
    container_hooks = Path("/opt/abox/hooks")
    if container_hooks.exists():
        return container_hooks
    return agent_repo_root / "claude" / "rootfs" / "opt" / "abox" / "hooks"


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
