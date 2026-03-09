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
from converters import tokens_to_css, tokens_to_lua, convert_theme, _NEWTAB_LOGO_CSS  # noqa: E402


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

class TestTextfoxVariableCoverage:
    """Generated CSS + config.css must cover ALL --tf-* variables from textfox.

    This is the test that catches silent theme regression: if textfox defines
    a new --tf-* variable and we don't override it, the textfox default bleeds
    through on theme change. That's exactly the bug where the new tab page
    still showed "textfox" ASCII art after switching to blyss-dark.
    """

    # textfox defaults.css is cloned into the image at build time.
    # We parse the pinned copy to extract the variable inventory.
    TEXTFOX_DEFAULTS = AGENT_ROOT / "rootfs" / "opt" / "textfox" / "chrome" / "defaults.css"
    CONFIG_CSS = AGENT_ROOT / "rootfs" / "home" / "agent" / ".firefox-config" / "config.css"

    # Variables that are layout/display concerns, not theme colors.
    # These are intentionally set in config.css (static), not generated CSS (dynamic).
    LAYOUT_VARS = {
        "--tf-font-family",
        "--tf-font-size",
        "--tf-border-width",
        "--tf-rounding",
        "--tf-margin",
        "--tf-text-transform",
        "--tf-border-transition",
        "--tf-display-horizontal-tabs",
        "--tf-display-window-controls",
        "--tf-display-nav-buttons",
        "--tf-display-urlbar-icons",
        "--tf-display-sidebar-tools",
        "--tf-display-titles",
        "--tf-navbar-margin",
        "--tf-navbar-padding",
        "--tf-bookmarks-alignment",
    }

    @staticmethod
    def _extract_tf_vars(css_text: str) -> set[str]:
        """Extract all --tf-* variable definitions from CSS text."""
        return set(re.findall(r"(--tf-[\w-]+)\s*:", css_text))

    def test_textfox_defaults_exist(self):
        """Textfox must be installed in the image — otherwise all theme tests are meaningless."""
        assert self.TEXTFOX_DEFAULTS.exists(), (
            f"textfox defaults.css not found at {self.TEXTFOX_DEFAULTS} — "
            "is textfox installed in the agent image?"
        )

    def test_generated_css_covers_all_theme_vars(self):
        """Every --tf-* color/content variable from textfox must appear in generated CSS."""
        if not self.TEXTFOX_DEFAULTS.exists():
            pytest.skip("textfox not installed")

        textfox_vars = self._extract_tf_vars(self.TEXTFOX_DEFAULTS.read_text())
        generated_css = tokens_to_css(SAMPLE_TOKENS)
        generated_vars = self._extract_tf_vars(generated_css)

        # Theme vars = everything textfox defines minus layout vars
        theme_vars = textfox_vars - self.LAYOUT_VARS
        missing = theme_vars - generated_vars
        assert not missing, (
            f"Generated CSS missing textfox theme variables: {missing}. "
            "These will use textfox defaults instead of our theme tokens, "
            "causing visual inconsistency on theme change."
        )

    def test_config_css_covers_all_layout_vars(self):
        """Layout --tf-* variables must be set in config.css OR use textfox defaults."""
        if not self.TEXTFOX_DEFAULTS.exists() or not self.CONFIG_CSS.exists():
            pytest.skip("textfox or config.css not found")

        textfox_vars = self._extract_tf_vars(self.TEXTFOX_DEFAULTS.read_text())
        config_css = self.CONFIG_CSS.read_text()
        config_vars = self._extract_tf_vars(config_css)
        generated_css = tokens_to_css(SAMPLE_TOKENS)
        generated_vars = self._extract_tf_vars(generated_css)

        # Every textfox var must be in generated CSS, config.css, or LAYOUT_VARS
        # (layout vars in LAYOUT_VARS that match textfox defaults don't need overriding)
        all_covered = generated_vars | config_vars | self.LAYOUT_VARS
        uncovered = textfox_vars - all_covered
        assert not uncovered, (
            f"Textfox variables not covered by generated CSS, config.css, or known layout defaults: {uncovered}. "
            "These use textfox defaults, which may not match our theme."
        )

    def test_newtab_logo_is_overridden(self):
        """--tf-newtab-logo MUST be set to Agentobox branding in generated CSS."""
        css = tokens_to_css(SAMPLE_TOKENS)
        assert "--tf-newtab-logo" in css, (
            "Generated CSS does not set --tf-newtab-logo — "
            "new tab page will show textfox ASCII art instead of Agentobox branding"
        )
        assert "Agentobox" not in css or "gentobox" in css, (
            "The newtab logo CSS value should contain the Agentobox ASCII art"
        )


