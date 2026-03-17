"""Claude Code execution adapter.

This module owns Claude SDK-specific behavior only:

- preserving raw SDK message payloads
- building ClaudeSDKClient options from typed runtime config
- normalizing parsed SDK messages into runtime execution events

It does not own transport policy, websocket behavior, or backend protocol
translation. Those concerns live above this adapter.
"""

from __future__ import annotations

import asyncio
import json
import signal
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol

from agent.contracts.input import TaskInput
from agent.runtime.execution import (
    ExecutionCallbackHandler,
    ExecutionEvent,
    ExecutionEventType,
    ExecutionObserver,
)
from agent.runtime.runner import InterruptibleTaskExecutor, TaskRequest


class SDKMessageParserModule(Protocol):
    parse_message: Callable[[dict], object | None]


class SDKClientModule(Protocol):
    parse_message: Callable[[dict], object | None]


class ClaudeSDKClientLike(Protocol):
    async def connect(self, prompt: str | AsyncIterator[dict] | None = None) -> None: ...

    async def query(self, payload: AsyncIterator[dict]) -> None: ...

    async def receive_messages(self) -> AsyncIterator[object]: ...

    async def interrupt(self) -> None: ...

    async def disconnect(self) -> None: ...


class ClaudeSDKClientFactory(Protocol):
    def __call__(self, options: object) -> ClaudeSDKClientLike: ...


class PopenFactory(Protocol):
    def __call__(
        self,
        args: list[str],
        *,
        cwd: str,
        env: dict[str, str],
    ) -> subprocess.Popen[str]: ...


@dataclass(frozen=True)
class ClaudeCodeExecutorConfig:
    model: str = ""
    permission_mode: str = "bypassPermissions"
    cwd: Path = Path.cwd()
    resume_session_id: str = ""
    allowed_tools: tuple[str, ...] = ()
    mcp_servers: dict[str, object] = field(default_factory=dict)
    extra_args: dict[str, str | None] = field(default_factory=dict)
    max_buffer_size: int = 16 * 2**20
    setting_sources: tuple[str, ...] = ("user",)
    env: dict[str, str] = field(default_factory=dict)


def patch_sdk_message_parser(
    message_parser_module: SDKMessageParserModule,
    client_module: SDKClientModule,
) -> None:
    """Patch SDK parsing so every parsed message keeps its original raw dict."""

    original_parse = message_parser_module.parse_message

    def _parse_with_raw(data: dict):
        message = original_parse(data)
        if message is not None:
            message._raw = data  # noqa: SLF001 - intentional SDK-private attribute until SDK exposes raw messages directly
        return message

    message_parser_module.parse_message = _parse_with_raw
    client_module.parse_message = _parse_with_raw


def normalize_sdk_message(
    message: object,
    *,
    user_message_type: type | tuple[type, ...] | None = None,
) -> ExecutionEvent | None:
    """Normalize one parsed SDK message into a runtime execution event.

    Text-only user-message echoes are intentionally dropped. User messages that
    carry `tool_result` content are forwarded because they represent real tool
    execution output the runtime/backend may need to observe.
    """

    raw = getattr(message, "_raw", None)
    if raw is None:
        raise ValueError("sdk message is missing raw payload")

    if user_message_type and isinstance(message, user_message_type):
        content = raw.get("message", {}).get("content", [])
        has_tool_result = isinstance(content, list) and any(
            isinstance(block, dict) and block.get("type") == "tool_result"
            for block in content
        )
        if not has_tool_result:
            return None

    return ExecutionEvent(
        type=ExecutionEventType.RAW_MESSAGE,
        payload=raw,
        session_id=raw.get("session_id", ""),
    )


