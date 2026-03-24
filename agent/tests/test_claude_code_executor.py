from __future__ import annotations

import asyncio
import io
from pathlib import Path

from agent.contracts.input import TaskInput
from agent.runtime.execution import ExecutionObserver
from agent.runtime.executors.claude_code import (
    ClaudeCodeCLIExecutor,
    ClaudeCodeExecutor,
    ClaudeCodeExecutorConfig,
    normalize_sdk_message,
    patch_sdk_message_parser,
)
from agent.runtime.runner import TaskRequest


class FakeMessageParserModule:
    def parse_message(self, data: dict):
        return FakeParsedMessage()


class FakeClientModule:
    parse_message = None


class FakeParsedMessage:
    pass


class FakeUserMessage:
    def __init__(self, raw: dict):
        self._raw = raw


class FakeAssistantMessage:
    def __init__(self, raw: dict):
        self._raw = raw


class RecordingExecutionObserver(ExecutionObserver):
    def __init__(self):
        self.events = []

    def on_execution_event(self, task_id: str, event) -> None:
        self.events.append((task_id, event))


class FakeClaudeClient:
    def __init__(self, messages, *, on_query=None):
        self.messages = messages
        self.connected = False
        self.interrupted = False
        self.queries = []
        self.on_query = on_query
        self.disconnected = False

    async def connect(self, prompt=None):
        self.connected = True

    async def query(self, payload):
        collected = []
        async for chunk in payload:
            collected.append(chunk)
        self.queries.extend(collected)
        if self.on_query is not None:
            await self.on_query()

    async def receive_messages(self):
        for message in self.messages:
            yield message

    async def interrupt(self):
        self.interrupted = True

    async def disconnect(self):
        self.disconnected = True


class FakeCLIProcess:
    def __init__(self, stdout_lines: list[str], *, returncode: int = 0):
        self.stdout = io.StringIO("".join(stdout_lines))
        self._returncode = returncode
        self.signals = []
        self.killed = False

    def poll(self):
        return self._returncode

    def wait(self, timeout=None):
        return self._returncode

    def send_signal(self, sig):
        self.signals.append(sig)

    def kill(self):
        self.killed = True


def test_patch_sdk_message_parser_attaches_raw_dict():
    parser_module = FakeMessageParserModule()
    client_module = FakeClientModule()

    patch_sdk_message_parser(parser_module, client_module)
    parsed = parser_module.parse_message({"hello": "world"})

    assert getattr(parsed, "_raw") == {"hello": "world"}
    assert client_module.parse_message is parser_module.parse_message


def test_normalize_sdk_message_skips_text_only_user_echoes():
    message = FakeUserMessage(
        {
            "message": {
                "content": [{"type": "text", "text": "echo"}],
            }
        }
    )

    assert normalize_sdk_message(message, user_message_type=FakeUserMessage) is None


def test_normalize_sdk_message_keeps_tool_result_user_messages():
    message = FakeUserMessage(
        {
            "session_id": "sess-2",
            "message": {
                "content": [{"type": "tool_result", "content": "ok"}],
            },
        }
    )

    event = normalize_sdk_message(message, user_message_type=FakeUserMessage)

    assert event is not None
    assert event.session_id == "sess-2"
    assert event.payload["message"]["content"][0]["type"] == "tool_result"


def test_claude_code_executor_emits_raw_messages_and_collects_text():
    messages = [
        FakeUserMessage(
            {
                "message": {"content": [{"type": "text", "text": "echo"}]},
            }
        ),
        FakeAssistantMessage(
            {
                "session_id": "sess-3",
                "message": {"content": [{"type": "text", "text": "assistant output"}]},
            }
        ),
    ]
    fake_client = FakeClaudeClient(messages)
    observer = RecordingExecutionObserver()
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
        user_message_type=FakeUserMessage,
    )

    output = executor.execute(TaskRequest(id="task-1", input=TaskInput.from_text("hello")), observer)

    assert output == "assistant output"
    assert fake_client.connected is True
    assert fake_client.queries == [
        {
            "type": "input",
            "payload": {
                "type": "user",
                "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]},
            },
        }
    ]
    assert len(observer.events) == 1
    assert observer.events[0][0] == "task-1"
    assert observer.events[0][1].session_id == "sess-3"
    assert fake_client.disconnected is True


