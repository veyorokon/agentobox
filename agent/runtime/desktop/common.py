"""Shared helpers for desktop-profile service launchers."""

from __future__ import annotations

import os
import subprocess
from time import sleep


def wait_for_display(display: str, *, attempts: int = 60, sleep_s: float = 0.5) -> None:
    """Block until an X display becomes reachable."""

    for _ in range(attempts):
        result = subprocess.run(
            ["xdpyinfo", "-display", display],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            return
        sleep(sleep_s)
    raise RuntimeError(f"display did not become ready: {display}")


def exec_process(command: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    """Replace the current process with the target command."""

    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    os.execvpe(command[0], command, env)
