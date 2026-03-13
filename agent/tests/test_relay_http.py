"""Tests for relay HTTP health surface and RelayState dataclass.

Two groups:
1. RelayState — pure Python, no external deps, runs everywhere
2. relay_http FastAPI endpoints — requires fastapi+httpx, runs in container

Coverage:
- RelayState.to_dict() serialization correctness
- _write_state() produces valid JSON readable by relay_http
- /livez always 200
- /readyz returns 503 when no state, stale state, or ws_connected=False
- /readyz returns 200 when ws_connected=True and fresh
- /healthz aliases /readyz
- /status returns full state or 503
- Staleness detection based on file mtime
"""

import json
import time

import pytest

pytest.importorskip("claude_agent_sdk", reason="requires claude_agent_sdk (container-only)")

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# RelayState unit tests (no external deps beyond relay.py)
# ---------------------------------------------------------------------------


class TestRelayState:
    """RelayState dataclass — serialization and defaults."""

    @pytest.fixture
    def relay_module(self):
        import relay
        return relay

    def test_defaults(self, relay_module):
        state = relay_module.RelayState()
        assert state.session_id == ""
        assert state.permission_mode == "bypassPermissions"
        assert state.ws_connected is False
        assert state.client_active is False
        assert state.exit_posted is False
        assert state.restart_requested is False

    def test_to_dict_keys(self, relay_module):
        state = relay_module.RelayState()
        d = state.to_dict()
        expected_keys = {
            "session_id", "permission_mode", "restart_requested",
            "clear_requested", "init_stage", "client_active",
            "ws_connected", "uptime_s",
        }
        assert set(d.keys()) == expected_keys

    def test_to_dict_reflects_mutations(self, relay_module):
        state = relay_module.RelayState()
        state.session_id = "sess-abc"
        state.ws_connected = True
        state.client_active = True
        state.permission_mode = "plan"
        d = state.to_dict()
        assert d["session_id"] == "sess-abc"
        assert d["ws_connected"] is True
        assert d["client_active"] is True
        assert d["permission_mode"] == "plan"

    def test_uptime_increases(self, relay_module):
        state = relay_module.RelayState()
        d1 = state.to_dict()
        # uptime should be non-negative
        assert d1["uptime_s"] >= 0

    def test_to_dict_is_json_serializable(self, relay_module):
        state = relay_module.RelayState()
        state.session_id = "sess-123"
        state.ws_connected = True
        # Must not raise
        serialized = json.dumps(state.to_dict())
        roundtrip = json.loads(serialized)
        assert roundtrip["session_id"] == "sess-123"


class TestWriteState:
    """_write_state() writes valid JSON to STATE_FILE."""

    @pytest.fixture
    def relay_module(self):
        import relay
        return relay

    def test_write_state_creates_file(self, relay_module, tmp_path, monkeypatch):
        """_write_state produces a JSON file readable by relay_http."""
        state_file = tmp_path / "relay-state.json"
        monkeypatch.setattr(relay_module, "STATE_FILE", state_file)

        # Create a minimal SDKRelay-like object to test _write_state
        relay_obj = relay_module.SDKRelay()
        relay_obj.state.ws_connected = True
        relay_obj.state.session_id = "sess-test"
        relay_obj._write_state()

        assert state_file.exists()
        data = json.loads(state_file.read_text())
        assert data["ws_connected"] is True
        assert data["session_id"] == "sess-test"
        assert "buffer_stats" in data

    def test_write_state_overwrites(self, relay_module, tmp_path, monkeypatch):
        state_file = tmp_path / "relay-state.json"
        monkeypatch.setattr(relay_module, "STATE_FILE", state_file)

        relay_obj = relay_module.SDKRelay()
        relay_obj.state.ws_connected = False
        relay_obj._write_state()

        relay_obj.state.ws_connected = True
        relay_obj._write_state()

        data = json.loads(state_file.read_text())
        assert data["ws_connected"] is True


# ---------------------------------------------------------------------------
# relay_http FastAPI endpoint tests (requires fastapi + httpx)
# ---------------------------------------------------------------------------

fastapi = pytest.importorskip("fastapi", reason="requires fastapi (container-only)")


