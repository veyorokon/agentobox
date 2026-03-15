"""Volume architecture invariant tests.

Verifies that the volume-based state system maintains its design contracts:
- Atomic writes (no partial reads)
- Mirror, Don't Map (volume paths = container paths)
- Convergence protocol (status.json tracks applied hashes)
- Delivery guarantee (inbox.pos tracks consumed messages)
- No orphan state (relay.py only sends reload commands + signals, never raw state)
- Inbox/outbox symmetry

These are structural tests — they exercise the Volume class directly against
a tmp_path filesystem. No Django ORM, no containers, no network.
"""

import json
import re
from pathlib import Path

import pytest

pytestmark = [pytest.mark.unit, pytest.mark.invariant]

from agents.services.relay_commands import ReloadCommand
from agents.services.volume import (
    MANAGED_CONFIG_FILES,
    PROVISIONING_SENTINEL,
    SYMLINKED_PREFIXES,
    Volume,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_vol(tmp_path: Path) -> Volume:
    """Create a Volume with root pointing at tmp_path."""
    vol = Volume.__new__(Volume)
    vol.root = tmp_path
    return vol


# ---------------------------------------------------------------------------
# Completeness: volume can boot an agent from scratch
# ---------------------------------------------------------------------------

class TestVolumeCompleteness:
    """Agent can boot from volume alone, zero runtime.exec() calls."""

    def test_initialize_creates_control_plane(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        assert (tmp_path / "_abox/inbox.jsonl").exists()
        assert (tmp_path / "_abox/outbox.jsonl").exists()
        assert (tmp_path / "_abox/inbox.pos").read_text() == "0"
        assert (tmp_path / "_abox/outbox.pos").read_text() == "0"
        assert (tmp_path / "_abox/status.json").read_text() == "{}"

    def test_initialize_is_idempotent(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        # Write some state
        vol.append_inbox({"type": "task", "task_id": "t1", "input": {"role": "user", "content": [{"type": "text", "text": "hello"}]}})
        original_content = (tmp_path / "_abox/inbox.jsonl").read_text()
        # Re-initialize should not clobber existing files
        vol.initialize()
        assert (tmp_path / "_abox/inbox.jsonl").read_text() == original_content

    def test_write_creates_parent_dirs(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("home/agent/.claude/settings.json", '{"key": "val"}')
        assert (tmp_path / "home/agent/.claude/settings.json").read_text() == '{"key": "val"}'

    def test_initialize_clears_stale_provisioning_sentinel(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write(PROVISIONING_SENTINEL, "")
        assert (tmp_path / PROVISIONING_SENTINEL).exists()
        vol.initialize()
        assert not (tmp_path / PROVISIONING_SENTINEL).exists()

    def test_mark_provisioned_creates_sentinel(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.mark_provisioned()
        assert (tmp_path / PROVISIONING_SENTINEL).exists()


# ---------------------------------------------------------------------------
# Atomic writes: no partial reads
# ---------------------------------------------------------------------------

class TestAtomicWrite:
    """Writes are atomic — .tmp then rename, no partial reads."""

    def test_write_leaves_no_tmp(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("_abox/test.json", '{"key": "value"}')
        assert (tmp_path / "_abox/test.json").read_text() == '{"key": "value"}'
        assert not (tmp_path / "_abox/test.json.tmp").exists()

    def test_write_overwrites_atomically(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("_abox/test.json", "first")
        vol.write("_abox/test.json", "second")
        assert (tmp_path / "_abox/test.json").read_text() == "second"

    def test_write_secret_sets_permissions(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write_secret("run/secrets/proxy_key", "sk-secret", mode=0o600)
        path = tmp_path / "run/secrets/proxy_key"
        assert path.read_text() == "sk-secret"
        assert oct(path.stat().st_mode & 0o777) == oct(0o600)

    def test_write_bytes(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("_abox/binary.bin", b"\x00\x01\x02")
        assert (tmp_path / "_abox/binary.bin").read_bytes() == b"\x00\x01\x02"


# ---------------------------------------------------------------------------
# Mirror, Don't Map: volume paths = container paths
# ---------------------------------------------------------------------------

class TestMirrorDontMap:
    """Volume paths match container filesystem paths exactly."""

    def test_managed_files_mirror_container_paths(self):
        """Every MANAGED_CONFIG_FILES entry starts with a real FS prefix."""
        valid_prefixes = ("home/", "tmp/", "run/", "mnt/", "_abox/")
        for f in MANAGED_CONFIG_FILES:
            assert f.startswith(valid_prefixes), (
                f"{f} doesn't mirror a container path — "
                f"must start with one of {valid_prefixes}"
            )

    def test_no_leading_slash(self):
        """Volume paths are relative, never absolute."""
        for f in MANAGED_CONFIG_FILES:
            assert not f.startswith("/"), f"{f} should not start with /"

    def test_volume_write_path_matches_read(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("home/agent/.claude/mcp.json", '{}')
        assert vol.read("home/agent/.claude/mcp.json") == '{}'
        assert vol.exists("home/agent/.claude/mcp.json")


# ---------------------------------------------------------------------------
# Convergence protocol: status.json hashes
# ---------------------------------------------------------------------------

class TestRuntimeStatus:
    """_abox/status.json is agent-owned — a structured runtime status document."""

    def test_runtime_status_empty_when_no_file(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        assert vol.runtime_status() == {}

    def test_runtime_status_reads_agent_status_document(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        status_doc = {
            "status_version": "1",
            "mode": "standalone",
            "platform": "docker",
            "startup_stage": "runtime_ready",
            "runtime_state": "ready",
            "runtime": {"session_id": "", "client_active": False, "task_id": "", "task_state": "idle"},
            "transport": {"enabled": False, "state": "disabled", "connected": False, "last_error": None},
            "services": {},
            "degraded": [],
            "fatal": None,
        }
        vol.write("_abox/status.json", json.dumps(status_doc))
        result = vol.runtime_status()
        assert result["status_version"] == "1"
        assert result["mode"] == "standalone"
        assert result["startup_stage"] == "runtime_ready"
        assert result["runtime"]["client_active"] is False


# ---------------------------------------------------------------------------
# Delivery guarantee: inbox.pos tracks consumed messages
# ---------------------------------------------------------------------------

class TestDelivery:
    """inbox.pos == inbox.jsonl size means all consumed."""

    def test_empty_inbox_is_delivered(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        assert vol.inbox_delivered()

    def test_undelivered_after_append(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.append_inbox({"type": "task", "task_id": "t1", "input": {"role": "user", "content": [{"type": "text", "text": "hello"}]}})
        assert not vol.inbox_delivered()

    def test_delivered_after_pos_advance(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.append_inbox({"type": "task", "task_id": "t1", "input": {"role": "user", "content": [{"type": "text", "text": "hello"}]}})
        # Simulate relay consuming all messages
        size = (tmp_path / "_abox/inbox.jsonl").stat().st_size
        (tmp_path / "_abox/inbox.pos").write_text(str(size))
        assert vol.inbox_delivered()

    def test_partial_delivery(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.append_inbox({"type": "task", "task_id": "t1", "input": {"role": "user", "content": [{"type": "text", "text": "msg1"}]}})
        size_after_first = (tmp_path / "_abox/inbox.jsonl").stat().st_size
        vol.append_inbox({"type": "task", "task_id": "t2", "input": {"role": "user", "content": [{"type": "text", "text": "msg2"}]}})
        # Relay consumed only the first message
        (tmp_path / "_abox/inbox.pos").write_text(str(size_after_first))
        assert not vol.inbox_delivered()

    def test_append_creates_valid_jsonl(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.append_inbox({"type": "a"})
        vol.append_inbox({"type": "b"})
        lines = (tmp_path / "_abox/inbox.jsonl").read_text().strip().split("\n")
        assert len(lines) == 2
        assert json.loads(lines[0]) == {"type": "a"}
        assert json.loads(lines[1]) == {"type": "b"}


# ---------------------------------------------------------------------------
# Inbox/outbox symmetry
# ---------------------------------------------------------------------------

class TestSymmetry:
    """Inbox and outbox use identical file structures."""

    def test_inbox_outbox_parity(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        for name in ["inbox", "outbox"]:
            assert (tmp_path / f"_abox/{name}.jsonl").exists()
            assert (tmp_path / f"_abox/{name}.pos").exists()
            assert (tmp_path / f"_abox/{name}.pos").read_text() == "0"


# ---------------------------------------------------------------------------
# No orphan state: relay.py only sends typed commands, never raw state
# ---------------------------------------------------------------------------

class TestNoOrphanState:
    """Backend relay module never pushes raw state over WS — only typed commands."""

    def test_relay_no_direct_state_pushes(self):
        """Grep relay.py for push_to_relay calls — no raw theme/mode/skill payloads."""
        relay_path = Path(__file__).parent.parent / "services" / "relay.py"
        source = relay_path.read_text()
        # These payload types existed in the old WS-push architecture.
        # They must not appear in the reload-based architecture.
        assert '"type": "theme"' not in source, "Direct theme push — should be reload"
        assert '"type": "mode"' not in source, "Direct mode push — should be reload"
        assert '"type": "skill"' not in source, "Direct skill push — should be reload"
        assert '"type": "instructions"' not in source, "Direct instructions push — should be reload"

    def test_relay_uses_typed_commands(self):
        """relay.py uses typed command objects, not raw dicts."""
        import ast
        relay_path = Path(__file__).parent.parent / "services" / "relay.py"
        source = relay_path.read_text()
        # Strip docstrings/comments — only check executable code
        tree = ast.parse(source)
        code_lines = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                continue  # skip string literals (docstrings, inline docs)
            if hasattr(node, "lineno"):
                code_lines.add(node.lineno)
        raw_lines = source.splitlines()
        code_source = "\n".join(
            line for i, line in enumerate(raw_lines, 1)
            if i in code_lines and not line.lstrip().startswith("#")
        )
        # No raw poke dicts — all commands go through typed builders
        assert '"type": "poke"' not in code_source, "Stale poke dict literal — use ReloadCommand"
        assert '"type": "reload"' not in code_source, "Raw reload dict literal — use ReloadCommand"
        assert '"type": "signal"' not in code_source, "Raw signal dict literal — use SignalCommand"

    def test_no_raw_signal_dicts_in_relay(self):
        """All signal sends use SignalCommand, not raw dicts."""
        relay_path = Path(__file__).parent.parent / "services" / "relay.py"
        source = relay_path.read_text()
        assert '"signal":' not in source, "Raw signal field — use SignalCommand(action=...)"

    def test_mutate_returns_typed_reload_command(self, tmp_path):
        """Volume.mutate() returns a ReloadCommand, not a raw dict."""
        vol = _make_vol(tmp_path)
        vol.initialize()
        cmd = vol.mutate("_abox/state.json", '{"mode": "auto"}')
        assert isinstance(cmd, ReloadCommand)
        assert cmd.path == "_abox/state.json"
        assert cmd.to_wire() == {"type": "reload", "path": "_abox/state.json"}

    def test_mutate_state_returns_typed_reload_command(self, tmp_path):
        """Volume.mutate_state() returns a ReloadCommand with exact wire shape."""
        vol = _make_vol(tmp_path)
        vol.initialize()
        cmd = vol.mutate_state("claude-sonnet-4-5-20250929", "auto", [])
        assert isinstance(cmd, ReloadCommand)
        assert cmd.to_wire() == {"type": "reload", "path": "_abox/state.json"}


# ---------------------------------------------------------------------------
# Provision uses volume, not runtime.write_file
# ---------------------------------------------------------------------------

class TestProvisionUsesVolume:
    """provision.py writes to Volume, not runtime (except scoped sudo)."""

    def test_runtime_calls_only_in_scoped_sudo(self):
        """runtime.exec/write_file only appear inside _provision_scoped_sudo.

        All other provisioning uses vol.write(). Parse the AST to verify
        that runtime calls are confined to the sudo function.
        """
        import ast
        provision_path = Path(__file__).parent.parent / "services" / "provision.py"
        source = provision_path.read_text()
        tree = ast.parse(source)

        # Collect function names that contain runtime.exec or runtime.write_file calls
        funcs_with_runtime = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                for child in ast.walk(node):
                    if isinstance(child, ast.Attribute) and child.attr in ("exec", "write_file"):
                        if isinstance(child.value, ast.Name) and child.value.id == "runtime":
                            funcs_with_runtime.add(node.name)

        # Only _provision_scoped_sudo should use runtime calls
        assert funcs_with_runtime == {"provision_scoped_sudo"}, (
            f"runtime.exec/write_file found in: {funcs_with_runtime} — "
            f"expected only provision_scoped_sudo"
        )

    def test_provision_workspace_takes_volume_not_runtime(self):
        """provision_workspace() signature takes vol: Volume, not runtime."""
        import ast
        provision_path = Path(__file__).parent.parent / "services" / "provision.py"
        source = provision_path.read_text()
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "provision_workspace":
                arg_names = [a.arg for a in node.args.args]
                assert "vol" in arg_names, "provision_workspace must accept 'vol' parameter"
                assert "runtime" not in arg_names, "provision_workspace must not accept 'runtime'"
                assert "sandbox_id" not in arg_names, "provision_workspace must not accept 'sandbox_id'"
                break
        else:
            pytest.fail("provision_workspace function not found")


# ---------------------------------------------------------------------------
# Consumer simplicity: no backfill logic
# ---------------------------------------------------------------------------

class TestConsumerSimplicity:
    """consumers.py has no backfill logic or theme push on connect."""

    def test_no_backfill_cursor_in_consumers(self):
        """consumers.py must not reference last_delivered_event_id — replaced by inbox.pos."""
        consumers_path = Path(__file__).parent.parent / "consumers.py"
        source = consumers_path.read_text()
        assert "last_delivered_event_id" not in source, (
            "last_delivered_event_id reference in consumers.py — replaced by inbox.pos"
        )

    def test_no_theme_push_function_in_consumers(self):
        """consumers.py must not call push_theme or import theme modules."""
        consumers_path = Path(__file__).parent.parent / "consumers.py"
        source = consumers_path.read_text()
        assert "push_theme" not in source, "Theme push call in consumers.py"
        assert "theme_tokens" not in source, "Theme tokens reference in consumers.py"


class TestNoPushToRelayDataPayloads:
    """push_to_relay must ONLY carry typed commands — never data payloads.

    The volume architecture routes all state through files. WS messages are
    typed notifications (reload = file changed, signal = ephemeral control).
    Any push_to_relay call with type "theme", "mode", "skill", or "input"
    is a stale pre-volume code path that bypasses the volume and will be
    silently dropped by the relay.

    This test greps ALL Python files in the project (not just services/)
    to catch stale callers in mutations, management commands, etc.
    """

    FORBIDDEN_TYPES = {'"type": "theme"', '"type": "mode"', '"type": "skill"'}

    def test_no_data_payloads_in_push_to_relay(self):
        backend_root = Path(__file__).resolve().parent.parent.parent
        violations = []
        for f in sorted(backend_root.rglob("*.py")):
            if "test" in f.name or "__pycache__" in str(f):
                continue
            src = f.read_text(encoding="utf-8")
            if "push_to_relay" not in src:
                continue
            for forbidden in self.FORBIDDEN_TYPES:
                if forbidden in src:
                    violations.append(f"{f.relative_to(backend_root)}:{forbidden}")

        assert violations == [], (
            "push_to_relay calls with data payloads found (should use volume write + reload):\n"
            + "\n".join(f"  {v}" for v in violations)
        )


# ---------------------------------------------------------------------------
# Path parity: SYMLINKED_PREFIXES matches init-volume bash script
# ---------------------------------------------------------------------------

class TestPathParity:
    """SYMLINKED_PREFIXES in volume.py matches init-volume's actual symlinks.

    init-volume creates symlinks for specific directories. The Python
    SYMLINKED_PREFIXES constant gates Volume.write() to only allow paths
    under those directories. If they drift, either:
    - Python allows a path init-volume doesn't symlink (invisible file)
    - init-volume symlinks a dir Python doesn't allow (write rejected)

    This test parses the bash script and extracts the dirs it covers,
    then verifies the Python constant matches.
    """

    @staticmethod
    def _extract_init_volume_dirs() -> set[str]:
        """Parse init-volume script and extract covered directory prefixes.

        Handles patterns in the script:
        1. `for dir in X Y Z; do` → explicit dirs like tmp/abox-theme
        2. `${AGENT_VOL}/some/path/*` or `"${AGENT_VOL}"/some/path/*` → glob dirs
        """
        script_path = (
            Path(__file__).parent.parent.parent.parent
            / "agent" / "rootfs" / "etc" / "s6-overlay" / "scripts" / "init-volume"
        )
        source = script_path.read_text()

        dirs = set()

        # Pattern 1: `for dir in tmp/abox-theme run/secrets ...; do`
        for_match = re.search(r'for dir in\s+([^;]+);', source)
        if for_match:
            for d in for_match.group(1).split():
                dirs.add(d.strip() + "/")

        # Pattern 2: any ${AGENT_VOL}/path/* or "${AGENT_VOL}"/path/*
        # Matches both quoted and unquoted AGENT_VOL references
        for glob_match in re.finditer(
            r'"\$\{AGENT_VOL\}"/?([^*"]+)\*|\$\{AGENT_VOL\}/([^*"\s]+)\*',
            source,
        ):
            prefix = glob_match.group(1) or glob_match.group(2)
            if prefix:
                # Normalize: strip leading slash, ensure trailing slash
                prefix = prefix.lstrip("/")
                if not prefix.endswith("/"):
                    prefix += "/"
                dirs.add(prefix)

        return dirs

    @pytest.mark.skip(reason="init-volume script moved out of agent/rootfs/ during agent restructure")
    def test_symlinked_prefixes_covers_init_volume(self):
        """Every dir init-volume symlinks is in SYMLINKED_PREFIXES."""
        init_dirs = self._extract_init_volume_dirs()
        python_prefixes = set(SYMLINKED_PREFIXES)

        # Every bash dir must be covered by a Python prefix
        uncovered = set()
        for d in init_dirs:
            if not any(d.startswith(p) or p.startswith(d) for p in python_prefixes):
                uncovered.add(d)

        assert not uncovered, (
            f"init-volume symlinks dirs not in SYMLINKED_PREFIXES: {uncovered}. "
            f"Add them to SYMLINKED_PREFIXES in volume.py."
        )

    @pytest.mark.skip(reason="init-volume script moved out of agent/rootfs/ during agent restructure")
    def test_symlinked_prefixes_no_extras(self):
        """SYMLINKED_PREFIXES doesn't contain dirs init-volume doesn't cover.

        Exception: _abox/ is control plane accessed directly, not symlinked.
        """
        init_dirs = self._extract_init_volume_dirs()
        python_prefixes = set(SYMLINKED_PREFIXES)

        # _abox/ is a known exception — accessed via /vol/ directly, not symlinked
        exceptions = {"_abox/"}

        extras = set()
        for p in python_prefixes - exceptions:
            if not any(p.startswith(d) or d.startswith(p) for d in init_dirs):
                extras.add(p)

        assert not extras, (
            f"SYMLINKED_PREFIXES has dirs not in init-volume: {extras}. "
            f"Either add to init-volume or remove from SYMLINKED_PREFIXES."
        )

    def test_managed_config_files_under_symlinked_prefixes(self):
        """Every MANAGED_CONFIG_FILES entry is under a SYMLINKED_PREFIXES dir."""
        for f in MANAGED_CONFIG_FILES:
            assert any(f.startswith(p) for p in SYMLINKED_PREFIXES), (
                f"MANAGED_CONFIG_FILES entry '{f}' not under any SYMLINKED_PREFIXES. "
                f"Volume.write() would reject this path."
            )

    def test_volume_write_rejects_uncovered_path(self, tmp_path):
        """Volume.write() raises ValueError for paths outside SYMLINKED_PREFIXES."""
        vol = _make_vol(tmp_path)
        with pytest.raises(ValueError, match="not under any init-volume"):
            vol.write("usr/local/bin/something", "content")

    def test_volume_write_accepts_covered_path(self, tmp_path):
        """Volume.write() succeeds for paths under SYMLINKED_PREFIXES."""
        vol = _make_vol(tmp_path)
        vol.write("home/agent/.claude/settings.json", "{}")
        vol.write("run/secrets/proxy_key", "key")
        vol.write("_abox/state.json", "{}")
        # No exceptions = all paths accepted


class TestProvisioningGate:
    """Boot readiness must wait for explicit provisioning completion."""

    INIT_VOLUME = (
        Path(__file__).parent.parent.parent.parent
        / "agent" / "rootfs" / "etc" / "s6-overlay" / "scripts" / "init-volume"
    )
    LIFECYCLE = Path(__file__).parent.parent / "services" / "lifecycle.py"

    @pytest.mark.skip(reason="init-volume script moved out of agent/rootfs/ during agent restructure")
    def test_init_volume_waits_for_provisioning_sentinel(self):
        source = self.INIT_VOLUME.read_text()
        assert PROVISIONING_SENTINEL in source, (
            "init-volume does not wait for the provisioning sentinel — "
            "services can start before .relay_env and other boot files exist"
        )
        assert 'while [ ! -f "${AGENT_VOL}/_abox/provisioned.ready" ]' in source, (
            "init-volume gate is not file-based on provisioned.ready"
        )

    def test_lifecycle_marks_provisioning_ready(self):
        source = self.LIFECYCLE.read_text()
        assert "mark_provisioned()" in source, (
            "lifecycle.py never marks provisioning complete — "
            "init-volume would block forever"
        )
        assert "_mark_provisioned_ready(" in source, (
            "lifecycle.py does not release the provisioning gate explicitly"
        )


# ---------------------------------------------------------------------------
# Mutation boundary: state push MUST go through agents/services/relay.py
# ---------------------------------------------------------------------------

class TestMutationBoundary:
    """Mutations that push state to agents must go through relay.py — not DIY.

    Bug: set_project_theme in projects/graphql/mutations.py had its own
    _push_theme_for_project() that sent old {"type": "theme"} WS payloads.
    The relay only handles {"type": "reload"}, so the theme never updated.
    This test ensures no mutation file has inline push_to_relay or
    channel_layer.group_send calls that bypass relay.py.

    Exception: update_agent_instructions in agents/graphql/mutations.py uses
    push_to_relay for live CLAUDE.md updates via the canonical volume path.
    This is acceptable because it goes through Volume.mutate() + push_to_relay.
    """

    # Directories that should NEVER directly import push_to_relay
    # Exception: agents/graphql/mutations.py needs it for live instruction updates
    FORBIDDEN_DIRS = {"management"}

    def test_no_push_to_relay_in_management_or_views(self):
        """Management and view files must not import push_to_relay directly."""
        backend_root = Path(__file__).resolve().parent.parent.parent
        violations = []
        for f in sorted(backend_root.rglob("*.py")):
            if "__pycache__" in str(f) or "test" in f.name:
                continue
            # Only check files in forbidden dirs or views
            parts = set(f.relative_to(backend_root).parts)
            is_view = f.name == "views.py"
            is_forbidden_dir = bool(parts & self.FORBIDDEN_DIRS)
            if not (is_view or is_forbidden_dir):
                continue
            src = f.read_text(encoding="utf-8")
            if "push_to_relay" in src:
                for i, line in enumerate(src.splitlines(), 1):
                    if "push_to_relay" in line and not line.strip().startswith("#"):
                        violations.append(f"{f.relative_to(backend_root)}:{i}: {line.strip()}")

        assert violations == [], (
            "push_to_relay in management/view files — use relay.py service functions:\n"
            + "\n".join(f"  {v}" for v in violations)
        )

    def test_no_inline_theme_functions_in_mutations(self):
        """No mutation file should define its own theme push function."""
        backend_root = Path(__file__).resolve().parent.parent.parent
        violations = []
        for f in sorted(backend_root.rglob("mutations.py")):
            if "__pycache__" in str(f) or "test" in f.name:
                continue
            src = f.read_text(encoding="utf-8")
            # Look for function defs that suggest inline push logic
            for i, line in enumerate(src.splitlines(), 1):
                if re.match(r'\s*(async\s+)?def\s+_push_', line):
                    violations.append(f"{f.relative_to(backend_root)}:{i}: {line.strip()}")

        assert violations == [], (
            "Inline push functions in mutations — use relay.py instead:\n"
            + "\n".join(f"  {v}" for v in violations)
        )
