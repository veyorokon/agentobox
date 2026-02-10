# Claude Code Message Pipeline

Reverse-engineered from the Claude Code v2.1.37 binary. Documents the internal message lifecycle — how messages are created, formatted, sent to the API, streamed back, dispatched to tools, persisted to transcripts, and displayed.

This is the reference for building a messaging system that maintains parity with Claude Code's internals.

---

## Internal Message Types

Claude Code wraps Anthropic API messages in its own event layer. Every message flowing through the system is one of these internal types:

| Internal Type | Description |
|---|---|
| `user` | User input, tool results, synthetic messages |
| `assistant` | Model responses (text + tool_use blocks) |
| `system` | Compaction boundaries, local commands |
| `progress` | Subagent progress, streaming status |
| `grouped_tool_use` | Multiple parallel tool calls collapsed into one display unit |
| `attachment` | File attachments, queued commands |
| `tombstone` | Deleted/replaced messages |

Each wraps a `.message` with `{role, content}` (Anthropic API format) plus metadata:

```
{
  type: "user" | "assistant" | ...,
  uuid: string,           // crypto.randomUUID()
  timestamp: string,      // ISO 8601
  message: {
    role: "user" | "assistant",
    content: string | ContentBlock[]
  },
  // User-specific:
  isMeta: boolean,
  isVisibleInTranscriptOnly: boolean,
  isCompactSummary: boolean,
  summarizeMetadata: object,
  toolUseResult: object,
  mcpMeta: object,
  imagePasteIds: string[],
  sourceToolAssistantUUID: string,
  permissionMode: string,
  // Assistant-specific:
  requestId: string,
  error: object,
  isMeta: boolean
}
```

---

## Key Functions (Minified Names)

Reference for navigating the binary. Offsets are from v2.1.37.

### Message Creation

| Function | Role | Offset |
|---|---|---|
| `kR()` | Creates `type:"user"` messages (tool results, synthetic prompts, system injections) | ~19063777 |
| `hoB()` | Creates `type:"assistant"` messages | ~19063217 |
| `z1()` | Creates error/API-error assistant messages | ~19063700 |

### API Formatting

| Function | Role | Offset |
|---|---|---|
| `aN8()` | Formats user messages for Anthropic API — adds `cache_control` headers to last content block | ~18887458 |
| `rN8()` | Formats assistant messages for API — handles thinking/redacted_thinking blocks, adds cache_control | ~18887804 |
| `Q87()` | Sanitizes messages — strips extra fields from `tool_use`/`tool_result`, keeps only `id`, `name`, `input` | ~13258643 |

### Streaming & API Call

| Function | Role | Offset |
|---|---|---|
| `bc()` | Main API call entry — takes `{messages, systemPrompt, maxThinkingTokens, tools, signal, options}`, returns async generator | ~18888142 |
| `maB()` | Inner streaming generator — calls Anthropic API, yields streaming events, handles bedrock/vertex routing | ~18889191 |
| `iOA()` | Context management wrapper — handles prompt caching and compaction around `bc()` via `j3R()` | ~13257845 |

### Message Processing

| Function | Role | Offset |
|---|---|---|
| `JC()` | Message preparation — filters messages, removes hidden tools, strips caller metadata, applies input transforms | ~19072360 |
| `uO()` | Splits multi-content-block assistant messages into individual display messages (one per content block) | ~19065877 |
| `PyA()` | Converts internal messages to streaming event format for the conversation loop | ~17878372 |

### Persistence

| Function | Role | Offset |
|---|---|---|
| `UoB` class | Transcript writer — manages write queue, batching, file I/O | ~19115200 |
| `WW()` | Singleton accessor for `UoB` instance | ~19115127 |
| `Ab()` | Writes a message chain to the current session transcript (deduplicates by UUID) | ~19115700 |
| `K7T()` | Writes a message chain as a sidechain (subagent transcript) | ~19115750 |
| `m3()` | Builds main session transcript path: `~/.claude/projects/{hash}/{sessionId}.jsonl` | ~19114792 |
| `uP()` | Builds subagent transcript path: `~/.claude/projects/{hash}/{sessionId}/subagents/agent-{id}.jsonl` | ~19114879 |

### Token Budget

| Function | Role | Offset |
|---|---|---|
| `RYR()` | Token budget calculator — computes system prompt, tools, messages, MCP tools, agents, memory files, free space | ~17765624 |

---

## Full Turn Lifecycle

### 1. User Input