class ClaudeCodeExecutor(InterruptibleTaskExecutor):
    """Run one task through a Claude SDK session and emit raw execution events."""

    def __init__(
        self,
        config: ClaudeCodeExecutorConfig,
        *,
        client_factory: ClaudeSDKClientFactory,
        options_factory: Callable[[ClaudeCodeExecutorConfig, Callable[..., Awaitable[object]] | None], object]
        | None = None,
        user_message_type: type | tuple[type, ...] | None = None,
        callback_handler: ExecutionCallbackHandler | None = None,
    ):
        self._config = config
        self._client_factory = client_factory
        self._options_factory = options_factory or _default_options_factory
        self._user_message_type = user_message_type
        self._callback_handler = callback_handler
        self._active_client = _ActiveClaudeClientHandle()

    def execute(self, request: TaskRequest, observer: ExecutionObserver | None = None) -> str:
        return self.execute_streaming(request, observer)

    def execute_streaming(self, request: TaskRequest, observer: ExecutionObserver | None = None) -> str:
        return asyncio.run(self._execute_async(request, observer))

    def interrupt(self) -> bool:
        client = self._active_client.get()
        if client is None:
            return False
        asyncio.run(client.interrupt())
        return True

    def set_callback_handler(self, handler: ExecutionCallbackHandler) -> None:
        self._callback_handler = handler

    async def _execute_async(self, request: TaskRequest, observer: ExecutionObserver | None) -> str:
        options = self._options_factory(self._config, self._build_can_use_tool_callback())
        client = self._client_factory(options)
        self._active_client.set(client)
        collected_text: list[str] = []
        final_output_text = ""
        query_task: asyncio.Task[None] | None = None
        saw_final_result = False
        try:
            await client.connect()
            query_task = asyncio.create_task(client.query(_task_input_payload(request.input)))
            async for message in client.receive_messages():
                event = normalize_sdk_message(message, user_message_type=self._user_message_type)
                if event is None:
                    continue
                if observer is not None:
                    observer.on_execution_event(request.id, event)
                    result_payload = _extract_result_payload(event.payload)
                    if result_payload is not None:
                        observer.on_execution_event(
                            request.id,
                            ExecutionEvent(
                                type=ExecutionEventType.RESULT,
                                payload=result_payload,
                                session_id=event.session_id,
                            ),
                        )
                collected_text.extend(_extract_message_text_fragments(event.payload))
                result_payload = _extract_result_payload(event.payload)
                if result_payload is not None and isinstance(result_payload.get("output_text"), str):
                    final_output_text = result_payload["output_text"]
                    saw_final_result = True
                    break
            if query_task is not None:
                if saw_final_result and not query_task.done():
                    query_task.cancel()
                    await asyncio.gather(query_task, return_exceptions=True)
                else:
                    await query_task
            return final_output_text.strip() or "\n".join(fragment for fragment in collected_text if fragment).strip()
        except Exception as exc:
            if query_task is not None and not query_task.done():
                query_task.cancel()
                await asyncio.gather(query_task, return_exceptions=True)
            if observer is not None:
                observer.on_execution_event(
                    request.id,
                    ExecutionEvent(
                        type=ExecutionEventType.PROCESS_EXIT,
                        payload=_build_process_exit_payload(exc),
                    ),
                )
            raise
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass
            self._active_client.clear(client)

    def _build_can_use_tool_callback(self) -> Callable[..., Awaitable[object]] | None:
        if self._callback_handler is None:
            return None

        async def _can_use_tool(tool_name, tool_input, _context):
            result = self._callback_handler.request_callback(
                "can_use_tool",
                {
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                },
            )
            if result.get("behavior") == "allow":
                return _permission_result_allow(result.get("updated_input"))
            return _permission_result_deny(result.get("message", "Denied by user"))

        return _can_use_tool


