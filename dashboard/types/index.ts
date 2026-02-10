/**
 * Types matching backend GraphQL schema.
 *
 * Stream-json types mirror Claude Code's output format 1:1.
 * Field names follow Claude Code conventions (snake_case in wire format,
 * camelCase in TypeScript per GraphQL convention).
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
 * @see docs/CRUSH-ARCHITECTURE.md, "Message Model" (pattern origin)
 */

// ── Agent ──

export type AgentStatus =
  | 'deploying'
  | 'running'
  | 'idle'
  | 'stopped'
  | 'error';

export interface Agent {
  id: string;
  name: string;
  role: 'lead' | 'worker';
  status: AgentStatus;
  vncUrl: string;
  sandboxId: string;
  runtime: string;
  teamName: string;
  sessionId: string;
  model: string;
  cwd: string;
  permissionMode: string;
  mcpServers: Record<string, unknown>;
  workspacePath: string;
  instructions: string;
  sessionCostUsd: string | null;
  capabilities: AgentCapabilities | null;
  createdAt: string;
}

/**
 * Agent capabilities from Claude Code's system/init event.
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "system/init"
 */
export interface AgentCapabilities {
  tools: string[];
  mcpServers: { name: string; status: string }[];
  model: string;
  version: string;
}

// ── Messages (stream-json) ──

/**
 * Mirrors Claude Code's stream-json assistant/user events.
 *
 * Each event with type="assistant" or type="user" becomes one Message.
 * The `parts` array stores message.content[] verbatim — the same typed
 * content parts used by the Anthropic Messages API.
 *
 * Field mapping from Claude Code stream-json:
 *   messageId  <- event.message.id (stable dedup key across incremental updates)
 *   sessionId  <- event.session_id
 *   role       <- event.message.role ("assistant" | "user")
 *   parts      <- event.message.content[] (ContentPart[])
 *   usage      <- event.message.usage (token counts with cache breakdown)
 *   stopReason <- event.message.stop_reason ("end_turn" | "tool_use" | "max_tokens")
 *   parentToolUseId <- event.parent_tool_use_id (non-null for subagent responses)
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
 * @see docs/CRUSH-ARCHITECTURE.md, "Message Model" (pattern origin)
 */
export interface Message {
  id: string;
  agentId: string;
  messageId: string;
  sessionId: string;
  role: 'assistant' | 'user';
  model?: string;
  parts: ContentPart[];
  usage?: TokenUsage;
  parentToolUseId?: string;
  stopReason?: string;
  turnNumber: number;
  createdAt: string;
}

/**
 * Discriminated union matching Anthropic API content block types.
 * These are stored verbatim from Claude Code's message.content[] array.
 *
 * Types:
 *   text        <- {type: "text", text: string}
 *   tool_use    <- {type: "tool_use", id: string, name: string, input: object}
 *   tool_result <- {type: "tool_result", tool_use_id: string, content: string, is_error: boolean}
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Cost and usage from Claude Code's stream-json result events.
 * Upserted per-turn with cumulative totals.
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "result event"
 */
export interface SessionResult {
  id: string;
  agentId: string;
  sessionId: string;
  isError: boolean;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  }>;
  permissionDenials: string[];
}

// ── Render model (Crush pattern) ──

/**
 * Derived tool status from matching tool_use and tool_result content parts.
 *
 * @see docs/CRUSH-ARCHITECTURE.md, "ExtractMessageItems"
 */
export type ToolStatus = 'pending' | 'running' | 'success' | 'error' | 'canceled';

/**
 * Render items extracted from Messages. Separates data model from render model.
 * One assistant Message with text + 2 tool calls becomes 3 MessageItems.
 *
 * Pattern lifted from Crush (charmbracelet/crush).
 *
 * @see docs/CRUSH-ARCHITECTURE.md, "ExtractMessageItems"
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Patterns to Implement"
 */
export type MessageItem =
  | { type: 'user'; message: Message; text: string }
  | { type: 'assistant'; message: Message; text: string }
  | { type: 'tool'; message: Message; toolUse: Extract<ContentPart, { type: 'tool_use' }>; toolResult?: Extract<ContentPart, { type: 'tool_result' }>; status: ToolStatus };

export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | null;

// ── Secrets ──

export interface SecretGroup {
  id: string;
  name: string;
  projectId: string;
  keys: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Other ──

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthPayload {
  user: User;
  token: string;
}
