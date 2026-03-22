"""Shared helpers for desktop-profile service launchers."""

from __future__ import annotations

import os
import subprocess
from time import sleep

from agent.runtime.logging import emit_event


def wait_for_display(display: str, *, attempts: int = 60, sleep_s: float = 0.5) -> None:
    """Block until an X display becomes reachable."""

    for attempt in range(1, attempts + 1):
        result = subprocess.run(
            ["xdpyinfo", "-display", display],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            emit_event("desktop.display_ready", display=display, attempts=attempt)
            return
        sleep(sleep_s)
    emit_event("desktop.display_timeout", display=display, attempts=attempts)
    raise RuntimeError(f"display did not become ready: {display}")


def exec_process(command: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    """Replace the current process with the target command."""

    cmd_name = os.path.basename(command[0]) if command else "unknown"
    emit_event("desktop.launch_requested", command=cmd_name)

    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    os.execvpe(command[0], command, env)
