"""Tests for relay.py configuration — options building, URL construction, env handling.

These test the functions that translate environment variables (written by
lifecycle.py at provision time) into SDK options and connection parameters.
Bugs here cause agents to not start, connect to wrong endpoints, or run
with wrong permissions.

Regression coverage:
- Buffer size: locks in the 16MB fix for CLIJSONDecodeError on large screenshots
  (anthropics/claude-agent-sdk-python#98)
- URL construction: prevents scheme/path bugs that caused silent connect failures
- Mode mapping: prevents permission escalation (supervised → bypass)
"""

import os

import pytest


@pytest.fixture
def relay_module():
    import relay
    return relay


class TestBuildOptions:
    """_build_options — translates env vars to ClaudeAgentOptions."""

    def test_buffer_size_is_16mb(self, relay_module, monkeypatch):
        """Regression: SDK default is 1MB, computer-use screenshots are 2-5MB.
        Without this, agents crash with CLIJSONDecodeError on any screenshot
        of a visually complex page."""
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.max_buffer_size == 16 * 2**20

    def test_default_permission_mode_is_bypass(self, relay_module):
        """No AGENT_MODE env → bypassPermissions (fully autonomous)."""
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.permission_mode == "bypassPermissions"

    def test_supervised_mode(self, relay_module, monkeypatch):
        relay = relay_module.SDKRelay()
        options = relay._build_options(permission_mode="default")
        assert options.permission_mode == "default"

    def test_allowed_tools_parsed_from_json(self, relay_module, monkeypatch):
        monkeypatch.setenv("ALLOWED_TOOLS", '["Read", "Glob", "Grep"]')
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.allowed_tools == ["Read", "Glob", "Grep"]

    def test_invalid_allowed_tools_ignored(self, relay_module, monkeypatch):
        monkeypatch.setenv("ALLOWED_TOOLS", "not valid json")
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.allowed_tools is None

    def test_team_agent_extra_args(self, relay_module, monkeypatch):
        monkeypatch.setenv("AGENT_NAME", "backend-dev")
        monkeypatch.setenv("TEAM_NAME", "project-alpha")
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.extra_args["agent-id"] == "backend-dev@project-alpha"
        assert options.extra_args["agent-name"] == "backend-dev"
        assert options.extra_args["team-name"] == "project-alpha"

    def test_no_team_no_extra_args(self, relay_module, monkeypatch):
        monkeypatch.delenv("AGENT_NAME", raising=False)
        monkeypatch.delenv("TEAM_NAME", raising=False)
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert "agent-id" not in (options.extra_args or {})

    def test_resume_session_id(self, relay_module):
        relay = relay_module.SDKRelay()
        options = relay._build_options(resume_session_id="sess-abc-123")
        assert options.resume == "sess-abc-123"

    def test_cli_path_is_claude(self, relay_module):
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.cli_path == "claude"

    def test_include_partial_messages(self, relay_module):
        """Must be True for streaming — dashboard shows incremental output."""
        relay = relay_module.SDKRelay()
        options = relay._build_options()
        assert options.include_partial_messages is True


class TestBuildSdkEnv:
    """_build_sdk_env — env dict passed to the SDK subprocess."""

    def test_always_sets_is_sandbox(self, relay_module):
        """IS_SANDBOX=1 is required for bypassPermissions in containers.
        Without it, CLI detects sudo and refuses to start."""
        env = relay_module.SDKRelay._build_sdk_env()
        assert env["IS_SANDBOX"] == "1"

    def test_forwards_base_url_when_set(self, relay_module, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_BASE_URL", "http://localhost:9999")
        env = relay_module.SDKRelay._build_sdk_env()
        assert env["ANTHROPIC_BASE_URL"] == "http://localhost:9999"

    def test_no_base_url_when_unset(self, relay_module, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
        env = relay_module.SDKRelay._build_sdk_env()
        assert "ANTHROPIC_BASE_URL" not in env


class TestWSUrl:
    """WSTransport._ws_url — builds WS endpoint from HTTP callback URL."""

    def test_http_becomes_ws(self, relay_module, monkeypatch):
        monkeypatch.setattr(relay_module, "CALLBACK_URL", "http://backend:8000")
        transport = relay_module.WSTransport()
        url = transport._ws_url()
        assert url.startswith("ws://")
        assert "backend:8000" in url

    def test_https_becomes_wss(self, relay_module, monkeypatch):
        monkeypatch.setattr(relay_module, "CALLBACK_URL", "https://api.example.com")
        transport = relay_module.WSTransport()
        url = transport._ws_url()
        assert url.startswith("wss://")

    def test_path_includes_agent_id(self, relay_module, monkeypatch):
        monkeypatch.setattr(relay_module, "CALLBACK_URL", "http://backend:8000")
        monkeypatch.setattr(relay_module, "AGENT_ID", "agent-xyz")
        transport = relay_module.WSTransport()
        url = transport._ws_url()
        assert "/ws/relay/agent-xyz/" in url

    def test_preserves_port(self, relay_module, monkeypatch):
        monkeypatch.setattr(relay_module, "CALLBACK_URL", "http://backend:9999")
        transport = relay_module.WSTransport()
        url = transport._ws_url()
        assert ":9999" in url


class TestStderrCollection:
    """_get_stderr — assembles diagnostic output for process_exit events."""

    def test_prefers_accumulated_lines(self, relay_module):
        relay = relay_module.SDKRelay()
        relay._stderr_lines = ["line 1", "line 2", "line 3"]
        result = relay._get_stderr()
        assert result == "line 1\nline 2\nline 3"

    def test_falls_back_to_error_stderr(self, relay_module):
        relay = relay_module.SDKRelay()
        relay._stderr_lines = []

        class FakeError(Exception):
            stderr = "error stderr output"

        result = relay._get_stderr(FakeError("boom"))
        assert result == "error stderr output"

    def test_falls_back_to_error_str(self, relay_module):
        relay = relay_module.SDKRelay()
        relay._stderr_lines = []
        result = relay._get_stderr(ValueError("something broke"))
        assert result == "something broke"

    def test_empty_when_no_info(self, relay_module):
        relay = relay_module.SDKRelay()
        relay._stderr_lines = []
        result = relay._get_stderr()
        assert result == ""
