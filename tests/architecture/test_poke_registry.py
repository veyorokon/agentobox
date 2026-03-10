"""Poke registry enforcement tests.

The POKE_REGISTRY in volume.py is the single contract between backend and
relay for mutable runtime state. These tests enforce three invariants:

  1. Every registered file has a matching handler in relay._poke_handlers
  2. Runtime state mutations in services use Volume.mutate(), not raw write()
  3. Every mutate() call is paired with push_to_relay() (no silent writes)

Cross-boundary: reads both backend (volume.py, services/) and agent (relay.py).
No Django dependency — pure file reads + regex/AST.
"""

import ast
import re

from ._paths import RELAY_PATH, SERVICES_DIR

VOLUME_PY = SERVICES_DIR / "volume.py"
COMMS_PY = SERVICES_DIR / "comms.py"


def _parse_poke_registry() -> dict[str, set[str]]:
    """Extract POKE_REGISTRY from volume.py via AST (no Django import needed)."""
    source = VOLUME_PY.read_text()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        # Type-annotated: POKE_REGISTRY: dict[str, set[str]] = {...}
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "POKE_REGISTRY" and node.value:
                return ast.literal_eval(node.value)
        # Plain assignment fallback
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "POKE_REGISTRY":
                    return ast.literal_eval(node.value)
    raise RuntimeError("POKE_REGISTRY not found in volume.py")


POKE_REGISTRY = _parse_poke_registry()


# ---------------------------------------------------------------------------
# 1. Relay handler parity — every registered path has a handler
# ---------------------------------------------------------------------------

class TestRelayHandlerParity:
    """relay._poke_handlers must cover every POKE_REGISTRY key."""

    def test_relay_handlers_match_registry(self):
        """Extract poke handler keys from relay.py, compare to registry."""
        source = RELAY_PATH.read_text()
        # Pattern: "path/to/file.json": self._on_something
        handler_paths = set(re.findall(r'"([^"]+)":\s*self\._on_\w+', source))
        registry_paths = set(POKE_REGISTRY.keys())

        missing_handlers = registry_paths - handler_paths
        assert not missing_handlers, (
            f"POKE_REGISTRY paths without relay handlers: {missing_handlers}. "
            f"Add a handler in relay._poke_handlers for each."
        )

    def test_no_orphan_handlers(self):
        """Relay handlers without a registry entry are dead code."""
        source = RELAY_PATH.read_text()
        handler_paths = set(re.findall(r'"([^"]+)":\s*self\._on_\w+', source))
        registry_paths = set(POKE_REGISTRY.keys())

        orphan_handlers = handler_paths - registry_paths
        assert not orphan_handlers, (
            f"Relay poke handlers without POKE_REGISTRY entry: {orphan_handlers}. "
            f"Add the path to POKE_REGISTRY or remove the handler."
        )


# ---------------------------------------------------------------------------
# 2. Runtime writes use mutate(), not raw write() for registered paths
# ---------------------------------------------------------------------------

class TestMutateEnforcement:
    """Services that write poke-registered paths at runtime must use mutate()."""

    # Files where raw write() to registered paths is allowed (provisioning).
    # These run at deploy time before the relay starts — no poke needed.
    PROVISION_ALLOWLIST = {"provision.py", "lifecycle.py"}

    def test_no_raw_writes_to_registered_paths_in_runtime_services(self):
        """Grep service files for vol.write("registered_path") outside provisioning."""
        violations = []
        for f in sorted(SERVICES_DIR.glob("*.py")):
            if f.name in self.PROVISION_ALLOWLIST:
                continue
            if f.name.startswith("test_"):
                continue
            source = f.read_text()
            if "volume" not in source and "vol" not in source:
                continue
            for path in POKE_REGISTRY:
                # Look for .write("path" or .write_state( patterns (not .mutate)
                if re.search(rf'\.write\(\s*["\']({re.escape(path)})', source):
                    violations.append(f"{f.name}: raw write() to '{path}' — use mutate()")
                if ".write_state(" in source:
                    violations.append(f"{f.name}: write_state() — use mutate_state()")

        assert not violations, (
            "Raw volume writes to poke-registered paths in runtime services "
            "(should use mutate() or mutate_state()):\n"
            + "\n".join(f"  {v}" for v in violations)
        )


# ---------------------------------------------------------------------------
# 3. Every mutate() is paired with push_to_relay()
# ---------------------------------------------------------------------------

class TestMutatePushPairing:
    """Every mutate() call in comms.py must be followed by push_to_relay."""

    def test_mutate_paired_with_push(self):
        """Every .mutate( call in comms.py must have a push_to_relay nearby."""
        source = COMMS_PY.read_text()
        lines = source.split('\n')

        mutate_lines = []
        push_lines = []
        for i, line in enumerate(lines):
            if '.mutate(' in line or '.mutate_state(' in line:
                mutate_lines.append(i)
            if 'push_to_relay' in line:
                push_lines.append(i)

        # Each mutate should have a push_to_relay within 5 lines after it
        unpushed = []
        for ml in mutate_lines:
            has_push = any(pl > ml and pl <= ml + 5 for pl in push_lines)
            if not has_push:
                unpushed.append(ml + 1)  # 1-indexed

        assert not unpushed, (
            f"mutate() at lines {unpushed} in comms.py has no push_to_relay nearby. "
            f"Every mutate() must be followed by push_to_relay() to notify the relay."
        )
