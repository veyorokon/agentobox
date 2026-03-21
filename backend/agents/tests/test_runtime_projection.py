from types import SimpleNamespace

import pytest

from agents.services.runtime_projection import read_runtime_status


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