def test_claude_code_executor_emits_result_event_and_prefers_final_output_text():
    messages = [
        FakeAssistantMessage(
            {
                "session_id": "sess-4",
                "message": {"content": [{"type": "text", "text": "streaming text"}]},
            }
        ),
        FakeAssistantMessage(
            {
                "session_id": "sess-4",
                "result": {
                    "output_text": "final output",
                    "subtype": "success",
                },
            }
        ),
    ]
    fake_client = FakeClaudeClient(messages)
    observer = RecordingExecutionObserver()
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    output = executor.execute(TaskRequest(id="task-result", input=TaskInput.from_text("hello")), observer)

    assert output == "final output"
    assert [event.type.value for _, event in observer.events] == ["raw_message", "raw_message", "result"]
    assert observer.events[-1][1].payload == {
        "output_text": "final output",
        "subtype": "success",
    }


def test_claude_code_executor_preserves_structured_task_input():
    fake_client = FakeClaudeClient([])
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    output = executor.execute(
        TaskRequest(
            id="task-structured",
            input=TaskInput.from_dict(
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "look at this"},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": "abc123",
                            },
                        },
                    ],
                }
            ),
        )
    )

    assert output == ""
    assert fake_client.connected is True
    assert fake_client.queries == [
        {
            "type": "input",
            "payload": {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "look at this"},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": "abc123",
                            },
                        },
                    ],
                },
            },
        }
    ]


def test_claude_code_executor_starts_receiving_before_query_completes():
    class BlockingQueryClient(FakeClaudeClient):
        def __init__(self):
            super().__init__([])
            self.receive_started = asyncio.Event()

        async def query(self, payload):
            await super().query(payload)
            await asyncio.wait_for(self.receive_started.wait(), timeout=0.2)

        async def receive_messages(self):
            self.receive_started.set()
            yield FakeAssistantMessage(
                {
                    "session_id": "sess-concurrent",
                    "result": {
                        "output_text": "pong",
                        "subtype": "success",
                    },
                }
            )

    fake_client = BlockingQueryClient()
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    output = executor.execute(TaskRequest(id="task-concurrent", input=TaskInput.from_text("ping")))

    assert output == "pong"


def test_claude_code_executor_stops_after_result_even_if_receive_stream_stays_open():
    class StickyReceiveClient(FakeClaudeClient):
        async def receive_messages(self):
            yield FakeAssistantMessage(
                {
                    "session_id": "sess-sticky",
                    "result": {
                        "output_text": "pong",
                        "subtype": "success",
                    },
                }
            )
            await asyncio.sleep(3600)

    fake_client = StickyReceiveClient([])
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    output = executor.execute(TaskRequest(id="task-sticky", input=TaskInput.from_text("ping")))

    assert output == "pong"
    assert fake_client.disconnected is True


def test_claude_code_executor_cancels_query_after_final_result_if_query_never_finishes():
    class StuckQueryClient(FakeClaudeClient):
        def __init__(self):
            super().__init__([])
            self.query_cancelled = False
            self.query_blocking = asyncio.Event()

        async def query(self, payload):
            await super().query(payload)
            self.query_blocking.set()
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                self.query_cancelled = True
                raise

        async def receive_messages(self):
            await asyncio.wait_for(self.query_blocking.wait(), timeout=0.2)
            yield FakeAssistantMessage(
                {
                    "session_id": "sess-query-stuck",
                    "result": {
                        "output_text": "pong",
                        "subtype": "success",
                    },
                }
            )

    fake_client = StuckQueryClient()
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    output = executor.execute(TaskRequest(id="task-query-stuck", input=TaskInput.from_text("ping")))

    assert output == "pong"
    assert fake_client.query_cancelled is True
    assert fake_client.disconnected is True


def test_claude_code_executor_can_use_tool_callback_uses_handler(monkeypatch):
    captured = {}

    class ApproveAllHandler:
        def request_callback(self, callback_type: str, payload: dict, *, timeout_s: float = 300.0) -> dict:
            captured["callback_type"] = callback_type
            captured["payload"] = payload
            return {"behavior": "allow", "message": "approved"}

    async def _invoke_callback():
        result = await captured["can_use_tool"]("Read", {"path": "/tmp/demo.txt"}, None)
        captured["permission_result"] = result

    fake_client = FakeClaudeClient([], on_query=_invoke_callback)
    monkeypatch.setattr(
        "agent.runtime.executors.claude_code._permission_result_allow",
        lambda updated_input=None: {"allowed": True, "updated_input": updated_input},
    )

    def _options_factory(config, can_use_tool):
        captured["can_use_tool"] = can_use_tool
        return {"cwd": str(config.cwd)}

    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=_options_factory,
        callback_handler=ApproveAllHandler(),
    )

    output = executor.execute(TaskRequest(id="task-2", input=TaskInput.from_text("hello")))

    assert output == ""
    assert captured["callback_type"] == "can_use_tool"
    assert captured["payload"] == {"tool_name": "Read", "tool_input": {"path": "/tmp/demo.txt"}}
    assert captured["permission_result"] == {"allowed": True, "updated_input": None}


