"""Desktop-profile Xvfb launcher."""

from __future__ import annotations

import os

from agent.runtime.desktop.common import exec_process


def main() -> None:
    display = os.environ.get("DISPLAY", ":99")
    resolution = os.environ.get("RESOLUTION", "1920x1080")
    exec_process(["Xvfb", display, "-screen", "0", f"{resolution}x24"])


if __name__ == "__main__":
    main()
