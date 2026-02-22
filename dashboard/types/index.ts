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


/**
 * Content block types from Claude Code's stream-json output.
 * assistant messages have data.message.content as an array of these.
 */
export interface TextBlock {
  type: "text"
  text: string
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
  /** Populated during feed consolidation from the matching user tool_result event */
  _result?: {
    content: string
    isError: boolean
  }
}

export interface ThinkingBlock {
  type: "thinking"
  thinking: string
}

export interface RedactedThinkingBlock {
  type: "redacted_thinking"
}

export interface ImageBlock {
  type: "image"
  source: {
    type: string
    media_type: string
    data: string
  }
}

export interface ToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string | unknown[]
  is_error?: boolean
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ImageBlock
  | ToolResultBlock

/* ------------------------------------------------------------------ */
/*  Per-entryType data shapes                                         */
/* ------------------------------------------------------------------ */

export interface AssistantEventData {
  message: {
    role: "assistant"
    content: ContentBlock[]
    id?: string
    model?: string
    type?: string
    stop_reason?: string | null
    stop_sequence?: string | null
    context_management?: unknown
    usage?: Record<string, unknown>
  }
  [key: string]: unknown
}

export interface UserEventData {
  message: {
    role: "user"
    content: ContentBlock[] | string
  }
  tool_use_result?: {
    type: string
    file?: {
      content: string
      filePath: string
      numLines?: number
      startLine?: number
      totalLines?: number
    }
    stdout?: string
    stderr?: string
    interrupted?: boolean
    isImage?: boolean
    noOutputExpected?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SystemEventData {
  subtype: string
  model?: string
  tools?: string[]
  exit_code?: number
  text?: string
  message?: string
  [key: string]: unknown
}

export interface ResultEventData {
  subtype: string
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  is_error?: boolean
  result?: string
  modelUsage?: Record<string, unknown>
  session_id?: string
  stop_reason?: string | null
  usage?: Record<string, unknown>
  permission_denials?: unknown[]
  [key: string]: unknown
}

export interface StatusEventData {
  from?: string
  to?: string
  [key: string]: unknown
}

/* ------------------------------------------------------------------ */
/*  TimelineEntry + type guards for narrowing data by entryType       */
/* ------------------------------------------------------------------ */

export interface TimelineEntry {
  id: string
  entryType: string
  agentId: string
  agentName: string
  summary: string | null
  data: Record<string, unknown>
  createdAt: string
}

/**
 * Narrowed entry types for use after type guard checks.
 * Components accept these typed versions directly from their parent
 * (which already checked entryType via switch/if).
 */
export interface AssistantEntry extends TimelineEntry {
  entryType: "assistant"
  data: AssistantEventData
}

export interface UserEntry extends TimelineEntry {
  entryType: "user"
  data: UserEventData
}

export interface SystemEntry extends TimelineEntry {
  entryType: "system"
  data: SystemEventData
}

export interface ResultEntry extends TimelineEntry {
  entryType: "result"
  data: ResultEventData
}

export interface StatusEntry extends TimelineEntry {
  entryType: "status"
  data: StatusEventData
}

/** Type guards for narrowing TimelineEntry by entryType. */
export function isAssistantEntry(e: TimelineEntry): e is AssistantEntry {
  return e.entryType === "assistant"
}

export function isUserEntry(e: TimelineEntry): e is UserEntry {
  return e.entryType === "user"
}

export function isSystemEntry(e: TimelineEntry): e is SystemEntry {
  return e.entryType === "system"
}

export function isResultEntry(e: TimelineEntry): e is ResultEntry {
  return e.entryType === "result"
}

export function isStatusEntry(e: TimelineEntry): e is StatusEntry {
  return e.entryType === "status"
}