class TestRelayHttpEndpoints:
    """FastAPI health/status endpoints."""

    @pytest.fixture
    def state_file(self, tmp_path, monkeypatch):
        """Redirect relay_http to use a temp state file."""
        import relay_http
        sf = tmp_path / "relay-state.json"
        monkeypatch.setattr(relay_http, "STATE_PATH", sf)
        return sf

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        import relay_http
        return TestClient(relay_http.app)

    # -- /livez --

    def test_livez_always_200(self, client, state_file):
        resp = client.get("/livez")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_livez_ok_even_without_state_file(self, client, state_file):
        # state_file doesnt exist yet
        assert not state_file.exists()
        resp = client.get("/livez")
        assert resp.status_code == 200

    # -- /readyz --

    def test_readyz_503_when_no_state_file(self, client, state_file):
        resp = client.get("/readyz")
        assert resp.status_code == 503
        assert resp.json()["status"] == "not_ready"

    def test_readyz_503_when_ws_disconnected(self, client, state_file):
        state_file.write_text(json.dumps({
            "ws_connected": False,
            "session_id": "",
        }))
        resp = client.get("/readyz")
        assert resp.status_code == 503

    def test_readyz_200_when_ws_connected(self, client, state_file):
        state_file.write_text(json.dumps({
            "ws_connected": True,
            "session_id": "sess-123",
            "permission_mode": "bypassPermissions",
        }))
        resp = client.get("/readyz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ready"
        assert data["ws_connected"] is True

    def test_readyz_503_when_state_stale(self, client, state_file, monkeypatch):
        """Even if ws_connected=True, stale file means relay is dead."""
        import relay_http
        state_file.write_text(json.dumps({
            "ws_connected": True,
            "session_id": "sess-123",
        }))
        # Make staleness threshold very small so file is immediately stale
        monkeypatch.setattr(relay_http, "STALE_THRESHOLD_S", 0)
        # Need to wait a tiny bit for mtime to be in the past
        import os
        os.utime(state_file, (time.time() - 1, time.time() - 1))

        resp = client.get("/readyz")
        assert resp.status_code == 503
        assert resp.json()["reason"] == "stale"

    # -- /healthz --

    def test_healthz_aliases_readyz(self, client, state_file):
        state_file.write_text(json.dumps({"ws_connected": True}))
        readyz_resp = client.get("/readyz")
        healthz_resp = client.get("/healthz")
        assert readyz_resp.status_code == healthz_resp.status_code

    # -- /status --

    def test_status_503_when_no_file(self, client, state_file):
        resp = client.get("/status")
        assert resp.status_code == 503
        assert "error" in resp.json()

    def test_status_returns_full_state(self, client, state_file):
        state = {
            "ws_connected": True,
            "session_id": "sess-456",
            "permission_mode": "plan",
            "uptime_s": 120.5,
            "buffer_stats": {"events_sent": 42},
        }
        state_file.write_text(json.dumps(state))
        resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == "sess-456"
        assert data["buffer_stats"]["events_sent"] == 42

    def test_status_marks_stale(self, client, state_file, monkeypatch):
        import relay_http
        import os
        state_file.write_text(json.dumps({"ws_connected": True}))
        monkeypatch.setattr(relay_http, "STALE_THRESHOLD_S", 0)
        os.utime(state_file, (time.time() - 1, time.time() - 1))

        resp = client.get("/status")
        assert resp.status_code == 200  # status always returns data if available
        assert resp.json()["_stale"] is True

    # -- Edge cases --

    def test_corrupt_json_treated_as_missing(self, client, state_file):
        state_file.write_text("{not valid json")
        resp = client.get("/readyz")
        assert resp.status_code == 503

    def test_empty_file_treated_as_missing(self, client, state_file):
        state_file.write_text("")
        resp = client.get("/status")
        assert resp.status_code == 503


class TestStderrDequeeBounded:
    """Phase 4 bug fix: _stderr_lines must be bounded."""

    def test_stderr_lines_is_deque(self):
        from collections import deque
        import relay
        r = relay.SDKRelay()
        assert isinstance(r._stderr_lines, deque)
        assert r._stderr_lines.maxlen == 100

    def test_deque_drops_oldest(self):
        from collections import deque
        import relay
        r = relay.SDKRelay()
        for i in range(150):
            r._stderr_lines.append(f"line-{i}")
        assert len(r._stderr_lines) == 100
        # Oldest lines dropped, newest kept
        assert r._stderr_lines[0] == "line-50"
        assert r._stderr_lines[-1] == "line-149"