class ClaudeCodeCLIExecutor(InterruptibleTaskExecutor):
    """Run Claude Code via the CLI directly.

    This is the pragmatic execution path for the live runtime while the SDK
    turn loop remains incompatible with the current CLI invocation behavior.
    """

    def __init__(
        self,
        config: ClaudeCodeExecutorConfig,
        *,
        popen_factory: PopenFactory | None = None,
    ):
        self._config = config
        self._popen_factory = popen_factory or _default_popen_factory
        self._callback_handler: ExecutionCallbackHandler | None = None
        self._active_process = _ActiveClaudeProcessHandle()

    def execute(self, request: TaskRequest, observer: ExecutionObserver | None = None) -> str:
        return self.execute_streaming(request, observer)

    def execute_streaming(self, request: TaskRequest, observer: ExecutionObserver | None = None) -> str:
        return self._execute_sync(request, observer)

    def interrupt(self) -> bool:
        process = self._active_process.get()
        if process is None or process.poll() is not None:
            return False
        process.send_signal(signal.SIGINT)
        return True

    def set_callback_handler(self, handler: ExecutionCallbackHandler) -> None:
        self._callback_handler = handler

    def _execute_sync(self, request: TaskRequest, observer: ExecutionObserver | None) -> str:
        if self._callback_handler is not None and self._config.permission_mode == "default":
            raise RuntimeError("interactive Claude tool approval is not supported in CLI executor mode")

        process = self._popen_factory(
            _build_cli_args(self._config, _task_prompt_text(request.input)),
            cwd=str(self._config.cwd),
            env=self._config.env,
        )
        self._active_process.set(process)
        collected_text: list[str] = []
        final_output_text = ""
        aux_output: list[str] = []

        try:
            assert process.stdout is not None
            for raw_line in process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    aux_output.append(line)
                    continue

                session_id = payload.get("session_id", "") if isinstance(payload, dict) else ""
                event = ExecutionEvent(
                    type=ExecutionEventType.RAW_MESSAGE,
                    payload=payload,
                    session_id=session_id if isinstance(session_id, str) else "",
                )
                if observer is not None:
                    observer.on_execution_event(request.id, event)
                    result_payload = _extract_cli_result_payload(payload)
                    if result_payload is not None:
                        observer.on_execution_event(
                            request.id,
                            ExecutionEvent(
                                type=ExecutionEventType.RESULT,
                                payload=result_payload,
                                session_id=event.session_id,
                            ),
                        )

                collected_text.extend(_extract_message_text_fragments(payload))
                result_text = _extract_cli_result_text(payload)
                if result_text is not None:
                    final_output_text = result_text

            exit_code = process.wait(timeout=5)
            if exit_code != 0:
                stderr_text = "\n".join(aux_output).strip()
                raise RuntimeError(
                    f"claude exited with code {exit_code}"
                    + (f": {stderr_text}" if stderr_text else "")
                )

            if final_output_text.strip():
                return final_output_text.strip()
            return "\n".join(fragment for fragment in collected_text if fragment).strip()
        except Exception as exc:
            if observer is not None:
                observer.on_execution_event(
                    request.id,
                    ExecutionEvent(
                        type=ExecutionEventType.PROCESS_EXIT,
                        payload=_build_process_exit_payload(exc),
                    ),
                )
            raise
        finally:
            if process.poll() is None:
                process.kill()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
            self._active_process.clear(process)


class _ActiveClaudeClientHandle:
    """Lock-protected handle for the currently running Claude client."""

    def __init__(self):
        self._lock = threading.Lock()
        self._client: ClaudeSDKClientLike | None = None

    def get(self) -> ClaudeSDKClientLike | None:
        with self._lock:
            return self._client

    def set(self, client: ClaudeSDKClientLike) -> None:
        with self._lock:
            self._client = client

    def clear(self, client: ClaudeSDKClientLike | None = None) -> None:
        with self._lock:
            if client is not None and self._client is not client:
                return
            self._client = None


class _ActiveClaudeProcessHandle:
    """Lock-protected handle for the currently running Claude CLI process."""

    def __init__(self):
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None

    def get(self) -> subprocess.Popen[str] | None:
        with self._lock:
            return self._process

    def set(self, process: subprocess.Popen[str]) -> None:
        with self._lock:
            self._process = process

    def clear(self, process: subprocess.Popen[str] | None = None) -> None:
        with self._lock:
            if process is not None and self._process is not process:
                return
            self._process = None


