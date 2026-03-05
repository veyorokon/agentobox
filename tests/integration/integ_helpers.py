"""
Shared helpers for integration tests.

Provides utilities that go beyond what the GraphQL API exposes —
e.g., reading relay tokens from the DB via docker exec.
"""

from __future__ import annotations

import json
import subprocess


def get_agent_relay_token(agent_id: str) -> str:
    """Read relay_token from the DB for a given agent.

    Uses docker exec to run a Django one-liner inside the backend container.
    This is intentionally not exposed via GraphQL (it's a secret).
    Integration tests need it to impersonate the relay WS client.
    """
    cmd = [
        "docker", "compose", "exec", "-T", "backend",
        "uv", "run", "python", "-c",
        f"import django, os; "
        f"os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
        f"django.setup(); "
        f"from agents.models import Agent; "
        f"print(Agent.objects.get(id='{agent_id}').relay_token)",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(f"Failed to get relay_token: {result.stderr.strip()}")
    return result.stdout.strip()


def set_agent_relay_token(agent_id: str, token: str) -> None:
    """Set relay_token on an agent directly in the DB.

    For tests that need a known token without going through full provisioning.
    """
    cmd = [
        "docker", "compose", "exec", "-T", "backend",
        "uv", "run", "python", "-c",
        f"import django, os; "
        f"os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
        f"django.setup(); "
        f"from agents.models import Agent; "
        f"Agent.objects.filter(id='{agent_id}').update(relay_token='{token}')",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(f"Failed to set relay_token: {result.stderr.strip()}")


def set_agent_status(agent_id: str, status: str) -> None:
    """Set agent lifecycle status directly in the DB.

    For tests that need to put an agent in a specific state without
    going through the full provisioning/lifecycle flow.
    """
    cmd = [
        "docker", "compose", "exec", "-T", "backend",
        "uv", "run", "python", "-c",
        f"import django, os; "
        f"os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
        f"django.setup(); "
        f"from agents.models import Agent; "
        f"Agent.objects.filter(id='{agent_id}').update(status='{status}')",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(f"Failed to set status: {result.stderr.strip()}")