def test_claude_code_executor_emits_process_exit_event_on_failure():
    class ExplodingClaudeClient(FakeClaudeClient):
        async def query(self, payload):
            await super().query(payload)
            raise RuntimeError("sdk failed")

    fake_client = ExplodingClaudeClient([])
    observer = RecordingExecutionObserver()
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    try:
        executor.execute(TaskRequest(id="task-3", input=TaskInput.from_text("boom")), observer)
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert str(exc) == "sdk failed"

    assert observer.events[-1][1].type.value == "process_exit"
    assert observer.events[-1][1].payload == {
        "error": "sdk failed",
        "error_type": "RuntimeError",
    }
    assert fake_client.disconnected is True


def test_claude_code_executor_preserves_process_exit_metadata():
    class FakeProcessError(RuntimeError):
        def __init__(self):
            super().__init__("sdk exited")
            self.exit_code = 17
            self.stderr = "boom"

    class ExplodingClaudeClient(FakeClaudeClient):
        async def query(self, payload):
            await super().query(payload)
            raise FakeProcessError()

    fake_client = ExplodingClaudeClient([])
    observer = RecordingExecutionObserver()
    executor = ClaudeCodeExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd()),
        client_factory=lambda _options: fake_client,
        options_factory=lambda config, _can_use_tool: {"cwd": str(config.cwd)},
    )

    try:
        executor.execute(TaskRequest(id="task-4", input=TaskInput.from_text("boom")), observer)
        assert False, "expected FakeProcessError"
    except FakeProcessError:
        pass

    assert observer.events[-1][1].payload == {
        "error": "sdk exited",
        "error_type": "FakeProcessError",
        "exit_code": 17,
        "stderr": "boom",
    }


def test_claude_code_cli_executor_returns_final_result_text():
    process = FakeCLIProcess(
        [
            '{"type":"system","subtype":"init","session_id":"sess-cli"}\n',
            '{"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]},"session_id":"sess-cli"}\n',
            '{"type":"result","subtype":"success","result":"pong","session_id":"sess-cli"}\n',
        ]
    )
    observer = RecordingExecutionObserver()
    executor = ClaudeCodeCLIExecutor(
        ClaudeCodeExecutorConfig(
            cwd=Path.cwd(),
            model="claude-opus-4-6",
            permission_mode="bypassPermissions",
            env={"PATH": ""},
        ),
        popen_factory=lambda args, *, cwd, env: process,
    )

    output = executor.execute(TaskRequest(id="task-cli", input=TaskInput.from_text("ping")), observer)

    assert output == "pong"
    assert [event.type.value for _, event in observer.events] == [
        "raw_message",
        "raw_message",
        "raw_message",
        "result",
    ]


def test_claude_code_cli_executor_rejects_nonzero_exit():
    process = FakeCLIProcess(["not json stderr\n"], returncode=1)
    observer = RecordingExecutionObserver()
    executor = ClaudeCodeCLIExecutor(
        ClaudeCodeExecutorConfig(cwd=Path.cwd(), env={"PATH": ""}),
        popen_factory=lambda args, *, cwd, env: process,
    )

    try:
        executor.execute(TaskRequest(id="task-cli-fail", input=TaskInput.from_text("ping")), observer)
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "claude exited with code 1" in str(exc)

    assert observer.events[-1][1].type.value == "process_exit"


def test_claude_code_cli_executor_passes_resume_session_id_to_cli():
    process = FakeCLIProcess(['{"type":"result","subtype":"success","result":"pong","session_id":"sess-latest"}\n'])
    captured: dict[str, object] = {}

    def _popen(args, *, cwd, env):
        captured["args"] = args
        captured["cwd"] = cwd
        captured["env"] = env
        return process

    executor = ClaudeCodeCLIExecutor(
        ClaudeCodeExecutorConfig(
            cwd=Path.cwd(),
            model="claude-opus-4-6",
            permission_mode="bypassPermissions",
            resume_session_id="sess-resume-123",
            mcp_config_path="/home/agent/.mcp.json",
            env={"PATH": ""},
        ),
        popen_factory=_popen,
    )

    output = executor.execute(TaskRequest(id="task-cli-resume", input=TaskInput.from_text("ping")))

    assert output == "pong"
    assert captured["args"] == [
        "claude",
        "-p",
        "ping",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        "claude-opus-4-6",
        "--permission-mode",
        "bypassPermissions",
        "--setting-sources",
        "user",
        "--mcp-config",
        "/home/agent/.mcp.json",
        "--resume",
        "sess-resume-123",
    ]
