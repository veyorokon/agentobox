"""Desktop-profile AwesomeWM launcher."""

from __future__ import annotations

import os
from pathlib import Path

from agent.runtime.desktop.common import exec_process, wait_for_display
from agent.runtime.desktop.config import ensure_desktop_runtime_files
from agent.provisioning.manifest import CANONICAL_PATHS


def main() -> None:
    display = os.environ.get("DISPLAY", ":99")
    root_dir = os.environ.get("AGENTOBOX_ROOT_DIR", "/var/lib/agentobox-agent")
    agent_home = os.environ.get("AGENT_HOME", "/home/agent")
    ensure_desktop_runtime_files(Path(root_dir))
    wait_for_display(display)
    config_path = str(Path(root_dir) / CANONICAL_PATHS["desktop_awesome_rc"])
    exec_process(["awesome", "-c", config_path], extra_env={"HOME": agent_home})


if __name__ == "__main__":
    main()
