import pytest

from projects.services.state_volume import delete_project_state_volume, project_state_volume_name


pytestmark = pytest.mark.unit


def test_project_state_volume_name_uses_project_prefix():
    assert project_state_volume_name("12345678-aaaa-bbbb-cccc-1234567890ab") == "agentobox-state-12345678"


@pytest.mark.asyncio
async def test_delete_project_state_volume_uses_docker_for_local_runtime(monkeypatch):
    from config.app_config import app_config

    called = {}

    class FakeVolume:
        def remove(self, force=False):
            called["force"] = force

    class FakeVolumes:
        def get(self, name):
            called["name"] = name
            return FakeVolume()

    class FakeClient:
        volumes = FakeVolumes()

        def close(self):
            called["closed"] = True

    monkeypatch.setattr("projects.services.state_volume.docker.from_env", lambda: FakeClient())
    monkeypatch.setattr(app_config.agent, "runtime", "docker")

    await delete_project_state_volume("12345678-aaaa")

    assert called == {
        "name": "agentobox-state-12345678",
        "force": True,
        "closed": True,
    }


@pytest.mark.asyncio
async def test_delete_project_state_volume_uses_modal_for_modal_runtime(monkeypatch):
    from config.app_config import app_config

    called = {}

    class FakeDelete:
        async def aio(self, name, environment_name=None):
            called["name"] = name
            called["environment_name"] = environment_name

    monkeypatch.setattr("projects.services.state_volume.modal.Volume.delete", FakeDelete())
    monkeypatch.setattr(app_config.agent, "runtime", "modal")
    monkeypatch.setattr(app_config, "environment", "dev")

    await delete_project_state_volume("12345678-aaaa")

    assert called == {
        "name": "agentobox-state-12345678",
        "environment_name": "dev",
    }
