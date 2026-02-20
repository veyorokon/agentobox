/**
 * Stream-JSON types for the Agentobox dashboard.
 *
 * These types mirror Claude Code's stream-json output format. The stream-json
 * interface emits one JSON object per stdout line, each with a `type` field.
 * The dashboard receives these via GraphQL subscription after the backend
 * parses and persists them.
 *
 * Architecture:
 *   Claude subprocess (--output-format stream-json)
 *     → abox-relay (in-container, reads stdout)
 *     → POST /events/stream (to Django backend)
 *     → persist StreamEvent + broadcast via GraphQL subscription
 *     → dashboard Zustand stores → components
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/ARCHITECTURE.md (pattern origin for MessageItem/extractMessageItems)
 * @see docs/ARCHITECTURE.md (Claude Code internals)
 */

// ─── Content Parts ─────────────────────────────────────────────────────────
//
// Discriminated union matching Anthropic API content block types.
// These are stored verbatim from Claude Code's message.content[] array.
//
// Types:
//   text             <- {type: "text", text: string}
//   tool_use         <- {type: "tool_use", id: string, name: string, input: object}
//   tool_result      <- {type: "tool_result", tool_use_id: string, content: string, is_error: boolean}
//   thinking         <- {type: "thinking", thinking: string}  (extended thinking)
//   redacted_thinking <- {type: "redacted_thinking"}  (redacted by API)
//
// Note: field names use Claude Code's snake_case conventions (tool_use_id not
// toolUseId, is_error not isError) because these are stored/transmitted as-is
// from the stream-json output.
//
// @see docs/ARCHITECTURE.md, "Output Event Stream" §3-§5
// @see docs/ARCHITECTURE.md, "Content Parts"

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolUsePart {
  type: 'tool_use';
  /** Unique tool call ID (e.g. "toolu_01Vz4..."). Correlates to tool_result.tool_use_id. */
  id: string;
  /** Tool name (e.g. "Bash", "Edit", "Read", "Write", "Glob", "Grep", "Task"). */
  name: string;
  /** Tool input parameters. Shape varies by tool. */
  input: Record<string, unknown>;
}

export interface ToolResultPart {
  type: 'tool_result';
  /** Correlates to the tool_use part's id. */
  tool_use_id: string;
  /** Tool output content (normalized to string by backend). */
  content: string;
  /** Whether the tool execution failed. */
  is_error: boolean;
}

export interface ThinkingPart {
  type: 'thinking';
  thinking: string;
}

export interface RedactedThinkingPart {
  type: 'redacted_thinking';
}

export type ContentPart =
  | TextPart
  | ToolUsePart
  | ToolResultPart
  | ThinkingPart
  | RedactedThinkingPart;


// ─── Token Usage ───────────────────────────────────────────────────────────
//
// Per-turn token counts from Claude Code's assistant message.usage field.
// Includes Anthropic prompt caching breakdown.
//
// Field mapping from stream-json:
//   inputTokens             <- usage.input_tokens
//   outputTokens            <- usage.output_tokens
//   cacheCreationInputTokens <- usage.cache_creation_input_tokens
//   cacheReadInputTokens    <- usage.cache_read_input_tokens
//
// @see docs/ARCHITECTURE.md, "Metrics Available"

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}


// ─── Message ───────────────────────────────────────────────────────────────
//
// Mirrors Claude Code's stream-json assistant/user events.
//
// Each event with type="assistant" or type="user" becomes one Message.
// The `parts` array stores message.content[] verbatim — the same typed
// content parts used by the Anthropic Messages API.
//
// Field mapping from Claude Code stream-json:
//   messageId       <- event.message.id (stable dedup key across incremental updates)
//   sessionId       <- event.session_id
//   role            <- event.message.role ("assistant" | "user")
//   model           <- event.message.model (present on assistant messages)
//   parts           <- event.message.content[] (ContentPart[])
//   usage           <- event.message.usage (token counts with cache breakdown)
//   stopReason      <- event.message.stop_reason ("end_turn" | "tool_use" | "max_tokens")
//   parentToolUseId <- event.parent_tool_use_id (non-null for subagent responses)
//
// Upsert semantics: Multiple assistant events may share the same messageId
// (e.g. text part followed by tool_use part). The store must MERGE parts
// arrays on matching messageId, not skip duplicates.
//
// @see docs/ARCHITECTURE.md, "Output Event Stream" §3-§5
// @see docs/ARCHITECTURE.md, "Event Correlation"
// @see docs/ARCHITECTURE.md, "Message Pipeline" (pattern origin)

