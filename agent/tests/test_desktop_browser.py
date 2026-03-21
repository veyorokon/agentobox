from __future__ import annotations

from pathlib import Path

from agent.runtime.desktop.browser import (
    DEFAULT_BROWSER_BIN,
    browser_launch_command,
    browser_launch_env,
)
from agent.runtime.desktop.config import default_browser_url


def test_browser_launch_env_forces_software_x11_path():
    root_dir = Path("/tmp/agentobox-root")
    env = browser_launch_env(
        root_dir=root_dir,
        agent_home=Path("/home/agent"),
        display=":99",
    )

    assert env["HOME"] == "/home/agent"
    assert env["DISPLAY"] == ":99"
    assert env["AGENTOBOX_BROWSER_BIN"] == DEFAULT_BROWSER_BIN
    assert env["AGENTOBOX_BROWSER_URL"] == default_browser_url(root_dir)
    assert env["GDK_BACKEND"] == "x11"
    assert env["LIBGL_ALWAYS_SOFTWARE"] == "1"


def test_browser_launch_command_uses_chromium_profile_dir():
    command = browser_launch_command(
        agent_home=Path("/home/agent"),
        browser_url="about:blank",
    )

    assert command[0] == DEFAULT_BROWSER_BIN
    assert "--no-sandbox" in command
    assert "--disable-dev-shm-usage" in command
    assert "--disable-gpu" in command
    assert "--test-type" in command
    assert "--no-first-run" in command
    assert "--no-default-browser-check" in command
    assert "--ozone-platform=x11" in command
    assert "--new-window" in command
    assert command[-1] == "about:blank"
    assert any(
        entry == "--user-data-dir=/home/agent/.config/chromium/agentobox"
        for entry in command
    )


def test_default_browser_url_points_at_local_browser_home(tmp_path):
    expected = "http://127.0.0.1:8080/browser-home"

    assert default_browser_url(tmp_path) == expected
