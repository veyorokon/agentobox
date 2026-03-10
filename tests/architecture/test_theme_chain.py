"""Theme application chain invariants.

The theme system is a linear chain:
  tokens.json → converters.py → CSS/Lua files → relay.py poke → AwesomeWM/Firefox

These tests enforce structural guarantees:
  1. Chain linearity — each step has exactly one writer
  2. No silent subprocess failures on critical apply paths
  3. Poke handlers are guarded with try/except
  4. Typed failure logging exists at each failure boundary

Cross-boundary: reads both backend and agent source files via AST/regex.
No Django dependency — pure file reads.
"""

import ast
import re

import pytest

from ._paths import AGENT_DIR, AGENT_PY_ROOTS, RELAY_PATH


# ---------------------------------------------------------------------------
# 1. Chain linearity — each step has exactly one writer
# ---------------------------------------------------------------------------

class TestThemeChainLinearity:
    """The theme chain must be linear: one writer per step."""

    def test_only_backend_writes_tokens_json(self):
        """Only lifecycle.py (provisioning) and comms.py (runtime via mutate)
        should write tokens.json. No agent-side code writes it."""
        for root in AGENT_PY_ROOTS:
            if not root.exists():
                continue
            for f in root.glob("*.py"):
                if f.name == "converters.py":
                    continue
                source = f.read_text()
                assert "tokens.json" not in source or "read_text" in source or "json.loads" in source, (
                    f"{f.name} references tokens.json in a write context. "
                    f"Only the backend should write tokens.json."
                )

    def test_only_relay_invokes_converters(self):
        """No agent-side file other than relay.py should invoke converters.py."""
        callers = []
        for root in AGENT_PY_ROOTS:
            if not root.exists():
                continue
            for f in root.glob("*.py"):
                if f.name in ("converters.py", "relay.py"):
                    continue
                source = f.read_text()
                if "converters.py" in source:
                    callers.append(f.name)
        assert not callers, (
            f"converters.py invoked by unexpected files: {callers}. "
            f"Only relay.py should call converters.py."
        )

    def test_only_converters_writes_userchrome(self):
        """Only converters.py should write userChrome.css."""
        writers = []
        for root in AGENT_PY_ROOTS:
            if not root.exists():
                continue
            for f in root.glob("*.py"):
                if f.name == "converters.py":
                    continue
                source = f.read_text()
                if re.search(r'userChrome\.css.*write|write.*userChrome\.css', source):
                    writers.append(f.name)
        assert not writers, (
            f"userChrome.css written by unexpected files: {writers}. "
            f"Only converters.py should write userChrome.css."
        )


# ---------------------------------------------------------------------------
# 2. No silent subprocess calls on critical apply paths
# ---------------------------------------------------------------------------

class TestNoSilentSubprocess:
    """Critical subprocess.run() calls in the theme apply path must check results."""

    # subprocess.run() calls that are intentionally best-effort (cosmetic).
    # These are wrapped in their own try/except and logged on failure.
    BEST_EFFORT_ALLOWLIST = {"awesome-client"}

    def test_theme_converter_checks_subprocess_result(self):
        """The converters.py subprocess call must assign its result."""
        source = RELAY_PATH.read_text()
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if node.name != "_on_theme_changed":
                continue

            unassigned = []
            for child in ast.walk(node):
                if isinstance(child, ast.Expr) and isinstance(child.value, ast.Call):
                    call = child.value
                    if isinstance(call.func, ast.Attribute) and call.func.attr == "run":
                        if isinstance(call.func.value, ast.Name) and call.func.value.id in ("_sp", "subprocess"):
                            # Check if this is a best-effort call (allowlisted command)
                            if call.args and isinstance(call.args[0], ast.List):
                                elts = call.args[0].elts
                                if elts and isinstance(elts[0], ast.Constant):
                                    cmd = elts[0].value
                                    if cmd in self.BEST_EFFORT_ALLOWLIST:
                                        continue
                            unassigned.append(child.lineno)

            assert not unassigned, (
                f"subprocess.run() at lines {unassigned} in _on_theme_changed "
                f"discards its result. Assign and check .returncode."
            )
            return

        pytest.fail("_on_theme_changed not found in relay.py")


# ---------------------------------------------------------------------------
# 3. Poke handlers are guarded with try/except
# ---------------------------------------------------------------------------

class TestPokeHandlerGuard:
    """_handle_command must wrap poke handler calls in try/except."""

    def test_poke_handler_has_exception_boundary(self):
        """The 'await handler()' call in the poke branch must be inside try/except."""
        source = RELAY_PATH.read_text()
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if node.name != "_handle_command":
                continue

            for child in ast.walk(node):
                if isinstance(child, ast.Await):
                    inner = child.value
                    if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name):
                        if inner.func.id == "handler":
                            assert self._is_inside_try(node, child), (
                                f"'await handler()' at line {child.lineno} in "
                                f"_handle_command is not inside try/except. "
                                f"Poke handler failures must be contained."
                            )
                            return

            pytest.fail("Could not find 'await handler()' in _handle_command")

    @staticmethod
    def _is_inside_try(func_node: ast.AST, target: ast.AST) -> bool:
        """Check if target AST node is inside a Try block within func_node."""
        for node in ast.walk(func_node):
            if isinstance(node, ast.Try):
                for try_child in ast.walk(node):
                    if try_child is target:
                        return True
        return False


# ---------------------------------------------------------------------------
# 4. Typed failure logging at each boundary
# ---------------------------------------------------------------------------

class TestTypedFailureLogging:
    """Each failure boundary in the theme chain must have a dedicated log event."""

    REQUIRED_LOG_EVENTS = {
        "relay.theme_tokens_unreadable":
            "malformed or missing tokens.json must log a typed event",
        "relay.theme_converter_failed":
            "converter failure must log a typed event with returncode/stderr",
        "relay.theme_firefox_poke_exhausted":
            "socket poke exhaustion must log a typed event",
    }

    def test_failure_events_exist_in_relay(self):
        """relay.py must contain dedicated log events for each failure boundary."""
        source = RELAY_PATH.read_text()
        missing = []
        for event, reason in self.REQUIRED_LOG_EVENTS.items():
            if event not in source:
                missing.append(f"{event}: {reason}")
        assert not missing, (
            "Missing typed failure log events in relay.py:\n"
            + "\n".join(f"  {m}" for m in missing)
        )