User text arrives and is wrapped into an internal message:

```
{
  type: "user",
  message: { role: "user", content: T || FU },  // FU = empty placeholder constant
  uuid: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  isMeta: false,
  isVisibleInTranscriptOnly: false,
  ...
}
```

This is constructed by `kR()`. The same function creates tool result messages and synthetic system injections — they're all `type:"user"` internally.

### 2. Message Preparation (JC)

Before sending to the API, messages pass through `JC()`:

1. Filter out messages for tools not in the current toolset
2. Strip `caller` metadata from `tool_use` blocks (security)
3. Apply tool input parameter transforms via `MPB()` (redaction)
4. Remove content blocks that reference removed tools
5. Clean `tool_use` blocks to only `{type, id, name, input}` via `Q87()`

Output: clean `{role, content}[]` array ready for the Anthropic API.

### 3. API Call (bc → maB)

`bc()` is the entry point:

```
bc({
  messages: Message[],       // from JC()
  systemPrompt: string[],    // assembled system prompt blocks
  maxThinkingTokens: number, // 0 for non-thinking, budget for thinking
  tools: Tool[],             // tool definitions
  signal: AbortSignal,
  options: {
    model: string,
    getToolPermissionContext: async () => PermissionContext,
    toolChoice: object | void,
    agents: Agent[],
    enablePromptCaching: boolean,
    outputFormat: object,
    fastMode: boolean,
    ...
  }
})
```

Inside `bc()`:
1. `iOA()` wraps for context management (compaction via `j3R()`)
2. `aN8()` / `rN8()` format each message for the API (adding `cache_control` to strategic positions)
3. `maB()` calls the Anthropic streaming API

### 4. Streaming (maB)

`maB()` is an async generator that yields Anthropic streaming events:

```
message_start       → Initialize response object (id, model, usage)
content_block_start → New block: text, tool_use, thinking, server_tool_use
content_block_delta → Incremental content (text chunks, JSON input chunks)
content_block_stop  → Block complete
message_delta       → Final: stop_reason, stop_sequence, usage delta
message_stop        → Response complete
```

The streaming accumulator (`kzT` class at ~11612659) builds the complete message:
- Text deltas concatenated into text blocks
- `input_json_delta` accumulated and parsed into tool_use input objects
- Usage tracked across deltas

The complete assistant message is yielded as:

```
{
  type: "assistant",
  message: { role: "assistant", content: ContentBlock[], stop_reason, usage, ... },
  uuid: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  requestId: string
}
```

### 5. Tool Dispatch (when stop_reason === "tool_use")

For each `tool_use` block in the assistant response:

#### 5a. Pre-Tool Hooks

`LVA()` (executePreToolHooks) fires `PreToolUse`:

```
hookInput: {
  hook_event_name: "PreToolUse",
  tool_name: string,
  tool_input: object,
  tool_use_id: string,
  session_id, transcript_path, cwd, permission_mode
}
```

Hook can return:
- `permissionDecision: "allow" | "deny" | "ask"` — override permission check
- `updatedInput: object` — modify tool input before execution
- `systemMessage: string` — inject context
- `blockingError` — abort with error

#### 5b. Permission Check

1. Check policy-based rules (auto-allow, auto-deny based on permission mode)
2. Check hook-provided permission decisions
3. Prompt user if needed
4. `PermissionRequest` hook fires for observability

#### 5c. Tool Execution

The tool queue (`processQueue` at ~17799172) manages execution:
- **Concurrent tools** (`isConcurrencySafe: true`): run in parallel
- **Sequential tools**: queued, run one at a time
- Each tool's `.call()` method runs with the parsed input
- MCP tools route through MCP client (`callTool` / `callToolStream`)

#### 5d. Result Formatting

Each tool defines `mapToolResultToToolResultBlockParam(result, tool_use_id)`:

```
{
  type: "tool_result",
  tool_use_id: string,
  content: string | ContentBlock[],
  is_error?: boolean
}
```

**Note:** The `content` field can be either a plain string or an array of content blocks (e.g. `[{type: "text", text: "..."}]`). This is per the Anthropic API spec. The Agentobox backend normalizes this to always be a string via `_normalize_parts()` in `stream.py` before DB storage. See `docs/STREAM-JSON-INTEGRATION-SPEC.md`, "Content Parts Format".

Result truncation via `MG7()` if content exceeds `maxResultSizeChars` — large outputs saved to file with preview.

#### 5e. Post-Tool Hooks

