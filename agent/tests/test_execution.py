from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.runtime.execution import ExecutionEvent, ExecutionEventType, ExecutionObserver
from agent.runtime.runner import TaskRequest, TaskRunner
from agent.runtime.state import RuntimeStateStore


class RecordingExecutionObserver(ExecutionObserver):
    def __init__(self):
        self.events: list[tuple[str, ExecutionEvent]] = []

    def on_execution_event(self, task_id: str, event: ExecutionEvent) -> None:
        self.events.append((task_id, event))


class StreamingEchoExecutor:
    def execute(self, request: TaskRequest) -> str:
        return request.input_text

    def execute_streaming(self, request: TaskRequest, observer: ExecutionObserver | None = None) -> str:
        if observer is not None:
            observer.on_execution_event(
                request.id,
                ExecutionEvent(
                    type=ExecutionEventType.RAW_MESSAGE,
                    payload={"message": {"content": [{"type": "text", "text": request.input_text}]}},
                    session_id="sess-1",
                ),
            )
        return request.input_text


def test_task_runner_dispatches_streaming_execution_events():
    state = RuntimeStateStore(mode=AgentMode.STANDALONE, platform=PlatformKind.LOCAL)
    observer = RecordingExecutionObserver()
    runner = TaskRunner(state, executor=StreamingEchoExecutor())
    runner.add_execution_observer(observer)
    runner.start()

    try:
        task = runner.submit("hello stream")
        import time

        for _ in range(20):
            record = runner.get(task.id)
            if record and record.state == "completed":
                break
            time.sleep(0.05)
        else:
            assert False, "task did not complete"

        assert len(observer.events) == 1
        task_id, event = observer.events[0]
        assert task_id == task.id
        assert event.type is ExecutionEventType.RAW_MESSAGE
        assert event.session_id == "sess-1"
    finally:
        runner.stop()
