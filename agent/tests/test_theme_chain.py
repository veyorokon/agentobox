"""Full theme delivery chain tests — converter + relay poke + Firefox config.

Tests the ENTIRE chain from tokens.json to browser-visible CSS:
1. converters.py: tokens dict → userChrome.css, awesome.lua, theme.json
2. Relay poke handler: reads tokens.json, calls converter, reloads apps
3. Firefox config: mozilla.cfg and config.css point to correct CSS path
4. Path consistency: every component agrees on /tmp/abox-theme/

If any link breaks, theme changes silently fail — the exact bug we had.
"""

import json
import re
from pathlib import Path

import pytest

# converters.py lives in agent/rootfs/opt/abox/ — not a Python package.
# Import it by manipulating sys.path.
import sys
AGENT_ROOT = Path(__file__).resolve().parent.parent
CONVERTERS_DIR = AGENT_ROOT / "rootfs" / "opt" / "abox"
sys.path.insert(0, str(CONVERTERS_DIR))
from converters import tokens_to_css, tokens_to_lua, convert_theme  # noqa: E402


SAMPLE_TOKENS = {
    "surface": "#1a1a2e",
    "surface-raised": "#252540",
    "text-default": "#e0e0e0",
    "text-muted": "#888888",
    "accent": "#ff6b6b",
    "border-default": "#333355",
    "border-subtle": "#2a2a44",
}


# ---------------------------------------------------------------------------
# 1. Converter: tokens → CSS/lua/json
# ---------------------------------------------------------------------------

class TestTokensToCSS:
    """tokens_to_css must produce valid CSS with the exact token values."""

    def test_css_contains_surface_color(self):
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "#1a1a2e" in css

    def test_css_contains_text_color(self):
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "#e0e0e0" in css

    def test_css_contains_accent(self):
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "#ff6b6b" in css

    def test_css_has_toolbar_bgcolor(self):
        """Toolbar background must use surface token — this is the URL bar bg."""
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "--toolbar-bgcolor: #1a1a2e" in css

    def test_css_has_toolbar_field_bg(self):
        """Toolbar field (URL input) must use surface — prevents striped pattern."""
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "--toolbar-field-background-color: #1a1a2e" in css

    def test_css_has_toolbar_field_focus_bg(self):
        """Focused URL bar must also use surface — otherwise it flashes white."""
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "--toolbar-field-focus-background-color: #1a1a2e" in css

    def test_different_tokens_produce_different_css(self):
        """If I change the theme, the CSS MUST be different."""
        css1 = tokens_to_css(SAMPLE_TOKENS)
        different_tokens = {**SAMPLE_TOKENS, "surface": "#ff0000"}
        css2 = tokens_to_css(different_tokens)
        assert css1 != css2
        assert "#ff0000" in css2
        assert "#1a1a2e" not in css2

    def test_css_uses_important(self):
        """All property declarations must use !important to override Firefox defaults."""
        css = tokens_to_css(SAMPLE_TOKENS)
        for line in css.splitlines():
            stripped = line.strip()
            # Skip non-property lines: comments, closing braces, selectors, empty
            if not stripped or stripped.startswith(("/*", "}", ":")):
                continue
            # Skip selector lines (contain { but no ;)
            if "{" in stripped or stripped.startswith(("#", ".")):
                continue
            # Remaining lines with : are property declarations
            if ":" in stripped:
                assert "!important" in stripped, f"Missing !important: {stripped}"

    def test_css_kills_urlbar_background_image(self):
        """URL bar must have background-image: none — prevents red striped pattern."""
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "#urlbar-background" in css
        assert "background-image: none" in css

    def test_css_kills_toolbar_background_image(self):
        """Toolbar must have background-image: none — prevents Firefox default pattern."""
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "#navigator-toolbox" in css
        assert "#nav-bar" in css

    def test_css_sets_direct_bg_on_urlbar(self):
        """URL bar background-color must be set directly, not just via CSS variables."""
        css = tokens_to_css(SAMPLE_TOKENS)
        # Must have a rule block setting bg-color on #urlbar-background
        assert f"background-color: #1a1a2e" in css.split("#urlbar-background")[1]

    def test_empty_tokens_uses_defaults(self):
        """Empty tokens should still produce valid CSS with defaults."""
        css = tokens_to_css({})
        assert "--toolbar-bgcolor:" in css
        assert "!important" in css


class TestTokensToLua:
    def test_lua_contains_all_tokens(self):
        lua = tokens_to_lua(SAMPLE_TOKENS)
        for key, val in SAMPLE_TOKENS.items():
            assert f'["{key}"] = "{val}"' in lua

    def test_lua_is_valid_table(self):
        lua = tokens_to_lua(SAMPLE_TOKENS)
        assert lua.startswith("return {")
        assert lua.strip().endswith("}")


