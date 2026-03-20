from __future__ import annotations

from types import SimpleNamespace

import pytest

from agents.services.project_volume import AgentMachinePaths, ModalProjectVolumeStore


pytestmark = pytest.mark.unit


def test_modal_project_volume_store_writes_machine_relative_paths(monkeypatch):
    captured = {}

    class FakeBatch:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def put_file(self, fileobj, remote_path, mode=None):
            captured["remote_path"] = remote_path
            captured["content"] = fileobj.read()
            captured["mode"] = mode

    class FakeVolume:
        def batch_upload(self, force=True):
            captured["force"] = force
            return FakeBatch()

    monkeypatch.setattr(
        "agents.services.project_volume.modal.Volume.from_name",
        lambda *args, **kwargs: FakeVolume(),
    )

    store = ModalProjectVolumeStore("agentobox_agent-volumes", environment_name="dev")
    machine = AgentMachinePaths(project_id="proj-1", agent_id="agent-1")

    store.write_bytes(machine, "_abox/state.json", b'{"mode":"auto"}')

    assert captured["force"] is True
    assert captured["remote_path"] == "/agents/agent-1/_abox/state.json"
    assert captured["content"] == b'{"mode":"auto"}'
    assert captured["mode"] is None


def test_modal_project_volume_store_reads_machine_relative_paths(monkeypatch):
    class FakeVolume:
        def read_file(self, path):
            assert path == "/agents/agent-1/_abox/state.json"
            yield b'{"mode":"'
            yield b'auto"}'

        def listdir(self, path, recursive=False):
            return [SimpleNamespace(path="agents/agent-1/_abox/state.json", size=15)]

    monkeypatch.setattr(
        "agents.services.project_volume.modal.Volume.from_name",
        lambda *args, **kwargs: FakeVolume(),
    )

    store = ModalProjectVolumeStore("agentobox_agent-volumes", environment_name="dev")
    machine = AgentMachinePaths(project_id="proj-1", agent_id="agent-1")

    assert store.exists(machine, "_abox/state.json") is True
    assert store.read_text(machine, "_abox/state.json") == '{"mode":"auto"}'
    assert store.stat_size(machine, "_abox/state.json") == 15