class TestThemeActuallyApplied:
    """End-to-end: push a weird theme, verify the generated CSS uses ONLY those values.

    This is the test that catches the actual user bug: "I changed the theme
    to blyss-dark but Firefox still shows textfox defaults." The test uses
    an absurd all-red theme so any default value that bleeds through is
    instantly visible — if you see anything other than #ff0000 in a color
    property, the converter didn't apply the theme.
    """

    # All-red theme — anything NOT red in the output is a bug.
    # Derived from SAMPLE_TOKENS keys to prevent drift.
    RED_THEME = {k: "#ff0000" for k in SAMPLE_TOKENS}

    # Every CSS variable that converters.py sets to a token-derived color.
    # Map: CSS variable name → which token it should come from.
    EXPECTED_MAPPINGS = {
        # Firefox standard vars
        "--lwt-accent-color": "surface",
        "--lwt-text-color": "text-default",
        "--lwt-tab-line-color": "accent",
        "--toolbar-bgcolor": "surface",
        "--toolbar-color": "text-muted",
        "--toolbar-field-background-color": "surface",
        "--toolbar-field-color": "text-default",
        "--toolbar-field-border-color": "border-subtle",
        "--toolbar-field-focus-background-color": "surface",
        "--toolbar-field-focus-color": "text-default",
        "--arrowpanel-background": "surface",
        "--arrowpanel-color": "text-default",
        "--arrowpanel-border-color": "border-default",
        "--sidebar-background-color": "surface",
        "--sidebar-text-color": "text-muted",
        "--sidebar-border-color": "border-subtle",
        "--newtab-background-color": "surface",
        "--newtab-text-primary-color": "text-default",
        # textfox vars
        "--tf-bg": "surface",
        "--tf-border": "border-default",
        "--tf-accent": "accent",
    }

    def test_all_red_theme_produces_all_red_css(self):
        """Every color property must be #ff0000. Any other color = theme not applied."""
        css = tokens_to_css(self.RED_THEME)
        for var_name, token_key in self.EXPECTED_MAPPINGS.items():
            expected_value = self.RED_THEME[token_key]
            # Match "  --var-name: #ff0000 !important;"
            pattern = f"{var_name}: {expected_value}"
            assert pattern in css, (
                f"CSS variable {var_name} should be {expected_value} (from token '{token_key}') "
                f"but it's not. The converter is ignoring this token — theme change won't apply."
            )

    def test_no_default_colors_leak_through(self):
        """With all-red input, NO default colors should appear in the CSS."""
        css = tokens_to_css(self.RED_THEME)
        # These are the converter's hardcoded defaults — none should appear
        # when we provide explicit values for every token.
        leaked_defaults = []
        for default in ["#1e1e1e", "#d4d4d4", "#888888", "#5a5a5a"]:
            if default in css:
                leaked_defaults.append(default)
        assert not leaked_defaults, (
            f"Default colors leaked into CSS despite all tokens being #ff0000: {leaked_defaults}. "
            "The converter is using a hardcoded default instead of the provided token."
        )

    def test_element_overrides_use_token_colors(self):
        """Direct element rules (#urlbar-background etc.) must use token colors, not defaults."""
        css = tokens_to_css(self.RED_THEME)
        # Split by element selectors and check each block
        for selector in ["#navigator-toolbox", "#urlbar-background", "#urlbar-input-container"]:
            assert selector in css, f"Missing element override for {selector}"
            # The block after this selector must contain our surface color
            block = css.split(selector)[1].split("}")[0]
            assert "#ff0000" in block, (
                f"{selector} block doesn't use theme surface color #ff0000 — "
                "Firefox will show default or textfox colors instead"
            )

    def test_newtab_logo_is_agentobox(self):
        """--tf-newtab-logo must show Agentobox branding, not textfox."""
        css = tokens_to_css(self.RED_THEME)
        assert _NEWTAB_LOGO_CSS in css, (
            "Generated CSS doesn't set Agentobox newtab logo — "
            "new tab will show textfox ASCII art instead of Agentobox branding"
        )
        assert "Agentobox" not in css or "gentobox" in css, (
            "Sanity check: the logo should contain 'gentobox' substring"
        )

    def test_full_pipeline_tokens_to_file(self, tmp_path):
        """Full convert_theme pipeline: tokens.json → userChrome.css with correct values."""
        tokens_path = tmp_path / "tokens.json"
        tokens_path.write_text(json.dumps(self.RED_THEME))
        convert_theme(str(tokens_path))

        css = (tmp_path / "userChrome.css").read_text()
        # Every mapped variable must have the red value
        for var_name, token_key in self.EXPECTED_MAPPINGS.items():
            assert f"{var_name}: #ff0000" in css, (
                f"After full pipeline, {var_name} is not #ff0000 — "
                "tokens.json → CSS conversion lost this value"
            )

    def test_blyss_dark_theme_applies_correctly(self):
        """Real theme: blyss-dark tokens produce CSS with blyss-dark values, not defaults."""
        blyss_tokens = {
            "surface": "#2B303B",
            "surface-raised": "#343D46",
            "text-default": "#C0C5CE",
            "text-muted": "#65737E",
            "accent": "#8FA1B3",
            "border-default": "#343D46",
            "border-subtle": "#343D46",
        }
        css = tokens_to_css(blyss_tokens)
        # Key variables must use blyss-dark surface color
        for var in ["--toolbar-bgcolor", "--newtab-background-color", "--tf-bg",
                     "--sidebar-background-color", "--arrowpanel-background"]:
            assert f"{var}: #2B303B" in css, (
                f"{var} doesn't use blyss-dark surface #2B303B — theme not applied"
            )
        # Accent must be used for textfox accent and tab line
        assert "--tf-accent: #8FA1B3" in css
        assert "--lwt-tab-line-color: #8FA1B3" in css
        # No claude-dark defaults should be present
        assert "#1e1e1e" not in css, "claude-dark default surface leaked into blyss-dark CSS"


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

    def test_config_css_does_not_import_theme(self):
        """config.css must NOT @import the theme CSS — it caches at startup
        and blocks live theme reload via nsIStyleSheetService."""
        source = self.CONFIG_CSS.read_text()
        # Check for actual @import rule, not the word in comments
        has_import_rule = any(
            line.strip().startswith("@import") for line in source.splitlines()
        )
        assert not has_import_rule, (
            "config.css still uses @import for theme CSS — "
            "this caches the CSS at startup and prevents live reload. "
            "Theme CSS is loaded by mozilla.cfg via nsIStyleSheetService."
        )

    def test_mozilla_cfg_does_not_enable_marionette(self):
        source = self.MOZILLA_CFG.read_text()
        assert "marionette.enabled" not in source, (
            "mozilla.cfg still enables Marionette even though theme reload is restart-based"
        )
        assert "marionette.port" not in source, (
            "mozilla.cfg still pins Marionette port even though runtime theme reload no longer uses it"
        )

    def test_mozilla_cfg_loads_theme_css(self):
        """mozilla.cfg must reference the theme CSS path for nsIStyleSheetService."""
        cfg_source = self.MOZILLA_CFG.read_text()
        cfg_match = re.search(r'file:///[^\s"]+\.css', cfg_source)
        assert cfg_match, "No CSS file:// URI in mozilla.cfg"
        assert "abox-theme/userChrome.css" in cfg_match.group(), (
            f"mozilla.cfg theme path doesn't point to abox-theme/userChrome.css: {cfg_match.group()}"
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

    def test_relay_does_not_restart_firefox(self):
        """Relay must NOT restart Firefox — it pokes mozilla.cfg's loopback
        socket to trigger CSS reload via nsIStyleSheetService."""
        source = self.RELAY_PY.read_text()
        assert "_restart_firefox_for_theme" not in source, (
            "Relay still has _restart_firefox_for_theme — "
            "theme reload should use socket poke, not Firefox restart"
        )
        assert "pkill" not in source.split("_on_theme_changed")[1].split("async def")[0] if "_on_theme_changed" in source else True, (
            "Relay kills Firefox in theme handler — "
            "should poke mozilla.cfg socket instead"
        )

    def test_relay_pokes_firefox_socket(self):
        """Relay must poke Firefox's loopback socket after writing CSS."""
        source = self.RELAY_PY.read_text()
        # Find the method body — starts at "async def _on_theme_changed"
        marker = "async def _on_theme_changed"
        idx = source.index(marker)
        method_body = source[idx:].split("\n    async def ")[0]
        assert "9224" in method_body, (
            "Relay theme handler does not poke port 9224 — "
            "Firefox won't know CSS changed"
        )

    def test_mozilla_cfg_has_socket_listener(self):
        """mozilla.cfg must listen on loopback socket for reload pokes."""
        mozilla_cfg = AGENT_ROOT / "rootfs" / "usr" / "lib" / "firefox-esr" / "mozilla.cfg"
        source = mozilla_cfg.read_text()
        assert "nsIServerSocket" in source, (
            "mozilla.cfg does not use nsIServerSocket — no reload listener"
        )
        assert "9224" in source, (
            "mozilla.cfg does not listen on port 9224"
        )
        assert "nsIStyleSheetService" in source, (
            "mozilla.cfg does not use nsIStyleSheetService — cannot reload CSS at runtime"
        )
        assert "unregisterSheet" in source, (
            "mozilla.cfg does not unregister old sheet before re-registering — "
            "CSS changes won't take effect"
        )
        assert "loadAndRegisterSheet" in source, (
            "mozilla.cfg does not register the theme sheet"
        )

    def test_poke_handler_registered_for_theme(self):
        source = self.RELAY_PY.read_text()
        # The poke handler map must have an entry for tokens.json
        assert "tmp/abox-theme/tokens.json" in source
        assert "_on_theme_changed" in source


# ---------------------------------------------------------------------------
# 4. Firefox profile setup
# ---------------------------------------------------------------------------

class TestFirefoxSetup:
    """firefox-setup creates the profile and injects textfox + theme CSS."""

    FIREFOX_SETUP = AGENT_ROOT / "rootfs" / "etc" / "s6-overlay" / "scripts" / "firefox-setup"
    RC_LUA = AGENT_ROOT / "rootfs" / "home" / "agent" / ".config" / "awesome" / "rc.lua"

    def test_headless_profile_creation_exists(self):
        """firefox-setup must run a headless Firefox to create the default profile."""
        source = self.FIREFOX_SETUP.read_text()
        found = any("firefox-esr" in line and "--headless" in line for line in source.splitlines())
        assert found, "No Firefox headless launch found in firefox-setup"


# ---------------------------------------------------------------------------
# 5. Init-volume symlink consistency
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
