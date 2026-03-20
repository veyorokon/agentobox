import builtInThemeManifest from "../generated/themes/builtins.json"

export type ThemeTokens = Record<string, string>

export type ThemeConfig = {
  theme: string
  mode: string
  tokens?: ThemeTokens | null
}

export type BuiltInTheme = {
  id: string
  label: string
  mode: string
  tokens: ThemeTokens
}

type ThemeManifest = {
  schema_version: string
  default: { theme: string; mode: string }
  themes: BuiltInTheme[]
}

const MANIFEST = builtInThemeManifest as ThemeManifest
const BUILT_IN_THEME_MAP = new Map(MANIFEST.themes.map((theme) => [themeKey(theme.id, theme.mode), theme]))

export const BUILT_IN_THEMES: BuiltInTheme[] = MANIFEST.themes
export const DEFAULT_THEME = getBuiltInTheme(MANIFEST.default.theme, MANIFEST.default.mode) ?? BUILT_IN_THEMES[0]

export function themeKey(theme: string, mode: string): string {
  return `${theme}-${mode}`
}

export function getBuiltInTheme(theme: string, mode: string): BuiltInTheme | null {
  return BUILT_IN_THEME_MAP.get(themeKey(theme, mode)) ?? null
}

export function resolveThemeConfig(config: Partial<ThemeConfig> | null | undefined): ThemeConfig {
  const theme = typeof config?.theme === "string" && config.theme.trim() ? config.theme : DEFAULT_THEME.id
  const mode = typeof config?.mode === "string" && config.mode.trim() ? config.mode : DEFAULT_THEME.mode
  const resolvedBuiltIn = getBuiltInTheme(theme, mode)
  const baseTokens = resolvedBuiltIn?.tokens ?? DEFAULT_THEME.tokens
  const tokens = isTokenMap(config?.tokens) ? { ...baseTokens, ...config.tokens } : baseTokens
  return { theme, mode, tokens }
}

export function findBuiltInThemeByTokens(tokens: Record<string, string> | null | undefined): BuiltInTheme | null {
  if (!tokens) return null
  return BUILT_IN_THEMES.find((theme) =>
    Object.entries(theme.tokens).every(([key, value]) => normalizeTokenValue(tokens[key] ?? "") === normalizeTokenValue(value)),
  ) ?? null
}

export function applyThemeConfigToDocument(config: Partial<ThemeConfig> | null | undefined, doc: Document = document) {
  const resolved = resolveThemeConfig(config)
  const root = doc.documentElement
  root.setAttribute("data-theme", resolved.theme)
  root.setAttribute("data-mode", resolved.mode)
  applyThemeTokensToElement(root, resolved.tokens ?? {})
}

export function buildThemeStyleObject(tokens: ThemeTokens): Record<string, string> {
  const style: Record<string, string> = {}
  for (const [token, value] of Object.entries(tokens)) {
    style[cssVariableName(token)] = value
  }
  return style
}

export function buildThemeInitScript(): string {
  const builtInThemes = JSON.stringify(BUILT_IN_THEMES)
  const fallback = JSON.stringify(DEFAULT_THEME)
  return `
try {
  var builtInThemes = ${builtInThemes};
  var fallback = ${fallback};
  function themeKey(theme, mode) { return String(theme) + "-" + String(mode); }
  function normalizeTokenValue(value) { return String(value || "").trim().toLowerCase().replace(/\\s+/g, " "); }
  function cssVariableName(token) {
    if (token.indexOf("radius-") === 0 || token.indexOf("shadow-") === 0 || token.indexOf("font-") === 0 || token.indexOf("ease-") === 0) {
      return "--" + token;
    }
    return "--p-" + token;
  }
  var builtInThemeMap = {};
  for (var i = 0; i < builtInThemes.length; i += 1) {
    var theme = builtInThemes[i];
    builtInThemeMap[themeKey(theme.id, theme.mode)] = theme;
  }
  function isTokenMap(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function resolveConfig(config) {
    var theme = config && typeof config.theme === "string" && config.theme.trim() ? config.theme : fallback.id;
    var mode = config && typeof config.mode === "string" && config.mode.trim() ? config.mode : fallback.mode;
    var builtIn = builtInThemeMap[themeKey(theme, mode)] || null;
    var baseTokens = (builtIn && builtIn.tokens) || fallback.tokens;
    var tokens = isTokenMap(config && config.tokens) ? Object.assign({}, baseTokens, config.tokens) : baseTokens;
    return { theme: theme, mode: mode, tokens: tokens };
  }
  var raw = localStorage.getItem("abox-theme");
  var persisted = raw ? JSON.parse(raw) : null;
  var resolved = resolveConfig(persisted);
  document.documentElement.setAttribute("data-theme", resolved.theme);
  document.documentElement.setAttribute("data-mode", resolved.mode);
  var tokens = resolved.tokens || {};
  for (var token in tokens) {
    if (Object.prototype.hasOwnProperty.call(tokens, token)) {
      document.documentElement.style.setProperty(cssVariableName(token), tokens[token]);
    }
  }
} catch (e) {}
`
}

function applyThemeTokensToElement(element: HTMLElement, tokens: ThemeTokens) {
  for (const [token, value] of Object.entries(tokens)) {
    element.style.setProperty(cssVariableName(token), value)
  }
}

function normalizeTokenValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function cssVariableName(token: string): string {
  if (token.startsWith("radius-") || token.startsWith("shadow-") || token.startsWith("font-") || token.startsWith("ease-")) {
    return `--${token}`
  }
  return `--p-${token}`
}

function isTokenMap(value: unknown): value is ThemeTokens {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
