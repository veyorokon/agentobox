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
from agent.runtime.desktop.config import (
    ensure_desktop_runtime_files,
    ensure_firefox_system_files,
    prepare_firefox_profile,
    render_firefox_autoconfig_js,
    render_firefox_mozilla_cfg,
)
from agent.runtime.services import ServiceGraph


def test_ensure_desktop_runtime_files_writes_awesome_config(tmp_path):
    ensure_desktop_runtime_files(tmp_path)

    rc_path = tmp_path / CANONICAL_PATHS["desktop_awesome_rc"]
    source = rc_path.read_text()

    assert 'require("beautiful")' in source
    assert 'awful.wibar({' in source
    assert 'launcher_firefox' in source
    assert "AGENTOBOX_FIREFOX_PROFILE='/home/agent/.mozilla/firefox/agentobox.default' firefox-esr about:newtab" in source
    assert 'launcher_terminal' in source
    assert str(tmp_path / CANONICAL_PATHS["theme_awesome_lua"]) in source
    assert "_G.agentobox_apply_theme = apply_theme" in source
    assert "if s.dock then" in source

    firefox_config = (tmp_path / CANONICAL_PATHS["desktop_firefox_config_css"]).read_text()
    firefox_overrides = (tmp_path / CANONICAL_PATHS["desktop_firefox_overrides_js"]).read_text()
    assert "Theme colors come from /tmp/abox-theme/userChrome.css" in firefox_config
    assert 'user_pref("browser.aboutwelcome.enabled", false);' in firefox_overrides
    assert 'user_pref("gfx.webrender.all", false);' in firefox_overrides
    assert 'user_pref("gfx.webrender.enabled", false);' in firefox_overrides
    assert 'user_pref("layers.acceleration.disabled", true);' in firefox_overrides
    assert 'user_pref("gfx.x11-egl.force-disabled", true);' in firefox_overrides
    assert 'user_pref("media.hardware-video-decoding.enabled", false);' in firefox_overrides


def test_firefox_system_bridge_writes_autoconfig_files(tmp_path):
    ensure_firefox_system_files(tmp_path)

    autoconfig = (tmp_path / "defaults/pref/autoconfig.js").read_text()
    mozilla_cfg = (tmp_path / "mozilla.cfg").read_text()
    assert autoconfig == render_firefox_autoconfig_js()
    assert mozilla_cfg == render_firefox_mozilla_cfg()
    assert 'let RELOAD_PORT = 9224;' in mozilla_cfg


def test_prepare_firefox_profile_creates_deterministic_profile(tmp_path):
    ensure_desktop_runtime_files(tmp_path)

    textfox_root = tmp_path / "opt/textfox"
    (textfox_root / "chrome").mkdir(parents=True, exist_ok=True)
    (textfox_root / "chrome/defaults.css").write_text(":root { --tf-bg: red; }\n")
    (textfox_root / "user.js").write_text('user_pref("textfox.enabled", true);\n')

    profile_dir = prepare_firefox_profile(
        tmp_path,
        agent_home=tmp_path / "home/agent",
        textfox_root=textfox_root,
    )

    assert profile_dir == tmp_path / "home/agent/.mozilla/firefox/agentobox.default"
    assert (profile_dir / "chrome/config.css").exists()
    assert (profile_dir / "user.js").exists()
    assert (profile_dir / "chrome/defaults.css").exists()
    assert 'user_pref("textfox.enabled", true);' in (profile_dir / "user.js").read_text()
    profiles_ini = (tmp_path / "home/agent/.mozilla/firefox/profiles.ini").read_text()
    assert "Path=agentobox.default" in profiles_ini
    assert "Default=1" in profiles_ini


def test_prepare_firefox_profile_clears_stale_recovery_state(tmp_path):
    ensure_desktop_runtime_files(tmp_path)

    profile_dir = tmp_path / "home/agent/.mozilla/firefox/agentobox.default"
    profile_dir.mkdir(parents=True, exist_ok=True)
    (profile_dir / "sessionstore.jsonlz4").write_text("stale")
    (profile_dir / "sessionCheckpoints.json").write_text("{}")
    (profile_dir / "sessionstore-backups").mkdir()
    (profile_dir / "crashes").mkdir()
    (profile_dir / "minidumps").mkdir()

    prepare_firefox_profile(
        tmp_path,
        agent_home=tmp_path / "home/agent",
        textfox_root=tmp_path / "opt/textfox",
    )

    assert not (profile_dir / "sessionstore.jsonlz4").exists()
    assert not (profile_dir / "sessionCheckpoints.json").exists()
    assert not (profile_dir / "sessionstore-backups").exists()
    assert not (profile_dir / "crashes").exists()
    assert not (profile_dir / "minidumps").exists()


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
        firefox_config = tmp_path / CANONICAL_PATHS["desktop_firefox_config_css"]
        firefox_overrides = tmp_path / CANONICAL_PATHS["desktop_firefox_overrides_js"]
        assert firefox_config.exists()
        assert firefox_overrides.exists()
    finally:
        app.shutdown()