export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | null;

export interface Message {
  /** Backend database ID. */
  id: string;
  /** Agent this message belongs to. */
  agentId: string;
  /** Claude's message.id (e.g. "msg_01Mhp..."). Stable dedup/upsert key. */
  messageId: string;
  /** Session UUID, stable across multi-turn conversations. */
  sessionId: string;
  /** Message role. "assistant" for model output, "user" for tool results and user prompts. */
  role: 'assistant' | 'user';
  /** Model that generated this message (e.g. "claude-sonnet-4-5-20250929"). Assistant messages only. */
  model?: string;
  /** Typed content parts — text, tool_use, tool_result, thinking. Stored verbatim from stream-json. */
  parts: ContentPart[];
  /** Per-turn token usage with cache breakdown. Assistant messages only. */
  usage?: TokenUsage;
  /** Non-null when this is a subagent response. Links to the parent Task tool_use.id. */
  parentToolUseId?: string;
  /** Why the model stopped generating. null while streaming. */
  stopReason?: StopReason;
  /** Sequential turn number within the session. Useful for grouping in ChatView. */
  turnNumber: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
}


// ─── Tool Status ───────────────────────────────────────────────────────────
//
// Derived from the tool call lifecycle, NOT stored as a backend field.
//
// Lifecycle (from stream-json events):
//   assistant event with tool_use content part → pending/running
//   user event with tool_result:
//     is_error: false                         → success
//     is_error: true                          → error
//     tool_use_result.interrupted: true        → canceled
//
// @see docs/ARCHITECTURE.md, "Tool Call Lifecycle"
// @see docs/ARCHITECTURE.md, "Tool Status Display"

export type ToolStatus = 'pending' | 'running' | 'success' | 'error' | 'canceled';


// ─── Model Usage ───────────────────────────────────────────────────────────
//
// Per-model cost/token breakdown from the result event's modelUsage field.
//
// Field mapping from stream-json result event:
//   inputTokens             <- modelUsage[model].inputTokens
//   outputTokens            <- modelUsage[model].outputTokens
//   cacheReadInputTokens    <- modelUsage[model].cacheReadInputTokens
//   cacheCreationInputTokens <- modelUsage[model].cacheCreationInputTokens
//   costUSD                 <- modelUsage[model].costUSD
//   contextWindow           <- modelUsage[model].contextWindow
//   maxOutputTokens         <- modelUsage[model].maxOutputTokens
//
// @see docs/ARCHITECTURE.md, "Output Event Stream" §6 (result)

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}


// ─── Session Result ────────────────────────────────────────────────────────
//
// Per-turn cost and usage summary from stream-json result events.
//
// Important: result events fire after EACH turn, not per-session. The
// `totalCostUsd` and `modelUsage` fields accumulate across turns. The
// frontend should REPLACE (not append) SessionResult per agent — the
// latest result event is the authoritative cumulative total.
//
// Field mapping from stream-json result event:
//   sessionId        <- result.session_id
//   isError          <- result.is_error
//   totalCostUsd     <- result.total_cost_usd (cumulative across turns)
//   durationMs       <- result.duration_ms (total elapsed time)
//   durationApiMs    <- result.duration_api_ms (API call time; diff = tool execution time)
//   numTurns         <- result.num_turns (cumulative turn count)
//   modelUsage       <- result.modelUsage (per-model breakdown)
//   permissionDenials <- result.permission_denials (blocked tool attempts)
//
// @see docs/ARCHITECTURE.md, "Output Event Stream" §6 (result)
// @see docs/ARCHITECTURE.md, "Metrics Available"

export interface SessionResult {
  agentId: string;
  sessionId: string;
  isError: boolean;
  totalCostUsd: number;
  durationMs: number;
  /** API call time. (durationMs - durationApiMs) = tool execution time. */
  durationApiMs: number;
  numTurns: number;
  /** Per-model cost and token breakdown. Key is model ID (e.g. "claude-sonnet-4-5-20250929"). */
  modelUsage: Record<string, ModelUsage>;
  /** List of tool names that were denied by permission checks. */
  permissionDenials: string[];
}


