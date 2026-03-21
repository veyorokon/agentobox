from __future__ import annotations
from types import SimpleNamespace

import pytest

from agents.runtimes.docker import DockerRuntime
from agents.runtimes.modal import ModalRuntime
from agents.services.project_volume import LocalProjectVolumeStore, ModalProjectVolumeStore


pytestmark = pytest.mark.unit


class TestDockerRuntimeExec:
    def test_machine_store_uses_local_project_volume_store(self, monkeypatch):
        monkeypatch.setattr("agents.runtimes.docker.app_config.volume_root", "/tmp/agentobox-vol")

        runtime = DockerRuntime.__new__(DockerRuntime)
        store = runtime.machine_store()

        assert isinstance(store, LocalProjectVolumeStore)
        assert str(store._root) == "/tmp/agentobox-vol"

    def test_resource_snapshot_reports_zero_local_runtime_facts(self):
        runtime = DockerRuntime.__new__(DockerRuntime)

        snapshot = runtime.resource_snapshot()

        assert str(snapshot.cpu_cores) == "0"
        assert snapshot.memory_mb == 0

    @pytest.mark.asyncio
    async def test_exec_raises_on_nonzero_exit(self):
        runtime = DockerRuntime.__new__(DockerRuntime)

        class FakeContainer:
            def exec_run(self, cmd, user="agent"):
                return 7, b"boom"

        runtime._client = SimpleNamespace(
            containers=SimpleNamespace(get=lambda sandbox_id: FakeContainer())
        )
        async def _run_sync(fn, *args, **kwargs):
            return fn(*args, **kwargs)

        runtime._run_sync = _run_sync

        with pytest.raises(RuntimeError, match="Docker exec failed"):
            await runtime.exec("sandbox-1", ["false"])

    @pytest.mark.asyncio
    async def test_exec_returns_output_on_success(self):
        runtime = DockerRuntime.__new__(DockerRuntime)

        class FakeContainer:
            def exec_run(self, cmd, user="agent"):
                return 0, b"ok"

        runtime._client = SimpleNamespace(
            containers=SimpleNamespace(get=lambda sandbox_id: FakeContainer())
        )
        async def _run_sync(fn, *args, **kwargs):
            return fn(*args, **kwargs)

        runtime._run_sync = _run_sync

        output = await runtime.exec("sandbox-1", ["true"])
        assert output == "ok"


