from __future__ import annotations

from agent.contracts.execution import ExecutorKind
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
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