`KVA()` (executePostToolHooks) fires `PostToolUse`:

```
hookInput: {
  hook_event_name: "PostToolUse",
  tool_name: string,
  tool_input: object,
  tool_response: object,
  tool_use_id: string,
  session_id, transcript_path, cwd, permission_mode
}
```

On failure, `PostToolUseFailure` fires instead with `error` and `is_interrupt` fields.

#### 5f. Result Assembly

Tool results assembled into a user message via `kR()`:

```
kR({
  content: [
    { type: "tool_result", tool_use_id: "toolu_xxx", content: "..." },
    { type: "tool_result", tool_use_id: "toolu_yyy", content: "..." }
  ],
  toolUseResult: statusObject
})
```

#### 5g. Loop

Go back to step 2 (message preparation) with the new messages appended. This continues until `stop_reason === "end_turn"` or `"stop_sequence"`.

### 6. Turn Complete

When `stop_reason !== "tool_use"`, the turn ends. The final assistant message is yielded to the conversation loop.

---

## Persistence (UoB Class)

All messages are persisted to `.jsonl` transcript files via the `UoB` singleton (accessed through `WW()`).

### Write Path

```
Message created (kR/hoB)
  → Ab() or K7T() called
    → WW().insertMessageChain(messages, isSidechain, agentId, parentUuid, teamInfo)
      → For each message:
        → Add metadata: parentUuid, sessionId, version, gitBranch, agentId, cwd, userType
        → Deduplicate by UUID (skip if already written)
        → Route: subagent messages → agent-{id}.jsonl, main → {sessionId}.jsonl
        → WW().appendEntry(enrichedMessage)
          → enqueueWrite(filepath, entry)
            → scheduleDrain() (100ms batching timer)
              → drainWriteQueue()
                → JSON.stringify(entry) + "\n"
                → appendFile(filepath, chunk)
                → MAX_CHUNK_BYTES = 100MB per batch
```

### File Locations

| File | Path |
|---|---|
| Main session | `~/.claude/projects/{project-hash}/{session-id}.jsonl` |
| Subagent | `~/.claude/projects/{project-hash}/{session-id}/subagents/agent-{id}.jsonl` |
| Command history | `~/.claude/history.jsonl` |

### Transcript Entry Types

The `appendEntry()` method routes by type:

| Entry Type | What It Records |
|---|---|
| `user` | User messages, tool results, synthetic injections |
| `assistant` | Model responses |
| `summary` | Compaction summaries (context window management) |
| `custom-title` | Session title updates |
| `tag` | Session tags |
| `agent-name` | Agent display name |
| `agent-color` | Agent color in UI |
| `agent-setting` | Agent configuration changes |
| `pr-link` | PR URL associations |
| `file-history-snapshot` | File state at a point in time |
| `attribution-snapshot` | Who changed what |
| `speculation-accept` | Speculative execution results |
| `mode` | Permission mode changes |
| `queue-operation` | Queued command operations |

### Enriched Message Format (what's written to .jsonl)

Each line in the `.jsonl` file is a JSON object with the internal message fields plus:

```
{
  parentUuid: string | null,       // previous message in chain
  logicalParentUuid: string,       // for sidechain threading
  isSidechain: boolean,            // subagent messages
  teamName: string,                // agent team namespace
  agentName: string,               // agent display name
  userType: "external",            // always "external" for CLI
  cwd: string,                     // working directory at write time
  sessionId: string,               // session UUID
  version: string,                 // Claude Code version
  gitBranch: string,               // current git branch
  agentId: string,                 // subagent ID if applicable
  slug: string,                    // message category slug
  ...originalMessageFields
}
```

### Remote Persistence

When `remoteIngressUrl` is set (remote sessions), messages are also pushed via `persistToRemote()`. The flush interval shortens to `$U8` (faster batching for remote sync).

---

## Display Layer (Diff Rendering)

The Edit tool's diff display is **separate from what goes to the API**.

### What the API sees (tool_result)

```
"The file {path} has been updated successfully."
```

Or with `replace_all`:

```
"The file {path} has been updated. All occurrences of '{old}' were successfully replaced with '{new}'."
```

### What the user sees (display only)

The display layer calls `K5R()` which generates a unified diff patch:

```
K5R({ filePath, fileContents, oldString, newString, replaceAll })
→ { patch: "--- a/file\n+++ b/file\n@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n context" }
```

This uses a bundled diff library (structuredPatch with `---`/`+++`/`@@` hunk headers). The patch is rendered with color coding in the terminal but never sent to the API.

