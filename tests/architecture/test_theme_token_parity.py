"""Cross-boundary theme token parity tests.

Ensures that token names stay consistent across all five sources of truth:
  1. Backend VALID_THEME_KEYS (validation layer)
  2. Backend builtin theme dicts (_CLAUDE_DARK, _BLYSS_DARK)
  3. Relay.py tokens.get() calls (agent-side consumer)
  4. Frontend CSS primitives (--p-* in theme files)
  5. Frontend semantic tokens (globals.css --p-* references)

No Django dependency — pure file reads + regex/AST.
"""

import ast
import re
from pathlib import Path

import pytest

from ._paths import AGENT_DIR, BACKEND_DIR, RELAY_PATH, REPO_ROOT

pytestmark = [pytest.mark.unit, pytest.mark.invariant]

DASHBOARD_DIR = REPO_ROOT / "dashboard"

# Source files
MUTATIONS_PY = BACKEND_DIR / "projects" / "graphql" / "mutations.py"
THEMES_PY = BACKEND_DIR / "agents" / "services" / "themes.py"
GLOBALS_CSS = DASHBOARD_DIR / "app" / "globals.css"
THEME_CSS_DIR = DASHBOARD_DIR / "app" / "themes"


def _read_source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# ── Extraction helpers ──


def _extract_valid_theme_keys() -> frozenset[str]:
    """Parse VALID_THEME_KEYS from mutations.py via AST.

    Finds the module-level assignment `VALID_THEME_KEYS = frozenset({...})`
    and extracts all string literals from the set.
    """
    source = _read_source(MUTATIONS_PY)
    tree = ast.parse(source, filename=str(MUTATIONS_PY))
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "VALID_THEME_KEYS"
        ):
            # frozenset({...}) — the Call wraps a Set
            call = node.value
            assert isinstance(call, ast.Call), (
                f"Expected frozenset() call, got {type(call).__name__}"
            )
            assert len(call.args) == 1
            set_node = call.args[0]
            assert isinstance(set_node, ast.Set), (
                f"Expected set literal inside frozenset(), got {type(set_node).__name__}"
            )
            keys = set()
            for elt in set_node.elts:
                assert isinstance(elt, ast.Constant) and isinstance(elt.value, str), (
                    f"Expected string constant, got {ast.dump(elt)}"
                )
                keys.add(elt.value)
            return frozenset(keys)
    raise RuntimeError("VALID_THEME_KEYS not found in mutations.py")


def _extract_builtin_theme_keys() -> dict[str, set[str]]:
    """Parse builtin theme dicts from themes.py via AST.

    Returns {theme_name: {token_keys}} for each _*_DARK dict.
    Handles both plain assignments (ast.Assign) and annotated assignments
    (ast.AnnAssign, e.g., `_CLAUDE_DARK: dict[str, str] = {...}`).
    """
    source = _read_source(THEMES_PY)
    tree = ast.parse(source, filename=str(THEMES_PY))
    themes: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        # Extract (name, value) from both Assign and AnnAssign nodes
        name: str | None = None
        value = None
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            name = node.targets[0].id
            value = node.value
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.value is not None
        ):
            name = node.target.id
            value = node.value

        if name is None or not name.startswith("_") or not name.endswith("_DARK"):
            continue

        assert isinstance(value, ast.Dict), (
            f"Expected dict literal for {name}, got {type(value).__name__}"
        )
        keys = set()
        for key_node in value.keys:
            assert isinstance(key_node, ast.Constant) and isinstance(key_node.value, str), (
                f"Non-string key in {name}: {ast.dump(key_node)}"
            )
            keys.add(key_node.value)
        themes[name] = keys
    if not themes:
        raise RuntimeError("No builtin theme dicts found in themes.py")
    return themes


def _extract_relay_token_refs() -> set[str]:
    """Extract token names from tokens.get("...") calls in relay.py."""
    source = _read_source(RELAY_PATH)
    return set(re.findall(r'tokens\.get\("([^"]+)"', source))


def _extract_css_primitives(css_path: Path) -> set[str]:
    """Extract token names from --p-{token}: declarations in a CSS file."""
    source = _read_source(css_path)
    return set(re.findall(r"--p-([\w-]+)\s*:", source))


def _extract_globals_primitive_refs() -> set[str]:
    """Extract token names from var(--p-{token}) references in globals.css.

    The semantic layer in globals.css uses different names than the primitives
    (e.g., --color-default references --p-text-default). So we extract the
    --p-{token} being referenced, not the --color-{name} being defined.
    """
    source = _read_source(GLOBALS_CSS)
    return set(re.findall(r"var\(--p-([\w-]+)\)", source))


def _list_theme_css_files() -> list[Path]:
    """Return all .css files in the themes directory."""
    if not THEME_CSS_DIR.is_dir():
        pytest.skip(f"Theme CSS directory not found: {THEME_CSS_DIR}")
    files = sorted(THEME_CSS_DIR.glob("*.css"))
    if not files:
        pytest.skip(f"No CSS files found in {THEME_CSS_DIR}")
    return files