def _default_options_factory(
    config: ClaudeCodeExecutorConfig,
    can_use_tool: Callable[..., Awaitable[object]] | None,
) -> object:
    """Build ClaudeAgentOptions lazily so import failures stay local and loud."""

    try:
        from claude_agent_sdk import ClaudeAgentOptions
    except ImportError as exc:  # pragma: no cover - exercised when real SDK is present in the image, not unit tests
        raise RuntimeError("claude_agent_sdk is required for ClaudeCodeExecutor") from exc

    return ClaudeAgentOptions(
        model=config.model or None,
        permission_mode=config.permission_mode,
        allowed_tools=list(config.allowed_tools) or None,
        resume=config.resume_session_id or None,
        include_partial_messages=True,
        cli_path="claude",
        cwd=str(config.cwd),
        can_use_tool=can_use_tool,
        setting_sources=list(config.setting_sources),
        max_buffer_size=config.max_buffer_size,
        env=config.env,
        extra_args=config.extra_args,
        mcp_servers=config.mcp_servers,
    )


def _default_popen_factory(
    args: list[str],
    *,
    cwd: str,
    env: dict[str, str],
) -> subprocess.Popen[str]:
    return subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )


def _build_cli_args(config: ClaudeCodeExecutorConfig, prompt_text: str) -> list[str]:
    args = [
        "claude",
        "-p",
        prompt_text,
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        config.model or "sonnet",
        "--permission-mode",
        config.permission_mode,
        "--setting-sources",
        ",".join(config.setting_sources),
    ]
    if config.allowed_tools:
        args.extend(["--allowedTools", ",".join(config.allowed_tools)])
    return args


def _task_prompt_text(task_input: TaskInput) -> str:
    return task_input.summary_text()


async def _task_input_payload(task_input: TaskInput) -> AsyncIterator[dict]:
    yield {
        "type": "input",
        "payload": {
            "type": "user",
            "message": task_input.to_dict(),
        },
    }


def _extract_message_text_fragments(raw_event: dict[str, Any]) -> list[str]:
    """Best-effort extraction of assistant/user text blocks from raw Claude messages."""

    fragments: list[str] = []
    message = raw_event.get("message", {})
    content = message.get("content", [])
    if not isinstance(content, list):
        return fragments
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            fragments.append(block["text"])
    return fragments


def _extract_result_payload(raw_event: dict[str, Any]) -> dict[str, Any] | None:
    """Return the final result payload when Claude emits one."""

    result = raw_event.get("result")
    if not isinstance(result, dict):
        return None
    return result


def _extract_cli_result_payload(raw_event: dict[str, Any]) -> dict[str, Any] | None:
    if raw_event.get("type") != "result":
        return None
    return raw_event


def _extract_cli_result_text(raw_event: dict[str, Any]) -> str | None:
    if raw_event.get("type") != "result":
        return None
    result = raw_event.get("result")
    if isinstance(result, str):
        return result
    if isinstance(result, dict) and isinstance(result.get("output_text"), str):
        return result["output_text"]
    return None


def _build_process_exit_payload(error: Exception) -> dict[str, Any]:
    """Normalize SDK/process failures into one explicit runtime event payload."""

    payload: dict[str, Any] = {
        "error": str(error),
        "error_type": type(error).__name__,
    }
    exit_code = getattr(error, "exit_code", None)
    if isinstance(exit_code, int):
        payload["exit_code"] = exit_code
    stderr = getattr(error, "stderr", None)
    if isinstance(stderr, str) and stderr:
        payload["stderr"] = stderr
    return payload


def _permission_result_allow(updated_input=None):
    try:
        from claude_agent_sdk import PermissionResultAllow
    except ImportError as exc:  # pragma: no cover - exercised only in real image runtime
        raise RuntimeError("claude_agent_sdk is required for permission callbacks") from exc
    return PermissionResultAllow(updated_input=updated_input)


def _permission_result_deny(message: str):
    try:
        from claude_agent_sdk import PermissionResultDeny
    except ImportError as exc:  # pragma: no cover - exercised only in real image runtime
        raise RuntimeError("claude_agent_sdk is required for permission callbacks") from exc
    return PermissionResultDeny(message=message)
