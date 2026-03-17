import errno
import threading
import time
from pathlib import Path

import pytest

from agent.runtime.fsbridge import materialize_runtime_bindings, wait_for_provisioned_ready


def test_materialize_runtime_bindings_projects_canonical_paths(tmp_path: Path):
    root_dir = tmp_path / "root"
    container_root = tmp_path / "container"
    agent_home = container_root / "home/agent"

    (root_dir / "home/agent/.claude").mkdir(parents=True, exist_ok=True)
    (root_dir / "home/agent/.claude/settings.json").write_text('{"theme":"dark"}')
    (root_dir / "home/agent/.claude/.credentials.json").write_text('{"accessToken":"secret"}')
    (root_dir / "home/agent/.claude.json").write_text('{"hasCompletedOnboarding": true}')
    (root_dir / "home/agent/.relay_env").write_text("CLAUDE_MODEL=claude-haiku-4-5\n")
    (root_dir / "run/secrets").mkdir(parents=True, exist_ok=True)
    (root_dir / "run/secrets/proxy_key").write_text("secret")
    (root_dir / "mnt/abox-state/secrets").mkdir(parents=True, exist_ok=True)
    (root_dir / "mnt/abox-state/secrets/env").write_text("export ANTHROPIC_API_KEY=secret\n")
    (root_dir / "tmp/abox-theme").mkdir(parents=True, exist_ok=True)
    (root_dir / "tmp/abox-theme/tokens.json").write_text("{}")

    # Simulate image-baked placeholder directories that should be replaced.
    (agent_home / ".claude").mkdir(parents=True, exist_ok=True)

    materialize_runtime_bindings(root_dir, agent_home=agent_home, container_root=container_root)

    assert (agent_home / ".claude").is_dir()
    assert (agent_home / ".claude/settings.json").read_text() == '{"theme":"dark"}'
    assert (agent_home / ".claude/settings.json").is_symlink()
    assert (agent_home / ".claude/.credentials.json").read_text() == '{"accessToken":"secret"}'
    assert (agent_home / ".claude/.credentials.json").is_symlink()
    assert (agent_home / ".claude.json").is_symlink()
    assert (agent_home / ".relay_env").is_symlink()
    assert (container_root / "run/secrets").is_symlink()
    assert (container_root / "run/secrets/proxy_key").read_text() == "secret"
    assert (container_root / "mnt/abox-state").is_symlink()
    assert (container_root / "tmp/abox-theme").is_symlink()


def test_materialize_runtime_bindings_falls_back_for_busy_mount_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root_dir = tmp_path / "root"
    container_root = tmp_path / "container"
    agent_home = container_root / "home/agent"

    (root_dir / "home/agent/.claude").mkdir(parents=True, exist_ok=True)
    (root_dir / "home/agent/.claude/settings.json").write_text('{"theme":"dark"}')
    (root_dir / "mnt/abox-state/secrets").mkdir(parents=True, exist_ok=True)
    (root_dir / "mnt/abox-state/secrets/env").write_text("export ANTHROPIC_API_KEY=secret\n")

    busy_target = container_root / "mnt/abox-state"
    busy_target.mkdir(parents=True, exist_ok=True)

    from agent.runtime import fsbridge

    original = fsbridge._replace_with_symlink

    def _raise_busy(source: Path, target: Path) -> None:
        if target == busy_target:
            raise OSError(errno.EBUSY, "busy")
        original(source, target)

    monkeypatch.setattr(fsbridge, "_replace_with_symlink", _raise_busy)

    materialize_runtime_bindings(root_dir, agent_home=agent_home, container_root=container_root)

    assert (busy_target / "secrets").is_symlink()
    assert (busy_target / "secrets/env").read_text() == "export ANTHROPIC_API_KEY=secret\n"
    assert (agent_home / ".claude/settings.json").is_symlink()


def test_wait_for_provisioned_ready_blocks_until_sentinel(tmp_path: Path):
    root_dir = tmp_path / "root"
    sentinel = root_dir / "_abox/provisioned.ready"
    root_dir.mkdir(parents=True, exist_ok=True)

    def _create_sentinel() -> None:
        time.sleep(0.05)
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sentinel.touch()

    thread = threading.Thread(target=_create_sentinel, daemon=True)
    thread.start()
    wait_for_provisioned_ready(root_dir, timeout_s=1.0, poll_interval_s=0.01)
    thread.join(timeout=1)
    assert sentinel.exists()