class TestModalRuntimeExec:
    def test_machine_store_uses_modal_project_volume_store(self, monkeypatch):
        monkeypatch.setattr("agents.runtimes.modal.app_config.agent.volume_name", "agentobox_agent-volumes")
        monkeypatch.setattr("agents.runtimes.modal.app_config.environment", "dev")

        runtime = ModalRuntime()
        store = runtime.machine_store()

        assert isinstance(store, ModalProjectVolumeStore)
        assert store._volume_name == "agentobox_agent-volumes"
        assert store._environment_name == "dev"

    def test_resource_snapshot_reports_modal_runtime_facts(self):
        runtime = ModalRuntime()

        snapshot = runtime.resource_snapshot()

        assert float(snapshot.cpu_cores) == pytest.approx(2.0)
        assert snapshot.memory_mb == 4096

    @pytest.mark.asyncio
    async def test_create_uses_image_default_entrypoint(self, monkeypatch):
        runtime = ModalRuntime()
        captured = {}

        class FakeImage:
            def entrypoint(self, *_args, **_kwargs):
                raise AssertionError("ModalRuntime should not override the managed image entrypoint")

        fake_image = FakeImage()

        class FakeImageAPI:
            @staticmethod
            def from_registry(image_ref, secret=None):
                captured["image_ref"] = image_ref
                captured["registry_secret"] = secret
                return fake_image

        class FakeAppLookup:
            @staticmethod
            async def aio(name, create_if_missing=True):
                captured["app_lookup"] = {"name": name, "create_if_missing": create_if_missing}
                return SimpleNamespace(app_id="ap-test")

        class FakeSecretAPI:
            @staticmethod
            def from_name(name):
                return ("secret-name", name)

            @staticmethod
            def from_dict(env):
                captured["env"] = dict(env)
                return ("secret-dict", dict(env))

        class FakeSetTags:
            @staticmethod
            async def aio(tags):
                captured["tags"] = tags

        class FakeTunnels:
            @staticmethod
            async def aio():
                return {
                    6080: SimpleNamespace(url="wss://vnc.example"),
                    8080: SimpleNamespace(url="https://health.example"),
                }

        class FakeSandbox:
            object_id = "sb-test"
            set_tags = FakeSetTags()
            tunnels = FakeTunnels()

        class FakeSandboxCreate:
            @staticmethod
            async def aio(**kwargs):
                captured["create_kwargs"] = kwargs
                return FakeSandbox()

        class FakeVolumeAPI:
            @staticmethod
            def from_name(name, create_if_missing=True, environment_name=None):
                captured.setdefault("volumes", []).append(
                    {
                        "name": name,
                        "create_if_missing": create_if_missing,
                        "environment_name": environment_name,
                    }
                )
                return ("volume", name, environment_name)

        monkeypatch.setattr("agents.runtimes.modal.modal.Image", FakeImageAPI)
        monkeypatch.setattr("agents.runtimes.modal.modal.App.lookup", FakeAppLookup)
        monkeypatch.setattr("agents.runtimes.modal.modal.Secret", FakeSecretAPI)
        monkeypatch.setattr("agents.runtimes.modal.modal.Sandbox.create", FakeSandboxCreate)
        monkeypatch.setattr("agents.runtimes.modal.modal.Volume", FakeVolumeAPI)
        monkeypatch.setattr("agents.runtimes.modal.app_config.modal.app_name", "agentobox")
        monkeypatch.setattr(
            "agents.runtimes.modal.app_config.modal.agent_image",
            "ghcr.io/test/managed:sha-1234567",
        )
        monkeypatch.setattr("agents.runtimes.modal.app_config.modal.agent_image_map", {})
        monkeypatch.setattr("agents.runtimes.modal.app_config.environment", "dev")

        sandbox = await runtime.create(
            "team-lead",
            {"AGENT_ID": "agent-123", "AGENT_TYPE": "claude-code"},
            volumes=[SimpleNamespace(name="agentobox_agent-volumes", mount_path="/vol")],
        )

        assert captured["image_ref"] == "ghcr.io/test/managed:sha-1234567"
        assert captured["create_kwargs"]["image"] is fake_image
        assert captured["volumes"] == [
            {
                "name": "agentobox_agent-volumes",
                "create_if_missing": True,
                "environment_name": "dev",
            }
        ]
        assert sandbox.id == "sb-test"
        assert sandbox.vnc_url == "wss://vnc.example"
        assert sandbox.health_url == "https://health.example"

    @pytest.mark.asyncio
    async def test_exec_raises_on_nonzero_exit(self, monkeypatch):
        runtime = ModalRuntime()

        class FakeStdout:
            class read:
                @staticmethod
                async def aio():
                    return "boom"

        class FakeProcess:
            returncode = 9
            stdout = FakeStdout()

            class wait:
                @staticmethod
                async def aio():
                    return None

        class FakeExec:
            @staticmethod
            async def aio(*cmd):
                return FakeProcess()

        class FakeSandbox:
            exec = FakeExec()

        class FakeSandboxAPI:
            @staticmethod
            async def aio(sandbox_id):
                return FakeSandbox()

        monkeypatch.setattr("agents.runtimes.modal.modal.Sandbox.from_id", FakeSandboxAPI)

        with pytest.raises(RuntimeError, match="Modal exec failed"):
            await runtime.exec("sandbox-1", ["false"])

    @pytest.mark.asyncio
    async def test_exec_returns_output_on_success(self, monkeypatch):
        runtime = ModalRuntime()

        class FakeStdout:
            class read:
                @staticmethod
                async def aio():
                    return "ok"

        class FakeProcess:
            returncode = 0
            stdout = FakeStdout()

            class wait:
                @staticmethod
                async def aio():
                    return None

        class FakeExec:
            @staticmethod
            async def aio(*cmd):
                return FakeProcess()

        class FakeSandbox:
            exec = FakeExec()

        class FakeSandboxAPI:
            @staticmethod
            async def aio(sandbox_id):
                return FakeSandbox()

        monkeypatch.setattr("agents.runtimes.modal.modal.Sandbox.from_id", FakeSandboxAPI)

        output = await runtime.exec("sandbox-1", ["true"])
        assert output == "ok"

    @pytest.mark.asyncio
    async def test_sync_machine_volume_uses_sync_command(self, monkeypatch):
        runtime = ModalRuntime()
        captured = {}

        async def _exec(sandbox_id, cmd, user="agent"):
            assert sandbox_id == "sandbox-1"
            assert cmd == ["bash", "-lc", "sync /vol"]
            assert user == "agent"
            return ""

        class FakeReloadVolumes:
            @staticmethod
            async def aio():
                captured["reloaded"] = True

        class FakeSandbox:
            reload_volumes = FakeReloadVolumes()

        class FakeSandboxAPI:
            @staticmethod
            async def aio(sandbox_id):
                assert sandbox_id == "sandbox-1"
                return FakeSandbox()

        monkeypatch.setattr("agents.runtimes.modal.modal.Sandbox.from_id", FakeSandboxAPI)
        monkeypatch.setattr(runtime, "exec", _exec)

        await runtime.sync_machine_volume("sandbox-1", "/vol/agents/agent-1")
        assert captured["reloaded"] is True

    @pytest.mark.asyncio
    async def test_mirror_machine_append_writes_to_sandbox_path(self, monkeypatch):
        runtime = ModalRuntime()
        captured = {}

        async def _exec(sandbox_id, cmd, user="agent"):
            captured["sandbox_id"] = sandbox_id
            captured["cmd"] = cmd
            captured["user"] = user
            return ""

        monkeypatch.setattr(runtime, "exec", _exec)

        await runtime.mirror_machine_append(
            "sandbox-1",
            "/vol/agents/agent-1/_abox/inbox.jsonl",
            '{"type":"task"}\n',
        )

        assert captured["sandbox_id"] == "sandbox-1"
        assert captured["user"] == "agent"
        assert captured["cmd"][:2] == ["python3", "-c"]
        assert "/vol/agents/agent-1/_abox/inbox.jsonl" in captured["cmd"][2]
        assert '{"type":"task"}\\n' in captured["cmd"][2]

    @pytest.mark.asyncio
    async def test_await_machine_path_visible_retries_until_expected_content(self, monkeypatch):
        runtime = ModalRuntime()
        sync_calls: list[tuple[str, str]] = []

        async def _sync(sandbox_id, mount_path="/vol"):
            sync_calls.append((sandbox_id, mount_path))

        monkeypatch.setattr(runtime, "sync_machine_volume", _sync)

        outputs = iter(["", "token-123"])

        class FakeStdout:
            def __init__(self, text):
                self._text = text

            @property
            def read(self):
                text = self._text

                class _Reader:
                    @staticmethod
                    async def aio():
                        return text

                return _Reader()

        class FakeProcess:
            def __init__(self, text):
                self.returncode = 0
                self.stdout = FakeStdout(text)

            class wait:
                @staticmethod
                async def aio():
                    return None

        class FakeExec:
            @staticmethod
            async def aio(*cmd):
                return FakeProcess(next(outputs))

        class FakeSandbox:
            exec = FakeExec()

        class FakeSandboxAPI:
            @staticmethod
            async def aio(sandbox_id):
                assert sandbox_id == "sandbox-1"
                return FakeSandbox()

        async def _sleep(_seconds):
            return None

        monkeypatch.setattr("agents.runtimes.modal.modal.Sandbox.from_id", FakeSandboxAPI)
        monkeypatch.setattr("agents.runtimes.modal.asyncio.sleep", _sleep)

        await runtime.await_machine_path_visible(
            "sandbox-1",
            "/vol/agents/agent-1/_abox/provisioned.ready",
            expected_content="token-123",
            timeout_s=1.0,
            poll_interval_s=0.0,
        )

        assert sync_calls == [
            ("sandbox-1", "/vol"),
            ("sandbox-1", "/vol"),
        ]
