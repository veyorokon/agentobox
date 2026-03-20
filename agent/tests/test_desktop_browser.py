from __future__ import annotations

from pathlib import Path

from agent.runtime.desktop.browser import (
    DEFAULT_BROWSER_BIN,
    DEFAULT_BROWSER_URL,
    browser_launch_command,
    browser_launch_env,
)


def test_browser_launch_env_forces_software_x11_path():
    env = browser_launch_env(
        agent_home=Path("/home/agent"),
        display=":99",
    )

    assert env["HOME"] == "/home/agent"
    assert env["DISPLAY"] == ":99"
    assert env["AGENTOBOX_BROWSER_BIN"] == DEFAULT_BROWSER_BIN
    assert env["AGENTOBOX_BROWSER_URL"] == DEFAULT_BROWSER_URL
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
    assert "--no-first-run" in command
    assert "--no-default-browser-check" in command
    assert "--ozone-platform=x11" in command
    assert "--new-window" in command
    assert command[-1] == "about:blank"
    assert any(
        entry == "--user-data-dir=/home/agent/.config/chromium/agentobox"
        for entry in command
    )
