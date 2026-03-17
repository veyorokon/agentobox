import json
import time
import urllib.request

from agent.contracts.theme import THEME_SCHEMA_VERSION
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.app import AgentApplication
from agent.contracts.execution import ExecutorKind
from agent.contracts.status import BuildMetadata
from agent.runtime.config import RuntimeConfig
from agent.contracts.lifecycle import RuntimeState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.runtime.services import ServiceGraph


def test_standalone_app_boots_and_accepts_local_tasks(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        build=BuildMetadata(
            image_ref="agentobox-agent-runtime:latest",
            image_digest="sha256:runtime",
            git_commit="abc123",
        ),
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


def test_standalone_app_serves_http_health_and_tasks(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        build=BuildMetadata(
            image_ref="agentobox-agent-runtime:latest",
            image_digest="sha256:runtime",
            git_commit="abc123",
        ),
        managed=None,
    )

    class FakeServiceGroup:
        def __init__(self, graph: ServiceGraph):
            self._graph = graph

        def start_all(self) -> None:
            return None

        def stop_all(self) -> None:
            return None

        def statuses(self):
            return {}

    app = AgentApplication(
        config,
        service_group_factory=FakeServiceGroup,
    )
    app.boot()
    try:
        assert app.http_server is not None
        base_url = f"http://{app.http_server.host}:{app.http_server.port}"

        livez = _get_json(f"{base_url}/livez")
        readyz = _get_json(f"{base_url}/readyz")
        status = _get_json(f"{base_url}/status")

        assert livez == {"status": "ok"}
        assert readyz["status"] == "ready"
        assert status["mode"] == "standalone"
        assert readyz["build"]["image_ref"] == "agentobox-agent-runtime:latest"
        assert readyz["build"]["image_digest"] == "sha256:runtime"
        assert status["build"]["git_commit"] == "abc123"

        task = _post_json(f"{base_url}/tasks", {"input": "hello over http"})
        assert task["state"] == "queued"
        task_id = task["id"]

        for _ in range(20):
            fetched = _get_json(f"{base_url}/tasks/{task_id}")
            if fetched["state"] == "completed":
                break
            time.sleep(0.05)
        else:
            assert False, "expected HTTP-submitted task to complete"

        assert fetched["output_text"] == "hello over http"
    finally:
        app.shutdown()


def test_standalone_app_applies_provisioned_theme_on_boot(tmp_path):
    theme_path = tmp_path / CANONICAL_PATHS["theme_tokens"]
    theme_path.parent.mkdir(parents=True, exist_ok=True)
    theme_path.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "name": "Boot Theme",
                "tokens": {
                    "surface": "#121212",
                    "accent": "#00ffaa",
                },
            }
        )
    )
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,
    )

    class FakeIngressServer:
        def __init__(self, host: str, port: int, app_ref):
            self.host = host
            self.port = port

        def start(self) -> None:
            return None

        def stop(self) -> None:
            return None

    class FakeServiceGroup:
        def __init__(self, graph: ServiceGraph):
            self._graph = graph

        def start_all(self) -> None:
            return None

        def stop_all(self) -> None:
            return None

        def statuses(self):
            return {}

    app = AgentApplication(
        config,
        ingress_factory=FakeIngressServer,
        service_group_factory=FakeServiceGroup,
    )

    app.boot()
    try:
        theme_json = json.loads((tmp_path / CANONICAL_PATHS["theme_json"]).read_text())
        theme_css = (tmp_path / CANONICAL_PATHS["theme_css"]).read_text()
        assert theme_json["name"] == "Boot Theme"
        assert "--abox-surface: #121212;" in theme_css
    finally:
        app.shutdown()


def test_standalone_app_projects_live_status_to_runtime_status_file(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,
    )

    class FakeIngressServer:
        def __init__(self, host: str, port: int, app_ref):
            self.host = host
            self.port = port

        def start(self) -> None:
            return None

        def stop(self) -> None:
            return None

    class FakeServiceGroup:
        def __init__(self, graph: ServiceGraph):
            self._graph = graph

        def start_all(self) -> None:
            return None

        def stop_all(self) -> None:
            return None

        def statuses(self):
            return {}

    app = AgentApplication(
        config,
        ingress_factory=FakeIngressServer,
        service_group_factory=FakeServiceGroup,
    )
    app.boot()
    try:
        status_path = tmp_path / CANONICAL_PATHS["runtime_status"]
        for _ in range(20):
            payload = json.loads(status_path.read_text())
            if payload["startup_stage"] == "runtime_ready":
                break
            time.sleep(0.05)
        else:
            assert False, "expected projected runtime status"

        task = app.submit_task("project me")
        for _ in range(20):
            payload = json.loads(status_path.read_text())
            runtime = payload["runtime"]
            if runtime["task_id"] == task.id and runtime["task_state"] in {"running", "completed"}:
                break
            time.sleep(0.05)
        else:
            assert False, "expected task state to be projected"

        assert payload["mode"] == "standalone"
        assert payload["build"]["image_ref"] == ""
        assert payload["transport"]["enabled"] is False
    finally:
        app.shutdown()


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(url) as response:
        return json.load(response)


def _post_json(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)
