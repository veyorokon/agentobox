import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01"
  return `$${usd.toFixed(2)}`
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  return `${mins}m ${remainSecs}s`
}

/** Strip MCP server prefix: "mcp__abox-coord__task_list" → "task_list" */
export function friendlyToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__")
    return parts[parts.length - 1]
  }
  return name
}

const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
  "claude-opus-4-6": "Opus 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-sonnet-4-6": "Sonnet 4.6",
}

/** Strip XML noise injected by Claude Code into messages/tool results.
 * system-reminder blocks are removed entirely.
 * error/tool_use_error tags are unwrapped (keep text, strip tags).
 */
export function stripSystemReminders(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<\/?error>/g, "")
    .replace(/<\/?tool_use_error>/g, "")
    .trim()
}

/**
 * Deterministic hue (0-360) from an agent name.
 * Used for avatar background colors across the app.
 */
export function agentHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return ((hash % 360) + 360) % 360
}

export function friendlyModelName(raw: string): string {
  if (MODEL_LABELS[raw]) return MODEL_LABELS[raw]
  // Try partial match: "claude-sonnet-4-5" → "Sonnet 4.5"
  for (const [key, label] of Object.entries(MODEL_LABELS)) {
    if (raw.startsWith(key.replace(/-\d{8}$/, ""))) return label
  }
  // Fallback: strip "claude-" prefix and capitalize
  return raw.replace(/^claude-/, "").replace(/-\d{8}$/, "")
}
