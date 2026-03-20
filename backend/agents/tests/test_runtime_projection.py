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
    class _Volume:
        def runtime_status(self):
            raise AssertionError("volume runtime_status fallback should not be used")

    agent = SimpleNamespace(runtime_status_projection={}, volume=_Volume())

    assert read_runtime_status(agent) == {}
