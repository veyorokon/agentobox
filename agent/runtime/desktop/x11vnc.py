"""Desktop-profile x11vnc launcher."""

from __future__ import annotations

import os

from agent.runtime.desktop.common import exec_process, wait_for_display


def main() -> None:
    display = os.environ.get("DISPLAY", ":99")
    wait_for_display(display)
    exec_process(
        [
            "x11vnc",
            "-display",
            display,
            "-nopw",
            "-listen",
            "localhost",
            "-forever",
            "-shared",
            "-rfbport",
            "5900",
            "-noxdamage",
            "-xfixes",
        ]
    )


if __name__ == "__main__":
    main()