class TestConvertTheme:
    """convert_theme writes all three derived files."""

    def test_writes_all_files(self, tmp_path):
        tokens_path = tmp_path / "tokens.json"
        tokens_path.write_text(json.dumps(SAMPLE_TOKENS))
        convert_theme(str(tokens_path))

        assert (tmp_path / "userChrome.css").exists()
        assert (tmp_path / "awesome.lua").exists()
        assert (tmp_path / "theme.json").exists()

    def test_css_file_has_correct_content(self, tmp_path):
        tokens_path = tmp_path / "tokens.json"
        tokens_path.write_text(json.dumps(SAMPLE_TOKENS))
        convert_theme(str(tokens_path))

        css = (tmp_path / "userChrome.css").read_text()
        assert "#1a1a2e" in css
        assert "--toolbar-bgcolor" in css

    def test_theme_json_roundtrips(self, tmp_path):
        tokens_path = tmp_path / "tokens.json"
        tokens_path.write_text(json.dumps(SAMPLE_TOKENS))
        convert_theme(str(tokens_path))

        written = json.loads((tmp_path / "theme.json").read_text())
        assert written == SAMPLE_TOKENS

    def test_second_convert_overwrites(self, tmp_path):
        """Changing tokens and re-running converter MUST update the CSS."""
        tokens_path = tmp_path / "tokens.json"

        # First theme
        tokens_path.write_text(json.dumps(SAMPLE_TOKENS))
        convert_theme(str(tokens_path))
        css1 = (tmp_path / "userChrome.css").read_text()

        # Different theme
        new_tokens = {**SAMPLE_TOKENS, "surface": "#ff0000"}
        tokens_path.write_text(json.dumps(new_tokens))
        convert_theme(str(tokens_path))
        css2 = (tmp_path / "userChrome.css").read_text()

        assert css1 != css2, "CSS did not change after token update — converter broken"
        assert "#ff0000" in css2


# ---------------------------------------------------------------------------
# 2. Firefox config path consistency
# ---------------------------------------------------------------------------

class TestFirefoxConfig:
    """mozilla.cfg and config.css must point to /tmp/abox-theme/userChrome.css."""

    MOZILLA_CFG = AGENT_ROOT / "rootfs" / "usr" / "lib" / "firefox-esr" / "mozilla.cfg"
    CONFIG_CSS = AGENT_ROOT / "rootfs" / "home" / "agent" / ".firefox-config" / "config.css"

    def test_mozilla_cfg_loads_correct_css_path(self):
        source = self.MOZILLA_CFG.read_text()
        assert "/tmp/abox-theme/userChrome.css" in source, (
            "mozilla.cfg does not load /tmp/abox-theme/userChrome.css — "
            "Firefox will never see theme changes"
        )

    def test_config_css_imports_correct_path(self):
        source = self.CONFIG_CSS.read_text()
        assert "/tmp/abox-theme/userChrome.css" in source, (
            "config.css does not @import /tmp/abox-theme/userChrome.css — "
            "Firefox will never see theme changes"
        )

    def test_paths_agree(self):
        """Both files must reference the SAME path."""
        cfg_source = self.MOZILLA_CFG.read_text()
        css_source = self.CONFIG_CSS.read_text()

        # Extract paths from both
        cfg_match = re.search(r'file:///[^\s"]+\.css', cfg_source)
        css_match = re.search(r'file:///[^\s"]+\.css', css_source)
        assert cfg_match, "No CSS file:// URI in mozilla.cfg"
        assert css_match, "No CSS file:// URI in config.css"
        assert cfg_match.group() == css_match.group(), (
            f"Path mismatch: mozilla.cfg has {cfg_match.group()}, "
            f"config.css has {css_match.group()}"
        )


# ---------------------------------------------------------------------------
# 3. Relay poke handler path consistency
# ---------------------------------------------------------------------------

class TestRelayPokeConfig:
    """Relay's _on_theme_changed reads from the correct path."""

    RELAY_PY = AGENT_ROOT / "claude" / "rootfs" / "opt" / "abox" / "relay.py"

    def test_relay_reads_tokens_from_volume(self):
        source = self.RELAY_PY.read_text()
        # Relay must read tokens.json from the volume
        assert "tmp/abox-theme/tokens.json" in source, (
            "Relay does not read tmp/abox-theme/tokens.json — "
            "poke handler will not find the theme file"
        )

    def test_relay_calls_converter(self):
        source = self.RELAY_PY.read_text()
        assert "converters.py" in source, (
            "Relay does not call converters.py — "
            "tokens.json will not be converted to CSS"
        )

    def test_relay_reads_generated_css(self):
        source = self.RELAY_PY.read_text()
        assert "userChrome.css" in source, (
            "Relay does not reference userChrome.css — "
            "Firefox CSS reload will not work"
        )

    def test_poke_handler_registered_for_theme(self):
        source = self.RELAY_PY.read_text()
        # The poke handler map must have an entry for tokens.json
        assert "tmp/abox-theme/tokens.json" in source
        assert "_on_theme_changed" in source


# ---------------------------------------------------------------------------
# 4. Init-volume symlink consistency
# ---------------------------------------------------------------------------

class TestInitVolumeSymlinks:
    """init-volume must symlink /tmp/abox-theme so the volume files are visible."""

    INIT_VOLUME = AGENT_ROOT / "rootfs" / "etc" / "s6-overlay" / "scripts" / "init-volume"

    def test_theme_dir_symlinked(self):
        source = self.INIT_VOLUME.read_text()
        assert "abox-theme" in source, (
            "init-volume does not symlink abox-theme — "
            "container cannot see theme files from volume"
        )

    def test_converter_runs_at_boot(self):
        source = self.INIT_VOLUME.read_text()
        assert "converters.py" in source, (
            "init-volume does not run converters.py at boot — "
            "first boot will have no CSS file for Firefox"
        )
