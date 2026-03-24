import { DEFAULT_THEME, type ThemeTokens } from "@/lib/theme-registry"

type TerminalTheme = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  brightBlack: string
  red: string
  brightRed: string
  green: string
  brightGreen: string
  yellow: string
  brightYellow: string
  blue: string
  brightBlue: string
  magenta: string
  brightMagenta: string
  cyan: string
  brightCyan: string
  white: string
  brightWhite: string
}

export type WorkbenchTheme = {
  canvasBg: string
  windowBg: string
  titlebarBg: string
  border: string
  activeBorder: string
  titleText: string
  bodyText: string
  mutedText: string
  resizeHandleTint: string
  status: {
    running: string
    deploying: string
    error: string
    default: string
  }
  terminal: TerminalTheme
}

function tokenMap(tokens?: ThemeTokens | null): ThemeTokens {
  return { ...DEFAULT_THEME.tokens, ...(tokens ?? {}) }
}

export function resolveWorkbenchTheme(tokens?: ThemeTokens | null): WorkbenchTheme {
  const theme = tokenMap(tokens)
  const windowBg = theme["surface-raised"] ?? theme.surface
  const canvasBg = theme.surface
  const border = theme["border-default"]
  const activeBorder = theme["border-strong"] ?? theme.accent
  const titleText = theme["text-default"]
  const bodyText = theme["text-default"]
  const mutedText = theme["text-secondary"]

  return {
    canvasBg,
    windowBg,
    titlebarBg: windowBg,
    border,
    activeBorder,
    titleText,
    bodyText,
    mutedText,
    resizeHandleTint: theme["border-strong"] ?? theme["text-muted"],
    status: {
      running: theme.success,
      deploying: theme.warning,
      error: theme.danger,
      default: theme.info,
    },
    terminal: {
      background: windowBg,
      foreground: bodyText,
      cursor: titleText,
      cursorAccent: windowBg,
      selectionBackground: theme["interactive-active"] ?? theme["accent-subtle"],
      black: windowBg,
      brightBlack: theme["text-muted"],
      red: theme.danger,
      brightRed: theme["text-danger"] ?? theme.danger,
      green: theme.success,
      brightGreen: theme["text-success"] ?? theme.success,
      yellow: theme.warning,
      brightYellow: theme["text-warning"] ?? theme.warning,
      blue: theme.info,
      brightBlue: theme["text-info-hover"] ?? theme.info,
      magenta: theme.pro,
      brightMagenta: theme["text-pro"] ?? theme.pro,
      cyan: theme["text-link"],
      brightCyan: theme["text-link-hover"] ?? theme["text-link"],
      white: mutedText,
      brightWhite: titleText,
    },
  }
}
