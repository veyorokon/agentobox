"""
Lifecycle domain fixtures.

Provides test_agent fixture that creates a Docker agent,
waits for it to reach idle/running, yields it, then cleans up.
"""

from __future__ import annotations

import uuid

import pytest

from helpers.polling import poll_agent_status


@pytest.fixture
def test_agent(gql, test_project):
    """Create an agent, wait for it to be ready, yield, then cleanup.

    The agent gets a unique name to avoid cross-test contamination.
    Polls until the agent reaches idle or running status (up to 90s).
    Cleanup kills and removes the agent regardless of test outcome.
    """
    agent_name = f"e2e-lifecycle-{uuid.uuid4().hex[:8]}"
    agent = gql.create_agent(
        test_project["id"],
        name=agent_name,

        instructions="You are an e2e test agent. Wait for instructions.",
    )
    agent_id = agent["id"]

    try:
        # Wait for agent to be ready
        ready_agent = poll_agent_status(
            gql,
            agent_id,
            target_statuses=["idle", "running", "waiting"],
            timeout_s=90,
            interval_s=3,
        )
        yield ready_agent
    except Exception:
        # If polling fails, still yield the raw agent for diagnostics
        yield agent
    finally:
        # Best-effort cleanup
        try:
            gql.kill_agent(agent_id)
        except Exception:
            pass
        try:
            gql.remove_agent(agent_id)
        except Exception:
            pass
