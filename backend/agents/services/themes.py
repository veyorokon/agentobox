"""
Built-in theme registry — token dicts for dashboard themes.

Each theme maps CSS custom property names (without --p- prefix) to hex values.
Used by:
  - Backend: push theme tokens to agents on connect / theme change
  - Dashboard: VALID_THEME_KEYS validation derives from these keys
  - Agents: AwesomeWM + Firefox theming via /tmp/abox-theme/ (volume-backed)

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

_ROSE_PINE_DARK: dict[str, str] = {
    "surface": "#191724",
    "surface-raised": "#1f1d2e",
    "surface-sunken": "#13111e",
    "surface-overlay": "#26233a",
    "text-default": "#e0def4",
    "text-secondary": "#c4b9d4",
    "text-muted": "#6e6a86",
    "accent": "#eb6f92",
    "accent-hover": "#f0869f",
    "danger": "#eb6f92",
    "success": "#9ccfd8",
    "warning": "#f6c177",
    "info": "#c4a7e7",
    "pro": "#c4a7e7",
}

_EMBER_DARK: dict[str, str] = {
    "surface": "#282828",
    "surface-raised": "#32302f",
    "surface-sunken": "#1d2021",
    "surface-overlay": "#3c3836",
    "text-default": "#ebdbb2",
    "text-secondary": "#d5c4a1",
    "text-muted": "#7c6f64",
    "accent": "#e78a4e",
    "accent-hover": "#f0a06a",
    "danger": "#ea6962",
    "success": "#a9b665",
    "warning": "#d8a657",
    "info": "#7daea3",
    "pro": "#d3869b",
}

_NORD_DARK: dict[str, str] = {
    "surface": "#2e3440",
    "surface-raised": "#3b4252",
    "surface-sunken": "#272c36",
    "surface-overlay": "#434c5e",
    "text-default": "#d8dee9",
    "text-secondary": "#a5b1c2",
    "text-muted": "#616e88",
    "accent": "#88c0d0",
    "accent-hover": "#a3d4e0",
    "danger": "#bf616a",
    "success": "#a3be8c",
    "warning": "#ebcb8b",
    "info": "#81a1c1",
    "pro": "#b48ead",
}

BUILTIN_THEMES: dict[str, dict[str, str]] = {
    "claude-dark": _CLAUDE_DARK,
    "blyss-dark": _BLYSS_DARK,
    "rose-pine-dark": _ROSE_PINE_DARK,
    "ember-dark": _EMBER_DARK,
    "nord-dark": _NORD_DARK,
}