# ── Tests ──


class TestThemeTokenParity:
    """Enforce token name consistency across backend, relay, and frontend."""

    def test_builtin_themes_subset_of_valid_keys(self):
        """Every key in builtin theme dicts must exist in VALID_THEME_KEYS.

        Builtin themes are partial overlays — they don't need every key,
        but every key they DO have must be recognized by the validation layer.
        """
        valid = _extract_valid_theme_keys()
        themes = _extract_builtin_theme_keys()
        assert len(themes) >= 2, "Expected at least _CLAUDE_DARK and _BLYSS_DARK"

        for name, keys in themes.items():
            invalid = keys - valid
            assert not invalid, (
                f"Builtin theme {name} has keys not in VALID_THEME_KEYS: {sorted(invalid)}"
            )

    def test_relay_tokens_subset_of_valid_keys(self):
        """Every token consumed by relay.py must be in VALID_THEME_KEYS.

        relay.py uses tokens.get("name", fallback) to read theme values.
        If it references a token that VALID_THEME_KEYS doesn't allow,
        the backend will reject user themes containing that token, but
        the relay still expects it — a silent mismatch.
        """
        valid = _extract_valid_theme_keys()
        relay_tokens = _extract_relay_token_refs()
        assert relay_tokens, "No tokens.get() calls found in relay.py"

        invalid = relay_tokens - valid
        assert not invalid, (
            f"relay.py consumes tokens not in VALID_THEME_KEYS: {sorted(invalid)}"
        )

    def test_frontend_primitives_subset_of_valid_keys(self):
        """Every --p-{token} in theme CSS files must have {token} in VALID_THEME_KEYS.

        Frontend theme files define primitives like --p-surface, --p-accent.
        If a theme file defines a primitive not in VALID_THEME_KEYS, users
        cant set it via the API and it becomes a hardcoded-only value.
        """
        valid = _extract_valid_theme_keys()

        for css_file in _list_theme_css_files():
            primitives = _extract_css_primitives(css_file)
            assert primitives, f"No --p-* declarations found in {css_file.name}"

            invalid = primitives - valid
            assert not invalid, (
                f"{css_file.name} defines primitives not in VALID_THEME_KEYS: "
                f"{sorted(invalid)}"
            )

    def test_valid_keys_have_frontend_primitives(self):
        """Every VALID_THEME_KEY should be defined in at least one theme CSS file.

        Catches orphan backend keys that no frontend theme populates —
        the backend would accept them but they would have no visual effect.
        """
        valid = _extract_valid_theme_keys()

        all_primitives: set[str] = set()
        for css_file in _list_theme_css_files():
            all_primitives |= _extract_css_primitives(css_file)

        missing = valid - all_primitives
        assert not missing, (
            f"VALID_THEME_KEYS with no --p-* definition in any theme CSS file: "
            f"{sorted(missing)}"
        )

    def test_frontend_semantics_cover_valid_keys(self):
        """Every VALID_THEME_KEY should be referenced via var(--p-{token}) in globals.css.

        globals.css is the semantic bridge — it maps primitives (--p-*)
        to semantic tokens (--color-*) that components consume. If a
        primitive has no semantic reference, components cant use it via
        the Tailwind theme system.

        Note: the semantic name may differ from the primitive name
        (e.g., --color-default references --p-text-default). This test
        checks that --p-{token} appears in a var() reference, not that
        --color-{token} exists as a declaration.
        """
        valid = _extract_valid_theme_keys()
        referenced = _extract_globals_primitive_refs()

        missing = valid - referenced
        assert not missing, (
            f"VALID_THEME_KEYS with no var(--p-{{token}}) reference in globals.css: "
            f"{sorted(missing)}. These tokens can be set via the API but have no "
            f"semantic CSS variable for components to use."
        )

    def test_theme_css_files_have_same_primitives(self):
        """All theme CSS files should define the same set of --p-* primitives.

        If one theme defines a primitive and another doesnt, switching themes
        leaves the missing token at whatever value was set by the previous theme
        (or the browser default). This causes visual inconsistencies.
        """
        theme_files = _list_theme_css_files()
        if len(theme_files) < 2:
            pytest.skip("Need at least 2 theme files to compare")

        file_primitives = {f.name: _extract_css_primitives(f) for f in theme_files}
        all_primitives = set().union(*file_primitives.values())

        mismatches: list[str] = []
        for name, primitives in file_primitives.items():
            missing = all_primitives - primitives
            if missing:
                mismatches.append(f"{name} is missing: {sorted(missing)}")

        assert not mismatches, (
            "Theme CSS files define different sets of --p-* primitives:\n"
            + "\n".join(f"  - {m}" for m in mismatches)
        )
