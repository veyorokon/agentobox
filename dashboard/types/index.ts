export type FeedItemKind =
  | "USER_MESSAGE"
  | "AGENT_TEXT"
  | "ACTIVITY"
  | "STATUS"
  | "TASK"
  | "SYSTEM"
  | "ERROR"
  | "QUESTION"
  | "MEMORY"
  | "PLAN"
  | "TASK_START"
  | "TASK_END"
  | "TEAM_MESSAGE"

export interface ToolUseItem {
  name: string
  input: Record<string, unknown>
  result: Record<string, unknown>
  isError: boolean
}

export interface QuestionOption {
  label: string
  description: string
}

export interface AgentQuestion {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface QuestionAnswer {
  selectedIndices: number[]
  otherText: string | null
}

export interface FeedItem {
  id: string
  kind: FeedItemKind
  agentId: string
  agentName: string
  timestamp: string
  text: string | null
  imageUrls: string[] | null
  targetName: string | null
  tools: ToolUseItem[] | null
  fromStatus: string | null
  toStatus: string | null
  taskSummary: string | null
  errorText: string | null
  cumulativeCostUsd: number | null
  questions: AgentQuestion[] | null
  memoryContent: string | null
  planStatus: string | null
  planSummary: string | null
  planSteps: string[] | null
  taskDividerSubject: string | null
  taskDividerId: string | null
  taskDividerActiveForm: string | null
  answers: QuestionAnswer[] | null
  toolUseId: string | null
  senderName: string | null
  targetAgentIds: string[] | null
  sessionResult: SessionResult | null
}

export interface Agent {
  id: string
  name: string
  runtime: string
  sandboxId: string
  vncUrl: string
  status: string
  teamName: string
  parentSessionId: string
  sessionId: string
  model: string
  cwd: string
  permissionMode: string
  mcpServers: Record<string, unknown>
  workspacePath: string
  volumeMounts: Record<string, unknown>
  instructions: string
  role: string
  sessionCostUsd: string
  capabilities: Record<string, unknown> | null
  createdAt: string
  phase: string
  sessionResult: SessionResult | null
}

export interface SessionResult {
  id: string
  sessionId: string
  isError: boolean
  totalCostUsd: string
  durationMs: number
  durationApiMs: number
  numTurns: number
  modelUsage: Record<string, unknown>
  permissionDenials: Record<string, unknown>
  createdAt: string
  updatedAt: string
  agentId: string
}

export interface Project {
  id: string
  name: string
  description: string
  settings: Record<string, unknown>
  createdAt: string
  archivedAt: string | null
}

export interface User {
  id: string
  username: string
  email: string
}


export interface TimelineEntry {
  id: string
  entryType: string
  agentId: string
  agentName: string
  summary: string | null
  data: Record<string, unknown>
  createdAt: string
}
