"""
Built-in theme registry — token dicts for dashboard themes.

Each theme maps CSS custom property names (without --p- prefix) to hex values.
Used by:
  - Backend: push theme tokens to agents on connect / theme change
  - Dashboard: VALID_THEME_KEYS validation derives from these keys
  - Agents: AwesomeWM + Firefox theming via /tmp/abox-theme.{lua,json}

To add a new theme:
  1. Create dashboard/app/themes/<name>.css with [data-theme][data-mode] selector
  2. Add the token dict here
  3. Add entry to BUILT_IN_THEMES in dashboard/lib/stores/theme.ts
"""

# Claude dark — converted from HSL values in claude-dark.css to hex.
# Conversion note: HSL values with alpha channels are represented as rgba().
_CLAUDE_DARK: dict[str, str] = {
    "surface": "#252220",
    "surface-raised": "#2F2C29",
    "surface-sunken": "#1E1B18",
    "surface-overlay": "#2F2C29",
    "text-default": "#F8F3E8",
    "text-secondary": "#BEB8AA",
    "text-muted": "#938E82",
    "accent": "#C7613A",
    "accent-hover": "#D4784E",
    "danger": "#FF8080",
    "success": "#67C717",
    "warning": "#C79717",
    "info": "#6BA2D9",
    "pro": "#9B7EF4",
}

# Blyss dark — base16-ocean-dark / hyper-blyss palette.
_BLYSS_DARK: dict[str, str] = {
    "surface": "#2B303B",
    "surface-raised": "#343D46",
    "surface-sunken": "#232731",
    "surface-overlay": "#3D4452",
    "text-default": "#C0C5CE",
    "text-secondary": "#DFE1E8",
    "text-muted": "#65737E",
    "accent": "#8FA1B3",
    "accent-hover": "#A3B5C7",
    "danger": "#BF616A",
    "success": "#A3BE8C",
    "warning": "#EBCB8B",
    "info": "#96B5B4",
    "pro": "#B48EAD",
}

BUILTIN_THEMES: dict[str, dict[str, str]] = {
    "claude-dark": _CLAUDE_DARK,
    "blyss-dark": _BLYSS_DARK,
}
