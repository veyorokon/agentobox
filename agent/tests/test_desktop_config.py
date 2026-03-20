from __future__ import annotations

import json

from agent.contracts.execution import ExecutorKind
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.theme import THEME_SCHEMA_VERSION
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.app import AgentApplication
from agent.runtime.config import RuntimeConfig
from agent.runtime.desktop.config import default_browser_url, ensure_desktop_runtime_files
from agent.runtime.services import ServiceGraph


def test_ensure_desktop_runtime_files_writes_awesome_config(tmp_path):
    ensure_desktop_runtime_files(tmp_path)

    rc_path = tmp_path / CANONICAL_PATHS["desktop_awesome_rc"]
    source = rc_path.read_text()

    assert 'require("beautiful")' in source
    assert 'awful.wibar({' in source
    assert 'launcher_browser' in source
    assert '/usr/bin/chromium' in source
    assert '--no-sandbox' in source
    assert '--user-data-dir=' in source
    assert default_browser_url(tmp_path) in source
    assert 'launcher_terminal' in source
    assert str(tmp_path / CANONICAL_PATHS["theme_awesome_lua"]) in source
    assert "_G.agentobox_apply_theme = apply_theme" in source
    assert "if s.dock then" in source


def test_desktop_profile_boot_writes_runtime_owned_awesome_config(tmp_path):
    theme_path = tmp_path / CANONICAL_PATHS["theme_tokens"]
    theme_path.parent.mkdir(parents=True, exist_ok=True)
    theme_path.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "name": "Desktop Theme",
                "tokens": {
                    "surface": "#111111",
                    "surface-raised": "#1f1f1f",
                    "text-default": "#f1f1f1",
                    "accent": "#ffaa00",
                },
            }
        )
    )
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        profile=RuntimeProfile.DESKTOP,
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
        rc_path = tmp_path / CANONICAL_PATHS["desktop_awesome_rc"]
        assert rc_path.exists()
        source = rc_path.read_text()
        assert str(tmp_path / CANONICAL_PATHS["theme_awesome_lua"]) in source
        assert 'beautiful.init({' in source
        assert "_G.agentobox_apply_theme = apply_theme" in source
        assert 'launcher_browser' in source
        assert default_browser_url(tmp_path) in source
    finally:
        app.shutdown()
