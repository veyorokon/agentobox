"""Desktop-profile Chromium launcher."""

from __future__ import annotations

import os
from pathlib import Path

from agent.runtime.desktop.common import exec_process, wait_for_display
from agent.runtime.desktop.config import ensure_desktop_runtime_files


DEFAULT_BROWSER_BIN = "/usr/bin/chromium"
DEFAULT_BROWSER_URL = "about:blank"


def browser_launch_env(*, agent_home: Path, display: str) -> dict[str, str]:
    """Return a conservative Chromium launch environment for virtual desktops."""

    return {
        "HOME": str(agent_home),
        "DISPLAY": display,
        "AGENTOBOX_BROWSER_BIN": os.environ.get("AGENTOBOX_BROWSER_BIN", DEFAULT_BROWSER_BIN),
        "AGENTOBOX_BROWSER_URL": os.environ.get("AGENTOBOX_BROWSER_URL", DEFAULT_BROWSER_URL),
        "GDK_BACKEND": "x11",
        "LIBGL_ALWAYS_SOFTWARE": "1",
    }


def browser_launch_command(*, agent_home: Path, browser_url: str) -> list[str]:
    """Return the Chromium command line used for the desktop profile."""

    return [
        os.environ.get("AGENTOBOX_BROWSER_BIN", DEFAULT_BROWSER_BIN),
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--ozone-platform=x11",
        f"--user-data-dir={agent_home / '.config/chromium/agentobox'}",
        "--new-window",
        browser_url,
    ]


def main() -> None:
    display = os.environ.get("DISPLAY", ":99")
    root_dir = Path(os.environ.get("AGENTOBOX_ROOT_DIR", "/var/lib/agentobox-agent"))
    agent_home = Path(os.environ.get("AGENT_HOME", "/home/agent"))

    ensure_desktop_runtime_files(root_dir, agent_home=agent_home)
    wait_for_display(display)
    browser_url = os.environ.get("AGENTOBOX_BROWSER_URL", DEFAULT_BROWSER_URL)
    exec_process(
        browser_launch_command(agent_home=agent_home, browser_url=browser_url),
        extra_env=browser_launch_env(agent_home=agent_home, display=display),
    )


if __name__ == "__main__":
    main()
