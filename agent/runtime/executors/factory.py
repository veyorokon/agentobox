"""Executor factory for runtime-owned task execution."""

from __future__ import annotations

from agent.contracts.execution import ExecutorKind
from agent.runtime.config import RuntimeConfig
from agent.runtime.executors.claude_code import ClaudeCodeCLIExecutor, ClaudeCodeExecutorConfig
from agent.runtime.runner import EchoExecutor, TaskExecutor


def build_executor(config: RuntimeConfig) -> TaskExecutor:
    """Build the configured executor for this runtime instance."""

    if config.executor is ExecutorKind.ECHO:
        return EchoExecutor()
    if config.executor is ExecutorKind.CLAUDE_CODE:
        return ClaudeCodeCLIExecutor(
            ClaudeCodeExecutorConfig(
                model=_env("CLAUDE_MODEL"),
                permission_mode=_translate_permission_mode(_env("AGENT_MODE")),
                cwd=config.root_dir / "home/agent/workspace",
                resume_session_id=_env("RESUME_SESSION_ID"),
                allowed_tools=_parse_allowed_tools(_env("ALLOWED_TOOLS")),
                env=_executor_env(),
            ),
        )
    raise ValueError(f"unsupported executor kind: {config.executor.value}")


def _executor_env() -> dict[str, str]:
    import os

    env = dict(os.environ)
    env.setdefault("IS_SANDBOX", "1")
    return env


def _parse_allowed_tools(raw: str) -> tuple[str, ...]:
    import json

    if not raw:
        return ()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return ()
    if not isinstance(parsed, list):
        return ()
    return tuple(tool for tool in parsed if isinstance(tool, str))


def _translate_permission_mode(raw_mode: str) -> str:
    mode_map = {
        "auto": "bypassPermissions",
        "plan": "plan",
        "supervised": "bypassPermissions",
    }
    return mode_map.get(raw_mode, "bypassPermissions")


def _env(name: str) -> str:
    import os

    return os.environ.get(name, "").strip()
