/* ================================================================== */
/*  SHARED TYPES                                                       */
/* ================================================================== */

export type LifecycleStatus = "deploying" | "running" | "waiting" | "error" | "idle" | "stopped"
export type AttentionLevel = "none" | "review" | "plan" | "permission"
export type Breakpoint = "mobile" | "S" | "M" | "L" | "XL"

export type FakeAgent = {
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

export type FakeSecret = {
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
  | { type: "system"; text: string }
  | { type: "user"; text: string; target?: string }
  | { type: "summary"; agent: string; summary: string; cost: number; turns: number; duration: string; isError?: boolean }
  | { type: "status"; agent: string; from: string; to: string }
  | { type: "error"; agent: string; text: string }
  | { type: "question"; agent: string; question: string; options: string[] }
  | { type: "plan"; agent: string; title: string; plan: string; planStatus: "pending" | "approved" | "rejected" }
  | { type: "permission"; agent: string; command: string; risk?: string; permStatus: "pending" | "allowed" | "denied" }
  | { type: "multi-question"; agent: string; questions: { text: string; options: string[] }[] }
  | { type: "agent-message"; from: string; to: string; text: string }

export type PendingItem = Extract<TeamFeedItem, { type: "permission" }> | Extract<TeamFeedItem, { type: "plan" }>

export type ViewMode = "terminal" | "feed" | "settings" | "skills"

export type AgentAction =
  | { type: "SET_LIFECYCLE"; agentId: string; status: LifecycleStatus }
  | { type: "SET_ATTENTION"; agentId: string; level: AttentionLevel }
  | { type: "ACKNOWLEDGE"; agentId: string }
  | { type: "RESET" }
