/* ================================================================== */
/*  SHARED TYPES                                                       */
/* ================================================================== */

export type LifecycleStatus = "deploying" | "running" | "waiting" | "error" | "idle" | "stopped"
export type AttentionLevel = "none" | "review" | "plan" | "permission"
export type Breakpoint = "mobile" | "S" | "M" | "L" | "XL"

export type Agent = {
  id: string
  name: string
  lifecycleStatus: LifecycleStatus
  attentionLevel: AttentionLevel
  task: string
  cost: number
  duration: string
  model: string
  turns: number
  lastOutput: string
  phase?: string
  /** Live one-liner: last tool call or action, continuously updated.
   *  SOURCE: latest tool_use content block name + summary from StreamEvent */
  liveAction?: string
  /** Compact todo progress for live status bar */
  todoProgress?: { done: number; total: number }
  instructions: string
  mcpServers: string[]
  runtime: "docker" | "modal"
  workspacePath: string
  tags: string[]
  mode: "auto" | "plan" | "supervised"
}

export type RecipientEntry =
  | { type: "agent"; value: string }
  | { type: "tag"; value: string }
  | { type: "all" }

export type Secret = {
  id: string
  key: string
  value: string
  addedAgo: string
}

export type Skill = {
  id: string
  name: string
  description: string
  content: string
  assignedTags: string[]
  steps?: number
}

export type TeamFeedItem =
  | { id: string; type: "system"; text: string }
  | { id: string; type: "user"; text: string; target?: string }
  | { id: string; type: "summary"; agent: string; summary: string; cost: number; turns: number; duration: string; isError?: boolean }
  | { id: string; type: "status"; agent: string; from: string; to: string }
  | { id: string; type: "error"; agent: string; text: string }
  | { id: string; type: "question"; agent: string; question: string; options: string[] }
  | { id: string; type: "plan"; agent: string; title: string; plan: string; planStatus: "pending" | "approved" | "rejected" }
  | { id: string; type: "permission"; agent: string; command: string; risk?: string; permStatus: "pending" | "allowed" | "denied" }
  | { id: string; type: "multi-question"; agent: string; questions: { text: string; options: string[] }[] }
  | { id: string; type: "agent-message"; from: string; to: string; text: string }

export type PendingItem = Extract<TeamFeedItem, { type: "permission" }> | Extract<TeamFeedItem, { type: "plan" }>

export type ViewMode = "terminal" | "feed" | "settings" | "skills"
