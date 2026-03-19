"""Black-box managed Docker contract tests.

These tests are intentionally opt-in because they build and run the real
managed image. They validate the runtime-visible file contract and the managed
bootstrap handoff without pulling the fast unit suite into Docker orchestration.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from queue import Queue

import pytest
from websockets.sync.server import ServerConnection, serve

from agent.provisioning.manifest import CANONICAL_PATHS, write_json


REPO_ROOT = Path(__file__).resolve().parents[2]
ENABLE_ENV = "AGENTOBOX_RUN_DOCKER_CONTRACT_TESTS"


def _docker(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["docker", *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"docker {' '.join(args)} failed with code {result.returncode}: "
            f"{(result.stderr or result.stdout).strip()}"
        )
    return result


def _require_docker_contract_tests() -> None:
    if os.environ.get(ENABLE_ENV) != "1":
        pytest.skip(f"set {ENABLE_ENV}=1 to run Docker-managed contract tests")
    if shutil.which("docker") is None:
        pytest.skip("docker CLI is not available")
    try:
        _docker("version", "--format", "{{.Server.Version}}")
    except RuntimeError as exc:
        pytest.skip(f"docker daemon is not available: {exc}")


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class FakeRelayServer:
    """Minimal relay peer for managed image contract tests.

    The image only needs a successful websocket peer to reach managed-ready.
    This server intentionally stays tiny: it accepts a connection and captures
    upstream messages so the test can assert the runtime actually attached.
    """

    def __init__(self):
        self.port = _pick_free_port()
        self._started = threading.Event()
        self._stop_requested = threading.Event()
        self._connected = threading.Event()
        self._messages: Queue[dict] = Queue()
        self._server = None
        self._thread = threading.Thread(target=self._serve, name="fake-relay", daemon=True)

    def start(self) -> None:
        self._thread.start()
        if not self._started.wait(timeout=5):
            raise RuntimeError("fake relay server did not start")

    def stop(self) -> None:
        self._stop_requested.set()
        server = self._server
        if server is not None:
            server.shutdown()
        self._thread.join(timeout=5)

    def wait_for_connection(self, timeout_s: float = 10.0) -> bool:
        return self._connected.wait(timeout_s)

    def wait_for_message(self, timeout_s: float = 10.0) -> dict:
        return self._messages.get(timeout=timeout_s)

    def _serve(self) -> None:
        def handler(connection: ServerConnection) -> None:
            self._connected.set()
            while not self._stop_requested.is_set():
                try:
                    raw = connection.recv(timeout=0.25)
                except TimeoutError:
                    continue
                except Exception:
                    break
                if raw is None:
                    break
                if isinstance(raw, str):
                    self._messages.put(json.loads(raw))

        with serve(handler, "0.0.0.0", self.port) as server:
            self._server = server
            self._started.set()
            server.serve_forever()


def _write_managed_contract(root_dir: Path) -> None:
    (root_dir / "home/agent").mkdir(parents=True, exist_ok=True)
    (root_dir / "home/agent/.claude").mkdir(parents=True, exist_ok=True)
    (root_dir / "_abox").mkdir(parents=True, exist_ok=True)
    (root_dir / "run/secrets").mkdir(parents=True, exist_ok=True)
    (root_dir / "mnt/abox-state/secrets").mkdir(parents=True, exist_ok=True)
    (root_dir / CANONICAL_PATHS["relay_env"]).write_text("RELAY_AUTH_TOKEN=test-token\n")
    (root_dir / CANONICAL_PATHS["claude_settings"]).write_text('{"theme":"dark"}')
    (root_dir / "home/agent/.claude.json").write_text('{"hasCompletedOnboarding":true}')
    (root_dir / "run/secrets/proxy_key").write_text("proxy-key")
    (root_dir / CANONICAL_PATHS["secret_env"]).write_text("export ANTHROPIC_API_KEY=secret\n")
    write_json(root_dir / CANONICAL_PATHS["runtime_state"], {"mode": "managed"})
    write_json(root_dir / CANONICAL_PATHS["runtime_status"], {})
    (root_dir / CANONICAL_PATHS["provisioned_ready"]).touch()


def _http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=2.0) as response:
        return json.load(response)


def _http_get_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=2.0) as response:
        return response.read().decode("utf-8")


def _container_logs(container_id: str) -> str:
    result = _docker("logs", container_id, check=False)
    return (result.stdout or "") + (result.stderr or "")


def _container_state(container_id: str) -> dict[str, str]:
    result = _docker(
        "inspect",
        "-f",
        "{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}",
        container_id,
        check=False,
    )
    raw = (result.stdout or "").strip()
    if not raw:
        return {"status": "missing", "exit_code": "", "error": (result.stderr or "").strip()}
    status, exit_code, error = raw.split("|", 2)
    return {"status": status, "exit_code": exit_code, "error": error}


def _container_exec(container_id: str, *command: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return _docker("exec", container_id, *command, check=check)


def _wait_for(predicate, *, timeout_s: float, interval_s: float = 0.1, message: str):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(interval_s)
    raise AssertionError(message)


@pytest.fixture(scope="module")
def managed_image_tag():
    _require_docker_contract_tests()
    tag = f"agentobox-agent-managed:test-{uuid.uuid4().hex[:12]}"
    _docker("build", "-f", "agent/Dockerfile.managed", "-t", tag, "./agent")
    try:
        yield tag
    finally:
        _docker("rmi", "-f", tag, check=False)


@pytest.fixture(scope="module")
def managed_desktop_image_tag():
    _require_docker_contract_tests()
    base_tag = f"agentobox-agent-managed-base:test-{uuid.uuid4().hex[:12]}"
    tag = f"agentobox-agent-managed-desktop:test-{uuid.uuid4().hex[:12]}"
    _docker("build", "-f", "agent/Dockerfile.managed", "-t", base_tag, "./agent")
    _docker(
        "build",
        "-f",
        "agent/Dockerfile.desktop.managed",
        "--build-arg",
        f"BASE_IMAGE={base_tag}",
        "-t",
        tag,
        "./agent",
    )
    try:
        yield tag
    finally:
        _docker("rmi", "-f", tag, check=False)
        _docker("rmi", "-f", base_tag, check=False)


def test_managed_docker_image_waits_for_provisioning_then_reaches_ready(tmp_path, managed_image_tag):
    relay = FakeRelayServer()
    relay.start()

    container_name = f"agentobox-managed-contract-{uuid.uuid4().hex[:12]}"
    run_result = _docker(
        "run",
        "-d",
        "--name",
        container_name,
        "--add-host",
        "host.docker.internal:host-gateway",
        "-p",
        "127.0.0.1::8080",
        "-e",
        "AGENT_ID=agent-contract-123",
        "-e",
        f"ABOX_CALLBACK_URL=http://host.docker.internal:{relay.port}",
        "-e",
        "RELAY_AUTH_TOKEN=test-token",
        "-e",
        "AGENTOBOX_PROVISIONING_TIMEOUT_S=20",
        "-e",
        "AGENTOBOX_PROVISIONING_POLL_INTERVAL_S=0.05",
        "-v",
        f"{tmp_path}:/var/lib/agentobox-agent",
        managed_image_tag,
    )
    container_id = run_result.stdout.strip()
    failed = True

    try:
        _wait_for(
            lambda: _docker("inspect", "-f", "{{.State.Running}}", container_id).stdout.strip() == "true",
            timeout_s=10,
            message="managed container never entered running state",
        )

        port_result = _docker("port", container_id, "8080/tcp")
        base_url = f"http://127.0.0.1:{port_result.stdout.strip().rsplit(':', 1)[-1]}"

        with pytest.raises((urllib.error.URLError, ConnectionError, TimeoutError, OSError)):
            _http_get_json(f"{base_url}/livez")

        _write_managed_contract(tmp_path)

        def _ready_or_exited() -> dict | None:
            state = _container_state(container_id)
            if state["status"] in {"exited", "dead"}:
                raise AssertionError(
                    "managed container exited before reaching ready "
                    f"(status={state['status']}, exit_code={state['exit_code']}, error={state['error'] or 'none'})"
                )
            return _ready_status(base_url)

        status = _wait_for(
            _ready_or_exited,
            timeout_s=20,
            interval_s=0.2,
            message="managed image never reached ready after provisioning",
        )

        assert status["mode"] == "managed"
        assert status["startup_stage"] == "managed_ready"
        assert status["runtime_state"] == "ready"
        assert status["transport"]["connected"] is True

        assert relay.wait_for_connection(timeout_s=10) is True
        upstream = relay.wait_for_message(timeout_s=10)
        assert upstream["type"] == "runtime_hello"

        settings = _container_exec(container_id, "cat", "/home/agent/.claude/settings.json")
        onboarding = _container_exec(container_id, "cat", "/home/agent/.claude.json")
        proxy_key = _container_exec(container_id, "cat", "/run/secrets/proxy_key")
        assert settings.stdout.strip() == '{"theme":"dark"}'
        assert onboarding.stdout.strip() == '{"hasCompletedOnboarding":true}'
        assert proxy_key.stdout.strip() == "proxy-key"

        status_raw = _container_exec(
            container_id, "cat", f"/var/lib/agentobox-agent/{CANONICAL_PATHS['runtime_status']}"
        )
        projected = json.loads(status_raw.stdout)
        assert projected["startup_stage"] == "managed_ready"
        assert projected["transport"]["connected"] is True
        failed = False
    except AssertionError as exc:
        logs = _container_logs(container_id)
        raise AssertionError(f"{exc}\n\nmanaged container logs:\n{logs}") from exc
    finally:
        relay.stop()
        if failed:
            print(_container_logs(container_id))
        _docker("rm", "-f", container_id, check=False)


def test_managed_desktop_docker_image_reaches_ready_and_serves_novnc(
    tmp_path, managed_desktop_image_tag
):
    relay = FakeRelayServer()
    relay.start()

    container_name = f"agentobox-managed-desktop-contract-{uuid.uuid4().hex[:12]}"
    run_result = _docker(
        "run",
        "-d",
        "--name",
        container_name,
        "--add-host",
        "host.docker.internal:host-gateway",
        "-p",
        "127.0.0.1::8080",
        "-p",
        "127.0.0.1::6080",
        "-e",
        "AGENT_ID=agent-contract-desktop-123",
        "-e",
        f"ABOX_CALLBACK_URL=http://host.docker.internal:{relay.port}",
        "-e",
        "RELAY_AUTH_TOKEN=test-token",
        "-e",
        "AGENTOBOX_PROVISIONING_TIMEOUT_S=20",
        "-e",
        "AGENTOBOX_PROVISIONING_POLL_INTERVAL_S=0.05",
        "-v",
        f"{tmp_path}:/var/lib/agentobox-agent",
        managed_desktop_image_tag,
    )
    container_id = run_result.stdout.strip()
    failed = True

    try:
        _wait_for(
            lambda: _docker("inspect", "-f", "{{.State.Running}}", container_id).stdout.strip() == "true",
            timeout_s=10,
            message="managed desktop container never entered running state",
        )

        http_port_result = _docker("port", container_id, "8080/tcp")
        base_url = f"http://127.0.0.1:{http_port_result.stdout.strip().rsplit(':', 1)[-1]}"

        novnc_port_result = _docker("port", container_id, "6080/tcp")
        novnc_url = f"http://127.0.0.1:{novnc_port_result.stdout.strip().rsplit(':', 1)[-1]}"

        with pytest.raises((urllib.error.URLError, ConnectionError, TimeoutError, OSError)):
            _http_get_json(f"{base_url}/livez")

        _write_managed_contract(tmp_path)

        def _ready_or_exited() -> dict | None:
            state = _container_state(container_id)
            if state["status"] in {"exited", "dead"}:
                raise AssertionError(
                    "managed desktop container exited before reaching ready "
                    f"(status={state['status']}, exit_code={state['exit_code']}, error={state['error'] or 'none'})"
                )
            status = _ready_status(base_url)
            if status is None:
                return None
            services = status.get("services", {})
            required = {"xvfb": "up", "x11vnc": "up", "awesome": "up"}
            if any(services.get(name) != state for name, state in required.items()):
                return None
            if services.get("websockify") != "up":
                return None
            if services.get("firefox") != "up":
                return None
            return status

        status = _wait_for(
            _ready_or_exited,
            timeout_s=30,
            interval_s=0.2,
            message="managed desktop image never reached ready with desktop services up",
        )

        assert status["mode"] == "managed"
        assert status["profile"] == "desktop"
        assert status["startup_stage"] == "managed_ready"
        assert status["runtime_state"] == "ready"
        assert status["transport"]["connected"] is True
        assert status["services"]["xvfb"] == "up"
        assert status["services"]["x11vnc"] == "up"
        assert status["services"]["websockify"] == "up"
        assert status["services"]["awesome"] == "up"
        assert status["services"]["firefox"] == "up"

        assert relay.wait_for_connection(timeout_s=10) is True
        upstream = relay.wait_for_message(timeout_s=10)
        assert upstream["type"] == "runtime_hello"
        assert upstream["profile"] == "desktop"

        settings = _container_exec(container_id, "cat", "/home/agent/.claude/settings.json")
        onboarding = _container_exec(container_id, "cat", "/home/agent/.claude.json")
        proxy_key = _container_exec(container_id, "cat", "/run/secrets/proxy_key")
        claude_version = _container_exec(container_id, "claude", "--version")
        assert settings.stdout.strip() == '{"theme":"dark"}'
        assert onboarding.stdout.strip() == '{"hasCompletedOnboarding":true}'
        assert proxy_key.stdout.strip() == "proxy-key"
        assert claude_version.stdout.strip().startswith("2.1.71")

        novnc_index = _wait_for(
            lambda: _http_get_text(novnc_url),
            timeout_s=10,
            interval_s=0.2,
            message="desktop image never served the noVNC web surface",
        )
        assert "noVNC" in novnc_index

        firefox_config = _container_exec(
            container_id, "cat", f"/var/lib/agentobox-agent/{CANONICAL_PATHS['desktop_firefox_config_css']}"
        )
        firefox_overrides = _container_exec(
            container_id, "cat", f"/var/lib/agentobox-agent/{CANONICAL_PATHS['desktop_firefox_overrides_js']}"
        )
        assert "userChrome.css" in firefox_config.stdout
        assert 'user_pref("browser.aboutwelcome.enabled", false);' in firefox_overrides.stdout

        autoconfig = _container_exec(
            container_id,
            "cat",
            "/usr/lib/firefox-esr/defaults/pref/autoconfig.js",
        )
        mozilla_cfg = _container_exec(
            container_id,
            "cat",
            "/usr/lib/firefox-esr/mozilla.cfg",
        )
        assert 'pref("general.config.filename", "mozilla.cfg");' in autoconfig.stdout
        assert 'let RELOAD_PORT = 9224;' in mozilla_cfg.stdout

        status_raw = _container_exec(
            container_id, "cat", f"/var/lib/agentobox-agent/{CANONICAL_PATHS['runtime_status']}"
        )
        projected = json.loads(status_raw.stdout)
        assert projected["profile"] == "desktop"
        assert projected["services"]["xvfb"] == "up"
        assert projected["services"]["x11vnc"] == "up"
        assert projected["services"]["websockify"] == "up"
        assert projected["services"]["awesome"] == "up"
        assert projected["services"]["firefox"] == "up"
        failed = False
    except AssertionError as exc:
        logs = _container_logs(container_id)
        raise AssertionError(f"{exc}\n\nmanaged desktop container logs:\n{logs}") from exc
    finally:
        relay.stop()
        if failed:
            print(_container_logs(container_id))
        _docker("rm", "-f", container_id, check=False)


def _ready_status(base_url: str) -> dict | None:
    try:
        payload = _http_get_json(f"{base_url}/readyz")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    if payload.get("status") != "ready":
        return None
    return _http_get_json(f"{base_url}/status")
