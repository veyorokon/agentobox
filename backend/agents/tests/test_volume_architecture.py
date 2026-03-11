"""Volume architecture invariant tests.

Verifies that the volume-based state system maintains its design contracts:
- Atomic writes (no partial reads)
- Mirror, Don't Map (volume paths = container paths)
- Convergence protocol (status.json tracks applied hashes)
- Delivery guarantee (inbox.pos tracks consumed messages)
- No orphan state (comms.py only sends pokes + signals, never raw state)
- Inbox/outbox symmetry

These are structural tests — they exercise the Volume class directly against
a tmp_path filesystem. No Django ORM, no containers, no network.
"""

import json
import re
from pathlib import Path

import pytest

pytestmark = [pytest.mark.unit, pytest.mark.invariant]

from agents.services.volume import MANAGED_CONFIG_FILES, SYMLINKED_PREFIXES, Volume


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
        vol.append_inbox({"type": "input", "payload": "hello"})
        original_content = (tmp_path / "_abox/inbox.jsonl").read_text()
        # Re-initialize should not clobber existing files
        vol.initialize()
        assert (tmp_path / "_abox/inbox.jsonl").read_text() == original_content

    def test_write_creates_parent_dirs(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("home/agent/.claude/settings.json", '{"key": "val"}')
        assert (tmp_path / "home/agent/.claude/settings.json").read_text() == '{"key": "val"}'


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

class TestConvergence:
    """status.json hashes match config file hashes = fully converged."""

    def test_unconverged_after_write(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.write("_abox/state.json", '{"mode": "auto"}')
        assert not vol.is_converged()
        assert "_abox/state.json" in vol.pending_changes()

    def test_converged_after_status_update(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.write("_abox/state.json", '{"mode": "auto"}')
        # Simulate relay applying and updating status
        h = vol.file_hash("_abox/state.json")
        status = {"_abox/state.json": h}
        vol.write("_abox/status.json", json.dumps(status))
        assert vol.is_converged()
        assert vol.pending_changes() == []

    def test_unconverged_after_second_write(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.write("_abox/state.json", '{"mode": "auto"}')
        h = vol.file_hash("_abox/state.json")
        vol.write("_abox/status.json", json.dumps({"_abox/state.json": h}))
        assert vol.is_converged()
        # Backend writes new state — relay hasn't applied yet
        vol.write("_abox/state.json", '{"mode": "plan"}')
        assert not vol.is_converged()

    def test_missing_files_are_skipped(self, tmp_path):
        """Files that don't exist yet are not counted as unconverged."""
        vol = _make_vol(tmp_path)
        vol.initialize()
        # No config files written — should be converged (nothing to apply)
        assert vol.is_converged()

    def test_file_hash_is_deterministic(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("_abox/test.json", '{"stable": true}')
        h1 = vol.file_hash("_abox/test.json")
        h2 = vol.file_hash("_abox/test.json")
        assert h1 == h2
        assert len(h1) == 16  # truncated sha256

    def test_file_hash_changes_on_content_change(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.write("_abox/test.json", "v1")
        h1 = vol.file_hash("_abox/test.json")
        vol.write("_abox/test.json", "v2")
        h2 = vol.file_hash("_abox/test.json")
        assert h1 != h2


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
        vol.append_inbox({"type": "input", "payload": "hello"})
        assert not vol.inbox_delivered()

    def test_delivered_after_pos_advance(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.append_inbox({"type": "input", "payload": "hello"})
        # Simulate relay consuming all messages
        size = (tmp_path / "_abox/inbox.jsonl").stat().st_size
        (tmp_path / "_abox/inbox.pos").write_text(str(size))
        assert vol.inbox_delivered()

    def test_partial_delivery(self, tmp_path):
        vol = _make_vol(tmp_path)
        vol.initialize()
        vol.append_inbox({"type": "input", "payload": "msg1"})
        size_after_first = (tmp_path / "_abox/inbox.jsonl").stat().st_size
        vol.append_inbox({"type": "input", "payload": "msg2"})
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
# No orphan state: comms.py only sends pokes + signals
# ---------------------------------------------------------------------------

class TestNoOrphanState:
    """Backend comms never pushes raw state over WS — only pokes and signals."""

    def test_comms_no_direct_state_pushes(self):
        """Grep comms.py for push_to_relay calls — no raw theme/mode/skill payloads."""
        comms_path = Path(__file__).parent.parent / "services" / "comms.py"
        source = comms_path.read_text()
        # These payload types existed in the old WS-push architecture.
        # They must not appear in the new poke-based architecture.
        assert '"type": "theme"' not in source, "Direct theme push — should be poke"
        assert '"type": "mode"' not in source, "Direct mode push — should be poke"
        assert '"type": "skill"' not in source, "Direct skill push — should be poke"
        assert '"type": "instructions"' not in source, "Direct instructions push — should be poke"

    def test_comms_uses_poke_pattern(self):
        """All volume-state pushes use the poke pattern."""
        comms_path = Path(__file__).parent.parent / "services" / "comms.py"
        source = comms_path.read_text()
        # Poke pattern: write to volume, then push_to_relay with "poke"
        assert '"type": "poke"' in source, "No poke pattern found in comms.py"

    def test_signals_are_ephemeral_only(self):
        """Signal payloads are SIGINT/restart/clear — ephemeral, not state."""
        comms_path = Path(__file__).parent.parent / "services" / "comms.py"
        source = comms_path.read_text()
        # Signals should only be ephemeral control signals
        import re
        signal_payloads = re.findall(r'"signal":\s*"(\w+)"', source)
        allowed_signals = {"SIGINT", "restart", "clear"}
        for sig in signal_payloads:
            assert sig in allowed_signals, (
                f"Unknown signal '{sig}' in comms.py — signals must be ephemeral"
            )


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
    """push_to_relay must ONLY carry pokes and signals — never data payloads.

    The volume architecture routes all state through files. WS messages are
    tiny notifications ("poke" = file changed, "signal" = ephemeral control).
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
            "push_to_relay calls with data payloads found (should use volume write + poke):\n"
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


# ---------------------------------------------------------------------------
# Mutation boundary: state push MUST go through agents/services/comms.py
# ---------------------------------------------------------------------------

class TestMutationBoundary:
    """Mutations that push state to agents must go through comms.py — not DIY.

    Bug: set_project_theme in projects/graphql/mutations.py had its own
    _push_theme_for_project() that sent old {"type": "theme"} WS payloads.
    The relay only handles {"type": "poke"}, so the theme never updated.
    This test ensures no mutation file has inline push_to_relay or
    channel_layer.group_send calls that bypass comms.py.
    """

    # Directories that should NEVER directly import push_to_relay
    # All agent state push must go through agents/services/comms.py
    FORBIDDEN_DIRS = {"graphql", "management"}

    def test_no_push_to_relay_in_mutations_or_views(self):
        """Mutation/view/management files must not import push_to_relay directly."""
        backend_root = Path(__file__).resolve().parent.parent.parent
        violations = []
        for f in sorted(backend_root.rglob("*.py")):
            if "__pycache__" in str(f) or "test" in f.name:
                continue
            # Only check files in forbidden dirs (graphql/, management/, views)
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
            "push_to_relay in mutation/view/management files — use comms.py service functions:\n"
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
            "Inline push functions in mutations — use comms.py instead:\n"
            + "\n".join(f"  {v}" for v in violations)
        )
