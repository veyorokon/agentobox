"""Desktop-profile Firefox launcher."""

from __future__ import annotations

import os
from pathlib import Path

from agent.runtime.desktop.common import exec_process, wait_for_display
from agent.runtime.desktop.config import (
    ensure_desktop_runtime_files,
    ensure_firefox_system_files,
    prepare_firefox_profile,
)


def main() -> None:
    display = os.environ.get("DISPLAY", ":99")
    root_dir = Path(os.environ.get("AGENTOBOX_ROOT_DIR", "/var/lib/agentobox-agent"))
    agent_home = Path(os.environ.get("AGENT_HOME", "/home/agent"))

    ensure_desktop_runtime_files(root_dir, agent_home=agent_home)
    ensure_firefox_system_files()
    profile_dir = prepare_firefox_profile(root_dir, agent_home=agent_home)
    wait_for_display(display)
    exec_process(
        ["/usr/bin/firefox-esr", "--profile", str(profile_dir), "--new-window", "about:newtab"],
        extra_env={
            "HOME": str(agent_home),
            "DISPLAY": display,
            "AGENTOBOX_FIREFOX_PROFILE": str(profile_dir),
        },
    )


if __name__ == "__main__":
    main()