// ─── MCP Server ────────────────────────────────────────────────────────────
//
// MCP server status from system/init event's mcp_servers array.
//
// @see docs/ARCHITECTURE.md, "Output Event Stream" §1 (system/init)

export interface McpServer {
  name: string;
  status: string;
}


// ─── Agent Capabilities ────────────────────────────────────────────────────
//
// Agent capability manifest from the system/init event. Emitted at session
// start AND at the beginning of each new turn in multi-turn mode. Frontend
// should upsert by agentId — store the LATEST init per agent.
//
// Field mapping from stream-json system/init event:
//   tools      <- init.tools (e.g. ["Task", "Bash", "Edit", "Read", ...])
//   mcpServers <- init.mcp_servers (e.g. [{name: "tavily", status: "connected"}])
//   model      <- init.model (e.g. "claude-sonnet-4-5-20250929")
//   version    <- init.claude_code_version (e.g. "2.1.37")
//   agents     <- init.agents (subagent types: ["Bash", "general-purpose", ...])
//   skills     <- init.skills (loaded skills: ["react-best-practices", ...])
//
// @see docs/ARCHITECTURE.md, "Output Event Stream" §1 (system/init)

export interface AgentCapabilities {
  tools: string[];
  mcpServers: McpServer[];
  model: string;
  version: string;
  agents: string[];
  skills: string[];
}


// ─── Stream Delta (Partial Messages) ───────────────────────────────────────
//
// Live streaming deltas from Claude Code's --include-partial-messages flag.
//
// These wrap raw Anthropic streaming API events. NOT persisted — ephemeral
// only, forwarded via WebSocket for live typing display. The dashboard
// accumulates text_delta chunks into a temporary string; on receipt of the
// final assistant event via messageReceived subscription, the accumulated
// text is replaced by the complete message.
//
// Delta types:
//   text_delta       <- streaming text chunks (2-5 words per delta)
//   input_json_delta <- streaming tool input JSON fragments
//
// Block types (from content_block_start):
//   text     <- model is producing text
//   tool_use <- model is producing tool call JSON
//
// @see docs/ARCHITECTURE.md, "Partial Messages (Live Streaming)"
// @see docs/ISSUE-37-FRONTEND.md, "Update: --include-partial-messages validated"

export type StreamDeltaEventType =
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_start'
  | 'message_delta'
  | 'message_stop';

export type StreamDeltaPayload =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string };

export interface StreamDelta {
  eventType: StreamDeltaEventType;
  /** Content block index within the message. */
  index?: number;
  /** Delta payload — text chunk or tool input JSON fragment. */
  delta?: StreamDeltaPayload;
  /** Content block type, present on content_block_start events. */
  contentBlock?: { type: 'text' | 'tool_use' | 'thinking' | 'redacted_thinking'; id?: string; name?: string };
}


// ─── Message Items (Render Model) ──────────────────────────────────────────
//
// Separates data model (Message) from render model (MessageItem).
//
// Pattern lifted from Crush (charmbracelet/crush) — one assistant Message
// with text + 2 tool calls becomes 3 MessageItems (1 text + 2 tool items
// with matched results). This decoupling lets ChatView render each content
// part independently with specialized tool renderers.
//
// The extractMessageItems() function in lib/messages.ts performs this
// conversion.
//
// @see docs/ARCHITECTURE.md, "TUI / Display Layer" → ExtractMessageItems
// @see docs/ISSUE-37-FRONTEND.md, "Patterns to Implement" §1

export interface UserMessageItem {
  type: 'user';
  /** The source Message. */
  message: Message;
  /** Extracted text content from the user message's text parts. */
  text: string;
}

export interface AssistantMessageItem {
  type: 'assistant';
  /** The source Message. */
  message: Message;
  /** Concatenated text from all text parts in this message. */
  text: string;
}

export interface ToolMessageItem {
  type: 'tool';
  /** The source Message containing the tool_use part. */
  message: Message;
  /** The tool_use content part from the assistant message. */
  toolUse: ToolUsePart;
  /** Matched tool_result from a subsequent user message, if completed. */
  toolResult?: ToolResultPart;
  /** Derived tool status based on presence/absence of result. */
  status: ToolStatus;
}

export type MessageItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolMessageItem;
