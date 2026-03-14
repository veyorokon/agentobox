from __future__ import annotations

from types import SimpleNamespace

import pytest

from agents.runtimes.docker import DockerRuntime
from agents.runtimes.modal import ModalRuntime


pytestmark = pytest.mark.unit


class TestDockerRuntimeExec:
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
