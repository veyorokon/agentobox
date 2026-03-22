"""Desktop-profile websockify launcher."""

from __future__ import annotations

import os

from agent.runtime.desktop.common import exec_process


def main() -> None:
    web_root = os.environ.get("NOVNC_WEB_ROOT", "/opt/noVNC")
    exec_process(["websockify", "--web", web_root, "6080", "localhost:5900"])


if __name__ == "__main__":
    main()
