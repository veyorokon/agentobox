"""Desktop-profile Firefox launcher."""

from __future__ import annotations

import os
from pathlib import Path

from agent.runtime.desktop.common import exec_process, wait_for_display
from agent.runtime.desktop.config import (
    ensure_desktop_runtime_files,
    prepare_firefox_profile,
)


def firefox_launch_env(*, agent_home: Path, display: str, profile_dir: Path) -> dict[str, str]:
    """Return a conservative Firefox launch environment for virtual desktops."""

    return {
        "HOME": str(agent_home),
        "DISPLAY": display,
        "AGENTOBOX_FIREFOX_PROFILE": str(profile_dir),
        # Keep Firefox on the X11 software path in Xvfb-backed runtimes.
        "GDK_BACKEND": "x11",
        "LIBGL_ALWAYS_SOFTWARE": "1",
        "MOZ_X11_EGL": "0",
        "MOZ_WEBRENDER": "0",
    }


def main() -> None:
    display = os.environ.get("DISPLAY", ":99")
    root_dir = Path(os.environ.get("AGENTOBOX_ROOT_DIR", "/var/lib/agentobox-agent"))
    agent_home = Path(os.environ.get("AGENT_HOME", "/home/agent"))

    ensure_desktop_runtime_files(root_dir, agent_home=agent_home)
    profile_dir = prepare_firefox_profile(root_dir, agent_home=agent_home)
    wait_for_display(display)
    exec_process(
        ["/usr/bin/firefox-esr", "--profile", str(profile_dir), "--new-window", "about:newtab"],
        extra_env=firefox_launch_env(
            agent_home=agent_home,
            display=display,
            profile_dir=profile_dir,
        ),
    )


if __name__ == "__main__":
    main()
