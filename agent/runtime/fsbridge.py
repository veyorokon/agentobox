"""Materialize canonical runtime files at the container-visible paths tools expect.

The managed runtime treats ``AGENTOBOX_ROOT_DIR`` as the canonical provisioned
tree, but external tools like Claude Code and desktop applications still read conventional
paths such as ``/home/agent/.claude`` and ``/run/secrets``. This module creates
an explicit bridge from the canonical tree into those container-visible paths.
"""

from __future__ import annotations

import os
import shutil
import time
import errno
from pathlib import Path
import sys


_TOP_LEVEL_LINKS = (
    ("workspace", "workspace"),
    ("tmp/abox-theme", "tmp/abox-theme"),
    ("run/secrets", "run/secrets"),
    ("mnt/abox-state", "mnt/abox-state"),
)

_HOME_FILE_BINDINGS = (
    ("home/agent/.relay_env", ".relay_env"),
    ("home/agent/.claude.json", ".claude.json"),
    ("home/agent/.mcp.json", ".mcp.json"),
    ("home/agent/CLAUDE.md", "CLAUDE.md"),
)

_HOME_DIR_BINDINGS = ()

_CLAUDE_FILE_BINDINGS = (
    ("home/agent/.claude/settings.json", ".claude/settings.json"),
    ("home/agent/.claude/.credentials.json", ".claude/.credentials.json"),
)


def materialize_runtime_bindings(
    root_dir: Path,
    *,
    agent_home: Path = Path("/home/agent"),
    container_root: Path = Path("/"),
) -> None:
    """Project runtime-owned files into the in-container paths tools read.

    ``root_dir`` remains the source of truth. This bridge only creates symlinks
    so legacy tool paths resolve into that tree.
    """

    root_dir = root_dir.resolve()
    container_root = container_root.resolve()
    agent_home.mkdir(parents=True, exist_ok=True)

    for rel_source, rel_target in _TOP_LEVEL_LINKS:
        source = root_dir / rel_source
        if not source.exists():
            continue
        _materialize_binding(source, container_root / rel_target)

    for rel_source, rel_target in _HOME_FILE_BINDINGS:
        source = root_dir / rel_source
        if source.exists():
            _materialize_binding(source, agent_home / rel_target)

    for rel_source, rel_target in _HOME_DIR_BINDINGS:
        source = root_dir / rel_source
        if source.exists():
            _materialize_binding(source, agent_home / rel_target)

    claude_dir = agent_home / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)
    for rel_source, rel_target in _CLAUDE_FILE_BINDINGS:
        source = root_dir / rel_source
        if source.exists():
            _materialize_binding(source, agent_home / rel_target)


def _materialize_binding(source: Path, target: Path) -> None:
    try:
        _replace_with_symlink(source, target)
    except OSError as exc:
        # Docker-managed project state can appear as a mounted directory that
        # cannot be replaced atomically. In that case, project the source
        # directory contents into the mount rather than aborting the whole
        # bridge and skipping later bindings like /home/agent/.claude/*.
        if exc.errno == errno.EBUSY and source.is_dir() and target.exists() and target.is_dir():
            _sync_directory_links(source, target)
            return
        raise


def wait_for_provisioned_ready(
    root_dir: Path,
    *,
    timeout_s: float = 120.0,
    poll_interval_s: float = 0.25,
    required_token: str = "",
) -> None:
    sentinel = root_dir / "_abox/provisioned.ready"
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if sentinel.exists():
            if not required_token:
                return
            if sentinel.read_text().strip() == required_token:
                return
        time.sleep(poll_interval_s)
    raise TimeoutError(f"provisioned sentinel never appeared: {sentinel}")


def _replace_with_symlink(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or target.is_file():
        target.unlink()
    elif target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()
    target.symlink_to(source)


def _sync_directory_links(source_dir: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for child in source_dir.iterdir():
        _materialize_binding(child, target_dir / child.name)


def main() -> None:
    root_dir = Path(os.environ.get("AGENTOBOX_ROOT_DIR", "/var/lib/agentobox-agent"))
    agent_home = Path(os.environ.get("AGENT_HOME", "/home/agent"))
    if "--wait" in sys.argv[1:]:
        wait_for_provisioned_ready(
            root_dir,
            timeout_s=float(os.environ.get("AGENTOBOX_PROVISIONING_TIMEOUT_S", "120")),
            poll_interval_s=float(os.environ.get("AGENTOBOX_PROVISIONING_POLL_INTERVAL_S", "0.25")),
            required_token=os.environ.get("RELAY_AUTH_TOKEN", "").strip(),
        )
    materialize_runtime_bindings(root_dir, agent_home=agent_home)


if __name__ == "__main__":
    main()
