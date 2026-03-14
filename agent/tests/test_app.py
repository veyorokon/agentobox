from agent.runtime.app import AgentApplication
from agent.runtime.config import RuntimeConfig
from agent.contracts.lifecycle import RuntimeState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.runtime.services import ServiceGraph


def test_standalone_app_boots_and_accepts_local_tasks(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,
    )
    captured = {}

    class FakeIngressServer:
        def __init__(self, host: str, port: int, app_ref):
            captured["app"] = app_ref
            self.host = host
            self.port = port

        def start(self) -> None:
            captured["started"] = True

        def stop(self) -> None:
            captured["stopped"] = True

    class FakeServiceGroup:
        def __init__(self, graph: ServiceGraph):
            captured["graph"] = graph

        def start_all(self) -> None:
            captured["services_started"] = True

        def stop_all(self) -> None:
            captured["services_stopped"] = True

        def statuses(self):
            return {}

    app = AgentApplication(
        config,
        ingress_factory=FakeIngressServer,
        service_group_factory=FakeServiceGroup,
    )
    app.boot()
    try:
        status = app.status()
        assert status.startup_stage is StartupStage.RUNTIME_READY
        assert status.runtime_state is RuntimeState.READY
        task = app.submit_task("hello runtime")
        fetched = app.get_task(task.id)
        assert fetched is not None
        assert fetched.input_text == "hello runtime"
        assert captured["services_started"] is True
    finally:
        app.shutdown()
        assert captured["services_stopped"] is True
