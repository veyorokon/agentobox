from __future__ import annotations

from agent.contracts.execution import ExecutorKind
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.config import ManagedConfig, RuntimeConfig
from agent.runtime.executors.claude_code import ClaudeCodeCLIExecutor
from agent.runtime.executors.factory import build_executor
from agent.runtime.runner import EchoExecutor


def test_build_executor_returns_echo_executor_by_default(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,
    )

    executor = build_executor(config)

    assert isinstance(executor, EchoExecutor)


def test_build_executor_returns_claude_code_cli_executor(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4")
    monkeypatch.setenv("AGENT_MODE", "auto")
    monkeypatch.setenv("ALLOWED_TOOLS", '["Read","Glob"]')
    monkeypatch.setenv("RESUME_SESSION_ID", "sess-env")
    mcp_path = tmp_path / CANONICAL_PATHS["mcp_config"]
    mcp_path.parent.mkdir(parents=True, exist_ok=True)
    mcp_path.write_text('{"mcpServers": {}}')
    config = RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.CLAUDE_CODE,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )

    executor = build_executor(config)

    assert isinstance(executor, ClaudeCodeCLIExecutor)
    assert executor._config.permission_mode == "bypassPermissions"
    assert executor._config.cwd == tmp_path / "workspace"
    assert executor._config.resume_session_id == "sess-env"
    assert executor._config.mcp_config_path == "/home/agent/.mcp.json"


def test_build_executor_maps_supervised_to_noninteractive_cli_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4")
    monkeypatch.setenv("AGENT_MODE", "supervised")
    config = RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.CLAUDE_CODE,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )

    executor = build_executor(config)

    assert isinstance(executor, ClaudeCodeCLIExecutor)
    assert executor._config.permission_mode == "bypassPermissions"
    assert executor._config.cwd == tmp_path / "workspace"


def test_build_executor_override_resume_session_id_wins_over_env(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4")
    monkeypatch.setenv("AGENT_MODE", "auto")
    monkeypatch.setenv("RESUME_SESSION_ID", "sess-env")
    config = RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.CLAUDE_CODE,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )

    executor = build_executor(config, resume_session_id="sess-latest")

    assert isinstance(executor, ClaudeCodeCLIExecutor)
    assert executor._config.resume_session_id == "sess-latest"


def test_build_executor_skips_mcp_config_arg_when_machine_file_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4")
    monkeypatch.setenv("AGENT_MODE", "auto")
    config = RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.CLAUDE_CODE,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )

    executor = build_executor(config)

    assert isinstance(executor, ClaudeCodeCLIExecutor)
    assert executor._config.mcp_config_path == ""
