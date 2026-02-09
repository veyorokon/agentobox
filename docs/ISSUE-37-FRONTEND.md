Frontend: Stream-JSON integration — typed messages, content parts, new subscriptions

## Overview

Replace the current opaque `AgentEvent`/`AgentMessage` system with typed `Message` models that mirror Claude Code's message structure directly. Eliminates the triple data path (query + events + subscription with dedup), replaces it with a single subscription of typed messages.

**Spec:** `docs/STREAM-JSON-INTEGRATION-SPEC.md` (see "Frontend Changes" section)
**Crush patterns:** `docs/CRUSH-ARCHITECTURE.md` (see "TUI / Display Layer" and "Message Pipeline")

## New Types

### `Message`
```typescript
interface Message {
  id: string;
  agentId: string;
  messageId: string;       // Claude's msg_xxx — stable dedup key
  sessionId: string;
  role: 'assistant' | 'user';
  model?: string;
  parts: ContentPart[];    // typed content parts (same as Anthropic API)
  usage?: TokenUsage;
  parentToolUseId?: string;
  stopReason?: string;
  turnNumber: number;
  createdAt: string;
}
```

### `ContentPart` (discriminated union)
```typescript
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean };
```

### `SessionResult`
```typescript
interface SessionResult {
  agentId: string;
  sessionId: string;
  isError: boolean;
  totalCostUsd: number;
  durationMs: number;
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
```

### `AgentCapabilities`
```typescript
interface AgentCapabilities {
  tools: string[];
  mcpServers: { name: string; status: string }[];
  model: string;
  version: string;
}
```

### `ToolStatus` (derived from events, not from backend)
```typescript
type ToolStatus = 'pending' | 'running' | 'success' | 'error' | 'canceled';
```

Derived from content parts: `tool_use` part exists but no matching `tool_result` → `running`. Matched `tool_result` with `is_error: false` → `success`, `is_error: true` → `error`, `interrupted: true` → `canceled`.

## Patterns to Implement (lifted from Crush)

### 1. Message → MessageItem Extraction

Separate data model from render model. One assistant `Message` with text + 2 tool calls becomes 3 render items:

```typescript
type MessageItem =
  | { type: 'user'; message: Message }
  | { type: 'assistant'; message: Message; text: string }
  | { type: 'tool'; message: Message; toolUse: ToolUsePart; toolResult?: ToolResultPart; status: ToolStatus };

function extractMessageItems(messages: Message[]): MessageItem[] {
  // Build a map of tool_use_id → tool_result for matching
  // For each message:
  //   user role → UserMessageItem
  //   assistant role → extract text parts → AssistantMessageItem
  //                  → extract tool_use parts → ToolMessageItem (with matched result)
}
```

### 2. Tool Renderer Dispatch

Instead of one giant switch in ChatView, dispatch to specialized renderers by tool name:

```typescript
const TOOL_RENDERERS: Record<string, React.FC<ToolItemProps>> = {
  Bash: BashToolView,     // terminal-style output
  Edit: EditToolView,     // diff view
  Read: ReadToolView,     // file content with line numbers
  Write: WriteToolView,   // file creation confirmation
  Glob: GlobToolView,     // file list
  Grep: GrepToolView,     // search results
  Task: TaskToolView,     // subagent indicator
  // default: GenericToolView
};
```

Each renderer receives `{ toolUse: ToolUsePart, toolResult?: ToolResultPart, status: ToolStatus }`.

### 3. Finish/Stop Reasons
```typescript
type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | null;
```

Use to show why the agent stopped (hit token limit, waiting for tool, completed).

## GraphQL Changes

### Queries — Updated

**`agent(agentId: ID!)`** now returns:
- `messages: [MessageType]` — typed messages with `parts` instead of old `AgentMessageType` with `direction`/`content`
- `sessionResult: SessionResultType` — current cost/usage
- `capabilities: AgentCapabilitiesType` — tools, MCP servers, model

### Subscriptions — Updated

**Remove:** `newEvent(projectId: ID!)` — opaque event blob

**Add:** `messageReceived(agentId: ID!)` — pushes typed `MessageType` with full `parts` array. Single subscription replaces the current triple-path convergence.

**Keep:** `agentUpdated(projectId: ID!)` — still useful for status/cost changes on agent cards

### Mutations — Unchanged Signatures

`sendMessage`, `interruptAgent`, `killAgent`, `rateAgent` keep the same input signatures. Backend implementation changes are transparent to the frontend.

**Remove:** `attachMcp` mutation — MCP configured at launch, no longer runtime-attachable.

## Scope of Changes

### Remove
- Message deduplication logic in `command-panel.tsx` (~40 lines)
- Triple data path (query + events + subscription converging with `direction:content` dedup)
- `AgentEvent` type with string-matched `eventType`
- `AgentMessage` type with `direction: 'inbound' | 'outbound'`
- `newEvent` subscription usage
- `attachMcp` mutation usage