For new files, the diff is synthesized:

```
@@ -0,0 +1,{lineCount} @@
+line 1
+line 2
...
```

---

## Grouped Tool Use

When the model returns multiple `tool_use` blocks in one response, they're collapsed into a `grouped_tool_use` display message:

```
{
  type: "grouped_tool_use",
  toolName: string,            // common tool name (if all same)
  messages: AssistantMessage[], // individual tool_use messages
  results: UserMessage[],      // corresponding tool_result messages
  displayMessage: AssistantMessage, // first message (used for display header)
  uuid: "grouped-{firstUuid}",
  timestamp: string,
  messageId: string
}
```

This is display-only — the API still sees individual `tool_use` and `tool_result` blocks.

---

## Context Management

### Compaction

When the context window fills up, Claude Code compacts older messages:

1. `PreCompact` hook fires
2. Older messages summarized into a `summary` entry
3. A `system` message with `subtype: "compact_boundary"` marks the boundary
4. Original messages replaced with the summary
5. Summary written to transcript as `type: "summary"`

### Cache Control

Strategic `cache_control: { type: "ephemeral" }` headers placed on:
- Last content block of user messages (via `aN8()`)
- Last non-thinking content block of assistant messages (via `rN8()`)
- System prompt blocks (via `ByA()` — global vs tool-based caching strategies)

---

## Message Flow Diagram

```
User Input
  │
  ▼
kR() ─── create type:"user" message with UUID + timestamp
  │
  ▼
Ab() ─── persist to .jsonl transcript (via WW().insertMessageChain)
  │
  ▼
JC() ─── prepare messages for API (filter, sanitize, transform)
  │
  ▼
bc() ─── assemble API request
  │
  ├── aN8() / rN8() ─── format each message (cache_control)
  ├── Q87() ─── strip extra fields
  └── ByA() ─── system prompt caching
  │
  ▼
maB() ─── stream from Anthropic API
  │
  ├── message_start ──────────────┐
  ├── content_block_start ────────┤
  ├── content_block_delta ────────┤── accumulate into complete message
  ├── content_block_stop ─────────┤
  ├── message_delta ──────────────┤
  └── message_stop ───────────────┘
  │
  ▼
hoB() ─── create type:"assistant" message
  │
  ▼
Ab() ─── persist to .jsonl transcript
  │
  ├── stop_reason === "end_turn" ─── done, yield to conversation loop
  │
  └── stop_reason === "tool_use" ─── continue:
      │
      ▼
      For each tool_use block:
        │
        ├── LVA() ─── PreToolUse hooks
        ├── Permission check
        ├── tool.call() ─── execute
        ├── tool.mapToolResultToToolResultBlockParam() ─── format result
        └── KVA() ─── PostToolUse hooks
        │
        ▼
      kR() ─── create type:"user" message with tool_results
        │
        ▼
      Ab() ─── persist to .jsonl
        │
        ▼
      Loop back to JC() ─── next API call
```

---

## Interception Points for Agentobox

Where the messaging system can plug in to maintain parity:

| Point | What to Observe | How |
|---|---|---|
| **Message creation** | Every `kR()` / `hoB()` call | Hook into transcript writes (`.jsonl` tailing) |
| **Pre-API** | Exact payload going to Anthropic | `PreToolUse` hooks + transcript |
| **Streaming** | Real-time token-by-token output | `maB()` events (need process-level access or transcript tailing) |
| **Tool lifecycle** | Full tool input + output | `PreToolUse` + `PostToolUse` hooks |
| **Persistence** | All messages as they're written | Tail/watch `.jsonl` files |
| **Remote sync** | Messages pushed to remote URL | Set `remoteIngressUrl` on `UoB` (internal, not exposed) |
| **Display** | What the user sees (diffs, grouped tools) | Display-only, not in transcript |
| **Compaction** | When context is summarized | `PreCompact` hook |

The most reliable external observation point is the **`.jsonl` transcript file** — every message passes through `WW().insertMessageChain()` before anything else happens. Combined with hooks (`PostToolUse`, `SessionStart`, `TaskCompleted`, etc.), this gives full lifecycle coverage.

---

## Display & Rendering Layer

The display layer transforms raw streaming events and internal messages into what the user sees in the terminal. It operates independently from the API/persistence layer — display state is computed from streaming events, not from stored messages.

### Display Phases

The UI has 5 phase states that drive what's rendered:

| Phase | Meaning | Triggered By |
|---|---|---|
| `"requesting"` | API call initiated, waiting for response | `stream_request_start` event |
| `"thinking"` | Model is producing thinking/reasoning | `content_block_start` with `type:"thinking"` or `"redacted_thinking"` |
| `"responding"` | Model is producing text output | `content_block_start` with `type:"text"`, or `message_delta`, or default |
| `"tool-input"` | Model is streaming tool call JSON | `content_block_start` with `type:"tool_use"`, `"server_tool_use"`, `"mcp_tool_use"`, etc. |
| `"tool-use"` | Response complete, tools executing | `message_stop` event |

### Stream Event → Display State (qhT)

`qhT()` at ~19077001 is the central dispatcher that maps streaming events to display state changes:

```
qhT(event, addMessage, appendDelta, setPhase, setStreamingToolUse, removeTombstone, setThinking)
```

**Non-stream events (bypass phase logic):**
- `type:"tombstone"` → remove message via `removeTombstone`
- `type:"tool_use_summary"` → ignored
- `type:"assistant"` → add to message list; extract thinking block if present

**Stream events:**

```
stream_request_start
  → setPhase("requesting")

message_stop
  → setPhase("tool-use"), clear streaming tool use array

content_block_start:
  thinking / redacted_thinking → setPhase("thinking")
  text                        → setPhase("responding")
  tool_use                    → setPhase("tool-input"), add to streaming tool array
  server_tool_use             → setPhase("tool-input")
  web_search_tool_result      → setPhase("tool-input")
  code_execution_tool_result  → setPhase("tool-input")
  mcp_tool_use / mcp_tool_result → setPhase("tool-input")
  container_upload            → setPhase("tool-input")
  web_fetch_tool_result       → setPhase("tool-input")
  bash/text_editor_code_execution_tool_result → setPhase("tool-input")

content_block_delta:
  text_delta      → appendDelta(text)
  input_json_delta → appendDelta(json), accumulate in streaming tool input
  thinking_delta  → appendDelta(thinking)
  signature_delta → appendDelta(signature)

content_block_stop → no-op
message_delta      → setPhase("responding")
```

The streaming tool use array tracks in-flight tool calls as `{index, contentBlock, unparsedToolInput}`. JSON input is accumulated character by character via `input_json_delta` events.

### Tool Render Interface

Every tool implements 5 render methods that fire at different points in the tool lifecycle:

| Method | When | What it Shows |
|---|---|---|
| `renderToolUseMessage` | Tool call received from model | Tool name, input parameters, "running" indicator |
| `renderToolUseProgressMessage` | Tool executing, progress updates | Streaming output, progress bars, partial results |
| `renderToolUseRejectedMessage` | Permission denied by user or hook | Rejected tool call with reason |
| `renderToolUseErrorMessage` | Tool execution failed | Error details |
| `renderToolResultMessage` | Tool completed successfully | Result content (diffs, file contents, search results) |

Example from TodoWrite tool: `renderToolUseMessage:to9, renderToolUseProgressMessage:eo9, renderToolUseRejectedMessage:Ts9, renderToolUseErrorMessage:Rs9, renderToolResultMessage:As9`

### Tool Display State Tracking (Lookups)

The `lookups` state object tracks each tool call's lifecycle for rendering:

```
{
  inProgressToolUseIDs: Set<string>,      // currently executing
  resolvedToolUseIDs: Set<string>,        // completed successfully
  erroredToolUseIDs: Set<string>,         // failed
  progressMessagesForMessage: Map,        // progress updates by tool_use_id
  toolResultByToolUseID: Map              // results by tool_use_id
}
```

The `Qa_` component (~15424271) uses these lookups to determine which render method to call:
- If `inProgressToolUseIDs.has(id)` → show progress
- If `resolvedToolUseIDs.has(id)` → show result
- If neither and not resolved → show rejected/error

### Display Message List Builder (UM_)

`UM_()` at ~14052102 transforms the raw message array into display-ready units. It collapses sequential read/search operations into summary entries.

**Grouping logic:**

```
For each message:
  kK7(msg) → Is this a collapsible read/search/memory tool call?
    Yes → Add to current collapsed group, track tool IDs, counts
  MK7(msg, toolIds) → Is this a tool_result for a grouped tool call?
    Yes → Add to current group
  bK7(msg) → Is this a continuation text message?
    Yes → Queue after current group
  PK7(msg) → Is this an assistant message with text content?
    Yes → Flush group, add as standalone
  yK7(msg) → Is this a non-collapsible tool call?
    Yes → Flush group, add as standalone
  Default → Flush group, add as standalone
```

