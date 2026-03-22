from types import SimpleNamespace

import pytest

from agents.services.runtime_projection import (
    agent_meets_ready_boundary,
    read_runtime_status,
    runtime_status_meets_ready_boundary,
)


pytestmark = pytest.mark.unit


def test_read_runtime_status_returns_projection_when_present():
    agent = SimpleNamespace(
        runtime_status_projection={
            "startup_stage": "managed_ready",
            "runtime_state": "ready",
        }
    )

    assert read_runtime_status(agent) == {
        "startup_stage": "managed_ready",
        "runtime_state": "ready",
    }


def test_read_runtime_status_does_not_fallback_to_volume_runtime_status():
    agent = SimpleNamespace(runtime_status_projection={})

    assert read_runtime_status(agent) == {}


def test_runtime_status_meets_ready_boundary_requires_managed_ready_for_desktop():
    assert runtime_status_meets_ready_boundary(
        {"profile": "desktop", "startup_stage": "runtime_ready"},
        relay_connected=True,
    ) is False
    assert runtime_status_meets_ready_boundary(
        {"profile": "desktop", "startup_stage": "managed_ready"},
        relay_connected=True,
    ) is True


def test_agent_meets_ready_boundary_requires_projection_and_relay():
    agent = SimpleNamespace(
        relay_connected=True,
        runtime_status_projection={"profile": "desktop", "startup_stage": "managed_ready"},
    )
    assert agent_meets_ready_boundary(agent) is True

    agent.relay_connected = False
    assert agent_meets_ready_boundary(agent) is False