### Add
- `Message`, `ContentPart`, `SessionResult`, `AgentCapabilities`, `ToolStatus` types
- `MessageItem` type + `extractMessageItems()` function
- Tool renderer dispatch map
- Messages Zustand store keyed by `messageId` — upsert on subscription, no dedup
- `messageReceived` subscription wiring
- Cost badge on agent cards (from `SessionResult.totalCostUsd`)
- Agent capabilities panel (tools, MCP servers from `AgentCapabilities`)
- `turnNumber` grouping in ChatView
- `StopReason` display (why agent stopped)

### Store Pattern (Zustand)

Single upsert pattern for the messages store:

```typescript
interface MessagesState {
  byAgent: Record<string, Record<string, Message>>; // agentId → messageId → Message
  upsert: (agentId: string, message: Message) => void;
}

// Subscription handler:
onMessageReceived(message) {
  messagesStore.getState().upsert(message.agentId, message);
}
```

No dedup needed — `messageId` is the stable key, upsert handles updates.

## Acceptance Criteria

- [ ] New types defined (`Message`, `ContentPart`, `SessionResult`, `AgentCapabilities`, `ToolStatus`)
- [ ] `extractMessageItems()` converts Messages to renderable MessageItems
- [ ] Tool renderer dispatch map with at least Bash, Edit, Read, and Generic renderers
- [ ] Messages store (Zustand) with upsert by `messageId`
- [ ] `messageReceived` subscription wired to store
- [ ] ChatView renders typed content parts (text, tool_use, tool_result)
- [ ] Cost badge on agent cards from SessionResult
- [ ] Agent capabilities panel (tools, MCP servers)
- [ ] Old dedup logic, `AgentEvent`/`AgentMessage` types, `newEvent` subscription removed
- [ ] `attachMcp` mutation usage removed
- [ ] Messages grouped by `turnNumber` in ChatView

---

## Comments

### Comment

## Update: `--include-partial-messages` validated — live typing is possible

With `--include-partial-messages`, Claude streams `stream_event` events with text/tool deltas:

```
stream_event {delta: {type: "text_delta", text: "I'll list"}}
stream_event {delta: {type: "text_delta", text: " the files."}}
assistant    {content: [{type: "text", text: "I'll list the files."}]}  ← final
```

**Frontend impact:**
- New ephemeral subscription: `agentStreaming(agentId: ID!)` for `stream_event` payloads
- Accumulate `text_delta` chunks into a temporary string for live typing display
- On `assistant` event via `messageReceived`, replace accumulated text with final message
- `input_json_delta` can show tool parameters being typed (optional, nice UX)
- `content_block_start/stop` provide clean transition points (start typing animation, stop)
- MCP tools stream identically to native tools

**New type needed:**
```typescript
interface StreamDelta {
  eventType: 'content_block_start' | 'content_block_delta' | 'content_block_stop' 
           | 'message_start' | 'message_delta' | 'message_stop';
  index?: number;
  delta?: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string };
  contentBlock?: { type: 'text' | 'tool_use' };
}
```

Spec updated with full details.

---

### Comment

## Convention: JSDoc/comments must trace back to Claude Code

Every type, component, and utility must include documentation that explains:
1. Which Claude Code stream-json event(s) it maps to
2. Field-by-field mapping from the wire format
3. Reference to the relevant spec section

Example:

```typescript
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
interface Message { ... }
```

```typescript
/**
 * Discriminated union matching Anthropic API content block types.
 * These are stored verbatim from Claude Code's message.content[] array.
 * 
 * Types:
 *   text        <- {type: "text", text: string}
 *   tool_use    <- {type: "tool_use", id: string, name: string, input: object}
 *   tool_result <- {type: "tool_result", tool_use_id: string, content: string, is_error: boolean}
 * 
 * Note: field names use Claude Code's conventions (tool_use_id not toolUseId,
 * is_error not isError) because these are stored/transmitted as-is from the
 * stream-json output.
 */
type ContentPart = ...
```

```typescript
/**
 * Converts Message[] to renderable MessageItem[].
 * 
 * Pattern lifted from Crush (charmbracelet/crush) — separates data model
 * from render model. One assistant Message with text + 2 tool calls becomes
 * 3 MessageItems (1 text + 2 tool items with matched results).
 * 
 * @see docs/CRUSH-ARCHITECTURE.md, "ExtractMessageItems"
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Patterns to Implement"
 */
function extractMessageItems(messages: Message[]): MessageItem[] { ... }
```

```typescript
/**
 * Live streaming deltas from Claude Code's --include-partial-messages flag.
 * 
 * These wrap raw Anthropic streaming API events. NOT persisted — ephemeral
 * only, forwarded via WebSocket for live typing display.
 * 
 * Delta types:
 *   text_delta       <- streaming text chunks (2-5 words)
 *   input_json_delta <- streaming tool input JSON fragments
 * 
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Partial Messages (Live Streaming)"
 */
interface StreamDelta { ... }
```

Apply this convention to all new code: types, components, stores, utilities.

