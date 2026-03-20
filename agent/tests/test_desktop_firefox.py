from __future__ import annotations

from pathlib import Path

from agent.runtime.desktop.firefox import firefox_launch_env


def test_firefox_launch_env_forces_software_x11_path():
    env = firefox_launch_env(
        agent_home=Path("/home/agent"),
        display=":99",
        profile_dir=Path("/home/agent/.mozilla/firefox/agentobox.default"),
    )

    assert env["HOME"] == "/home/agent"
    assert env["DISPLAY"] == ":99"
    assert env["AGENTOBOX_FIREFOX_PROFILE"] == "/home/agent/.mozilla/firefox/agentobox.default"
    assert env["GDK_BACKEND"] == "x11"
    assert env["LIBGL_ALWAYS_SOFTWARE"] == "1"
    assert env["MOZ_X11_EGL"] == "0"
    assert env["MOZ_WEBRENDER"] == "0"
