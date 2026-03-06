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

/** Available themes for the picker UI. */
export const BUILT_IN_THEMES: { id: string; label: string; mode: string }[] = [
  { id: "claude", label: "Dark", mode: "dark" },
  { id: "blyss", label: "Blyss Dark", mode: "dark" },
]

