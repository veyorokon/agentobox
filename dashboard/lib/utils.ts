import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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

/** Strip MCP server prefix: "mcp__team__task_list" → "task_list" */
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

/* ── Tool row helpers ──────────────────────────────────────────────── */

const TOOL_CATEGORIES: Record<string, string> = {
  Edit: "edit",
  Write: "edit",
  Read: "read",
  WebFetch: "read",
  Bash: "command",
  bash: "command",
  Grep: "search",
  Glob: "search",
  WebSearch: "search",
}

export function toolCategory(name: string): string {
  return TOOL_CATEGORIES[name] ?? "tool"
}

const CATEGORY_LABELS: Record<string, { singular: string; plural: (n: number) => string }> = {
  edit: { singular: "Edited a file", plural: (n) => `Edited ${n} files` },
  read: { singular: "Read a file", plural: (n) => `Read ${n} files` },
  command: { singular: "Ran a command", plural: (n) => `Ran ${n} commands` },
  search: { singular: "Searched code", plural: () => "Searched code" },
  tool: { singular: "Used a tool", plural: (n) => `Used ${n} tools` },
}

export function summarizeSingleTool(name: string): string {
  const cat = toolCategory(name)
  return CATEGORY_LABELS[cat]?.singular ?? "Used a tool"
}

export function summarizeToolGroup(tools: { name: string }[]): string {
  const counts = new Map<string, number>()
  for (const t of tools) {
    const cat = toolCategory(t.name)
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  const phrases: string[] = []
  for (const [cat, count] of counts) {
    const labels = CATEGORY_LABELS[cat] ?? CATEGORY_LABELS.tool!
    phrases.push(count === 1 ? labels.singular : labels.plural(count))
  }
  return phrases.join(", ")
}

export function computeLineDelta(
  input: Record<string, unknown>,
): { added: number; removed: number } | null {
  const oldStr = input.old_string
  const newStr = input.new_string
  if (typeof oldStr !== "string" && typeof newStr !== "string") return null
  const oldLines = typeof oldStr === "string" ? oldStr.split("\n").length : 0
  const newLines = typeof newStr === "string" ? newStr.split("\n").length : 0
  // For Write tool (content field, no old_string)
  if (typeof oldStr !== "string" && typeof input.content === "string") {
    return { added: String(input.content).split("\n").length, removed: 0 }
  }
  return { added: newLines, removed: oldLines }
}

export function shortenFilePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path
  const parts = path.split("/")
  // Keep progressively fewer leading segments
  for (let skip = 1; skip < parts.length - 1; skip++) {
    const shortened = "…/" + parts.slice(skip).join("/")
    if (shortened.length <= maxLen) return shortened
  }
  return "…/" + parts[parts.length - 1]
}
