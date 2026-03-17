import type { LifecycleStatus, AttentionLevel } from "@/lib/types"

/* ================================================================== */
/*  STATUS + ATTENTION CONFIG                                          */
/* ================================================================== */

export const ATTENTION_PRIORITY: Record<AttentionLevel, number> = { none: 0, review: 1, plan: 2, permission: 3 }
export const LIFECYCLE_PRIORITY: Record<LifecycleStatus, number> = { stopped: 0, idle: 1, deploying: 2, waiting: 3, running: 4, error: 5 }

export const LIFECYCLE_CONFIG: Record<LifecycleStatus, { dot: string; label: string; text: string; glow?: string }> = {
  running:   { dot: "bg-success",   label: "Running",  text: "text-success", glow: "text-success" },
  idle:      { dot: "bg-info",      label: "Idle",     text: "text-info" },
  waiting:   { dot: "bg-warning",   label: "Waiting",  text: "text-warning" },
  error:     { dot: "bg-danger",    label: "Error",    text: "text-danger" },
  stopped:   { dot: "bg-muted/50",  label: "Stopped",  text: "text-muted" },
  deploying: { dot: "bg-accent",    label: "Starting", text: "text-accent" },
}

export const ATTENTION_CONFIG: Record<Exclude<AttentionLevel, "none">, { dot: string; label: string; text: string; pulse: boolean }> = {
  review:     { dot: "bg-success", label: "Review",     text: "text-success", pulse: false },
  plan:       { dot: "bg-warning", label: "Plan",       text: "text-warning", pulse: true },
  permission: { dot: "bg-info",    label: "Permission", text: "text-info",    pulse: true },
}

export const MODE_CONFIG = {
  auto: { label: "auto", color: "text-success" },
  plan: { label: "plan", color: "text-warning" },
  supervised: { label: "supervised", color: "text-info" },
} as const

/* ================================================================== */
/*  THEME CONFIG                                                        */
/* ================================================================== */

export type ThemeConfig = { theme: string; mode: string }
export type ThemeTokens = Record<
  | "surface"
  | "surface-raised"
  | "surface-sunken"
  | "surface-overlay"
  | "accent"
  | "text-default"
  | "text-muted"
  | "danger"
  | "success"
  | "warning",
  string
>

export type BuiltInTheme = {
  id: string
  label: string
  mode: string
  tokens: ThemeTokens
}

export const BUILT_IN_THEMES: BuiltInTheme[] = [
  {
    id: "claude",
    label: "Dark",
    mode: "dark",
    tokens: {
      surface: "hsl(60 2.7% 14.5%)",
      "surface-raised": "hsl(60 2.1% 18.4%)",
      "surface-sunken": "hsl(30 3.3% 11.8%)",
      "surface-overlay": "hsl(60 2.1% 18.4%)",
      accent: "hsl(15 54.2% 51.2%)",
      "text-default": "hsl(48 33.3% 97.1%)",
      "text-muted": "hsl(48 4.8% 59.2%)",
      danger: "hsl(0 98.4% 75.1%)",
      success: "hsl(97 59.1% 46.1%)",
      warning: "hsl(40 71% 50%)",
    },
  },
  {
    id: "blyss",
    label: "Blyss",
    mode: "dark",
    tokens: {
      surface: "#2B303B",
      "surface-raised": "#343D46",
      "surface-sunken": "#232731",
      "surface-overlay": "#3D4452",
      accent: "#B48EAD",
      "text-default": "#C0C5CE",
      "text-muted": "#65737E",
      danger: "#BF616A",
      success: "#A3BE8C",
      warning: "#EBCB8B",
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    mode: "dark",
    tokens: {
      surface: "#191724",
      "surface-raised": "#26233a",
      "surface-sunken": "#131020",
      "surface-overlay": "#403d52",
      accent: "#eb6f92",
      "text-default": "#e0def4",
      "text-muted": "#6e6a86",
      danger: "#eb6f92",
      success: "#31748f",
      warning: "#f6c177",
    },
  },
  {
    id: "ember",
    label: "Ember",
    mode: "dark",
    tokens: {
      surface: "#282828",
      "surface-raised": "#32302f",
      "surface-sunken": "#1d2021",
      "surface-overlay": "#3c3836",
      accent: "#e78a4e",
      "text-default": "#ebdbb2",
      "text-muted": "#928374",
      danger: "#ea6962",
      success: "#a9b665",
      warning: "#d8a657",
    },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    tokens: {
      surface: "#2e3440",
      "surface-raised": "#3b4252",
      "surface-sunken": "#272c36",
      "surface-overlay": "#434c5e",
      accent: "#88c0d0",
      "text-default": "#d8dee9",
      "text-muted": "#616e88",
      danger: "#bf616a",
      success: "#a3be8c",
      warning: "#ebcb8b",
    },
  },
]

function normalizeTokenValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

export function findBuiltInThemeByTokens(tokens: Record<string, string> | null | undefined): BuiltInTheme | null {
  if (!tokens) return null
  return BUILT_IN_THEMES.find((theme) =>
    Object.entries(theme.tokens).every(([key, value]) => normalizeTokenValue(tokens[key] ?? "") === normalizeTokenValue(value)),
  ) ?? null
}