**Output types:**

1. **`collapsed_read_search`** — Groups of read/search/memory operations collapsed into a summary:
   ```
   {
     type: "collapsed_read_search",
     searchCount: number,        // grep/glob calls
     readCount: number,          // file reads
     replCount: number,          // REPL operations
     memorySearchCount: number,  // memory search calls
     memoryReadCount: number,    // memory read calls
     memoryWriteCount: number,   // memory write calls
     messages: Message[],        // underlying messages
     toolUseIds: Set<string>     // tool IDs in this group
   }
   ```
   Displayed as e.g. "Recalled 2 memories", "Read 5 files", "Searched 3 patterns"

2. **`grouped_tool_use`** — Multiple parallel tool calls in one visual unit:
   ```
   {
     type: "grouped_tool_use",
     toolName: string,
     messages: AssistantMessage[],
     results: UserMessage[],
     displayMessage: AssistantMessage,  // first message (for header)
     uuid: "grouped-{firstUuid}"
   }
   ```

3. **Standalone messages** — Regular text, non-collapsible tool calls

### Input Queue System

Users can type messages while Claude is processing. These are queued and merged when the next prompt is sent.

**Queue entry format:**
```
{
  mode: "prompt" | "task-notification" | "execute-command",
  value: string | object
}
```

**Key functions:**

| Function | Role | Offset |
|---|---|---|
| `UG()` | Enqueue a command. Task notifications go to separate buffer if workers active | ~14036365 |
| `F5R()` | Dequeue single command from front of queue | ~14036498 |
| `f5R()` | Merge all editable queued commands into a single prompt with images | ~14037399 |

**Queue merge (f5R) process:**
1. Split queue into editable (user prompts) and nonEditable (task-notifications)
2. Extract text from each editable command via `LK7()`
3. Concatenate all texts + current user input
4. Extract images from queued commands via `KK7()`
5. Return `{text, cursorOffset, images}`
6. Non-editable items stay in queue

**Editability:** `EK7 = Set(["task-notification"])` — task notifications are non-editable. All other modes (prompt, execute-command) are editable, meaning the user can hit up-arrow to recall them into the text box.

### Image Paste Handling

**`X5T()`** at ~13219410 reads images from the clipboard:
1. Check if clipboard has image data (`checkImage` shell command)
2. Save clipboard image to temp file (`saveImage`)
3. Read file bytes, encode to base64, detect media type
4. Return `{base64, mediaType, dimensions}`

Images are tracked per message via `imagePasteIds` on user messages. During queue merge (`f5R`), images from queued commands are extracted and sent alongside text.

### History Navigation

Key bindings in the main chat context:
- `up` → `history:previous` — recall previous message into input
- `down` → `history:next` — navigate forward through history
- `ctrl+_` / `ctrl+shift+-` → `chat:undo`
- `ctrl+g` → `chat:externalEditor`
- `ctrl+s` → `chat:stash`

### Display Lifecycle Summary

```
User types text / pastes image
  │
  ├── If Claude is processing: queue via UG()
  │     └── User hits up-arrow → recall from queue back to input
  │
  └── If Claude is idle: submit prompt
        │
        ▼
      f5R() merges queued commands + current input + images
        │
        ▼
      API call starts → qhT receives stream_request_start
        │                  → phase: "requesting"
        ▼
      content_block_start arrives
        │
        ├── thinking → phase: "thinking", render thinking indicator
        ├── text → phase: "responding", render streaming text
        └── tool_use → phase: "tool-input", render tool input streaming
              │
              ├── input_json_delta → accumulate tool JSON
              └── content_block_stop → tool input complete
        │
        ▼
      message_stop → phase: "tool-use"
        │
        ▼
      Tool execution begins
        │
        ├── renderToolUseMessage → show "running" state
        ├── renderToolUseProgressMessage → show streaming progress
        │
        ├── Success → renderToolResultMessage (diffs, results)
        ├── Denied → renderToolUseRejectedMessage
        └── Error → renderToolUseErrorMessage
        │
        ▼
      UM_() groups messages for display:
        ├── Sequential reads/searches → collapsed_read_search summary
        ├── Parallel tool calls → grouped_tool_use
        └── Text + standalone tools → individual messages
        │
        ▼
      Next API call or turn complete
```
