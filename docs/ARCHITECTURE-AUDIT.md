# Architecture Audit: Stream-JSON Simplification

What can be removed, simplified, or unified now that stream-json gives us the full messaging flow for free.

---

## Executive Summary

The current architecture uses **hooks + tmux + transcript parsing** as three separate, brittle mechanisms to capture agent activity. Stream-json replaces all three with a single stdout pipe. This eliminates ~400 lines of backend plumbing, simplifies the data model, and gives us cost/usage metrics we don't have today.

---

## 1. What's Overengineered

### 1.1 Hook Event System (REMOVE)

**Files affected:**
- `backend/agents/services/provision.py` lines 148-180 — `_HOOK_EVENT_SH`, `_HOOK_EVENTS`, `_HOOK_CMD`
- `backend/agents/services/provision.py` lines 299-307 — `_build_settings_json()` hook config
- `backend/agents/services/provision.py` lines 71-87 — hook script + env file provisioning
- `backend/agents/views.py` lines 11-24 — `/hooks/event` endpoint
- `backend/agents/urls.py` — hook route
- `backend/agents/services/lifecycle.py` lines 202-317 — `process_hook_event()` (115 lines)

**Why it exists:** Hooks are Claude Code's callback mechanism. Each hook event triggers a shell script that curls the backend. This was the only way to get structured events out of a running agent.

**Why it's overengineered:**
- Requires provisioning a shell script, env file, and curl into every container
- Each event = subprocess spawn + jq parse + HTTP POST + Django view + async handler
- Fragile chain: if any step fails silently, events are lost with no retry
- The backend must be HTTP-reachable from every container (network config, CORS, firewall)
- Hook events are a subset of what stream-json provides (no token usage, no cost, no tool input/output)

**Stream-json replacement:** Every hook event type (`SessionStart`, `Stop`, `PostToolUse`, etc.) is already in the stream-json output with MORE data. The `system/init` event replaces `SessionStart`. The `result` event replaces `Stop` + `SessionEnd` + cost data. Tool calls come with full input AND output, not just the tool name.

### 1.2 Transcript JSONL Parsing (REMOVE)

**Files affected:**
- `backend/agents/services/lifecycle.py` lines 320-367 — `_extract_last_response()` (47 lines)
- `backend/agents/models.py` line 36 — `transcript_path` field on Agent model

**Why it exists:** To capture agent responses. On `Stop` events, the backend shells into the container, tails the last 80 lines of the transcript JSONL, walks backwards parsing JSON, and extracts text blocks.

**Why it's overengineered:**
- Remote exec into container to read a file = fragile and slow
- Parsing JSONL backwards with error swallowing = data loss when format changes
- `tail -80` is an arbitrary guess — long responses get truncated
- Only captures the LAST response per turn, misses intermediate text
- Race condition: transcript may not be flushed when Stop fires

**Stream-json replacement:** Every `assistant` event contains the full `message.content` array as it's generated. No file access needed, no parsing, no guessing at line counts.

### 1.3 Tmux Message Delivery (SIMPLIFY)

**Files affected:**
- `backend/agents/services/comms.py` lines 17-76 — `send_message()` (59 lines)
- `backend/agents/services/comms.py` lines 79-110 — `interrupt_agent()`

**Why it exists:** Claude Code runs in a tmux session. To send input, the backend execs `tmux send-keys` into the container.

**Why it's overengineered:**
- Multiline workaround: writes to `/tmp/.abox-msg`, sends "read this file" instruction
- Bracketed paste mode causes Claude Code to show `[Pasted text +N lines]` without submitting
- Two exec calls per message (send-keys + Enter), three for multiline
- No delivery confirmation — fire-and-forget
- Interrupt via `C-c` is imprecise

**Stream-json replacement:** With `--input-format stream-json`, write structured JSON to stdin:
```json
{"type": "user", "content": "Fix the bug in auth.js"}
```
No tmux, no file workaround, no bracketed paste. Delivery is synchronous via stdin pipe. Multiline just works. To interrupt, send `SIGINT` to the process.

### 1.4 AgentEvent Model (RESHAPE)

**Files affected:**
- `backend/agents/models.py` lines 57-67 — `AgentEvent` model
- `backend/agents/services/broadcast.py` lines 34-63 — `broadcast_agent_event()`
- `backend/agents/graphql/types.py` — `AgentEventType`, `AgentEventSubType`
- `backend/agents/graphql/queries.py` lines 29-36 — events query
- `backend/agents/graphql/subscriptions.py` lines 38-65 — `new_event` subscription
- `dashboard/stores/events.ts` — events store (max 100 per project)
- `dashboard/components/event-feed.tsx` — event rendering

**Current shape:**
```python
AgentEvent(agent, event_type: str, data: JSONField)
```
This is a grab-bag. `event_type` is an untyped string. `data` is arbitrary JSON. The frontend has to case-match on `event_type` and hope `data` has the right fields. No schema validation.

**Why it's overengineered:**
- Stores raw hook payloads as opaque JSON — no queryability
- `data` blob contains everything from tool names to message content to session IDs
- Frontend duplicates parsing logic (event-feed.tsx, command-panel.tsx, agent-card.tsx all parse differently)
- 100-event cap in frontend store means history is lost
- No cost, no tokens, no tool duration — the useful metrics aren't captured

**Stream-json replacement:** Replace with typed event storage that mirrors the stream-json taxonomy:

| Stream event | Maps to |
|---|---|
| `system/init` | Agent capabilities (tools, model, MCP servers) |
| `assistant` (text) | Message with role=assistant |
| `assistant` (tool_use) | ToolCall with name, input |
| `user` (tool_result) | ToolResult with output, error flag |
| `result` | SessionMetrics with cost, tokens, duration |

Each type has a known schema. No more opaque JSON blobs.

### 1.5 AgentMessage Model (RESHAPE)

**Files affected:**
- `backend/agents/models.py` lines 70-82 — `AgentMessage` model
- `backend/agents/graphql/types.py` lines 9-14 — `AgentMessageType`
- `dashboard/components/command-panel.tsx` lines 948-985 — message deduplication

**Current shape:**
```python
AgentMessage(agent, direction: 'inbound'|'outbound', content: TextField)
```

**Why it's overengineered:**
- `content` is a flat text field — can't distinguish text from tool calls from thinking
- `direction` is a custom concept — stream-json uses `role` (assistant/user) which maps cleanly
- Message deduplication in frontend: events create messages, queries fetch messages, subscription pushes messages — three paths that overlap and require `direction:content` dedup
- No message ID correlation — can't link a tool call to its result
- No token usage per message

**Stream-json replacement:** Messages become first-class objects with `message.id` (stable across updates), `message.content[]` (typed parts array), and `message.usage` (tokens per turn). The `parent_tool_use_id` field links subagent messages to their parent tool call. No dedup needed — each message has a unique ID from Claude.

---

## 2. What's Brittle

### 2.1 Status State Machine

**Current:** Status transitions are scattered across `lifecycle.py`:
```python
_STATUS_MAP = {
    "SessionStart": RUNNING,
    "Stop": IDLE,
    "SessionEnd": STOPPED,
    "ProcessExit": STOPPED,
}
```
Plus `comms.py` line 65-68 sets RUNNING on message send. Plus `comms.py` line 101-103 sets IDLE on interrupt.

**Problem:** Multiple writers, no single source of truth. If a hook event is lost (network issue, container crash), the status goes stale. The dashboard shows RUNNING when the agent is actually idle.

**Fix with stream-json:** The process IS the agent. Process running = agent running. Process exited = agent stopped. The `result` event is the definitive end signal. Between `assistant` events, the agent is working. Between `result` and next prompt, it's idle. Status is derived from process state, not from hook callbacks.

### 2.2 SendMessage Capture

**Current** (`lifecycle.py` lines 252-282): PostToolUse hook fires → check if `tool_name == "SendMessage"` → extract content → skip internal protocol messages → create AgentMessage on sender → find recipient by name in same project → create AgentMessage on recipient → broadcast.

**Problems:**
- Only captures messages AFTER the tool executes (PostToolUse), not before
- Recipient lookup by name is fragile (what if two agents have the same name?)
- Internal message filtering (`shutdown_request`, `shutdown_response`) is hardcoded
- The hook payload doesn't include the SendMessage response — only the input

**Fix with stream-json:** The `assistant` event with `tool_use` content for SendMessage gives you the full input (recipient, content). The subsequent `user` event with `tool_result` gives you the response. Both are correlated by `tool_use_id`. No name-based lookup needed.

### 2.3 Container Network Dependency

**Current:** Every container needs HTTP access back to the Django backend (`ABOX_CALLBACK_URL`). This means:
- Docker: containers must be on the same Docker network
- Modal: encrypted ports and public URLs needed
- Firewall/proxy configuration per deployment

**Fix with stream-json:** If you spawn claude as a subprocess (not in a remote container), stdout parsing is local. For remote containers, you'd still need a communication channel, but it could be a simple stdout pipe over SSH/exec rather than a full HTTP API.

### 2.4 Frontend Message Deduplication

**Current** (`command-panel.tsx` lines 948-985):
- ChatView watches events store for `inbound_message` / `outbound_message`
- Also fetches messages via `AGENT_MESSAGES_QUERY`
- Deduplicates by `direction:content` string key
- Three data sources for the same concept

**Fix with stream-json:** One WebSocket stream per agent carries all events. Messages are identified by `message.id` from Claude. Dedup is trivial — if you've seen the ID, skip it.

---

## 3. What Stays

### 3.1 Agent Model (core fields)

Keep: `id`, `name`, `project`, `runtime`, `sandbox_id`, `vnc_url`, `status`, `model`, `cwd`, `workspace_path`, `instructions`, `mcp_servers`, `created_at`

Remove: `transcript_path` (no longer reading transcript files), `permission_mode` (always bypassPermissions), `team_name` / `parent_session_id` / `session_id` (derived from project, captured from stream events)

### 3.2 Agent Lifecycle (create/kill)

Keep: `create_agent()`, `_provision_agent()`, `kill_agent()` — container management is still needed.

Change: Instead of launching claude in tmux with hook scripts, launch with `--output-format stream-json --verbose` and pipe stdout to the event parser. Remove tmux entirely.

### 3.3 Runtime Abstraction

Keep: Modal and Docker runtimes — container orchestration is still needed.

Change: Instead of `runtime.exec(tmux send-keys ...)`, write to subprocess stdin. Instead of `runtime.exec(tail transcript)`, read subprocess stdout.

### 3.4 Broadcast System

Keep: `broadcast_agent_update()` — still need to push agent status to dashboard.

Change: `broadcast_agent_event()` publishes typed events instead of opaque JSON blobs.

### 3.5 GraphQL Subscriptions

Keep: WebSocket subscription pattern for real-time dashboard updates.

Change: Subscription payload becomes typed stream-json events instead of raw hook data.

### 3.6 Frontend Stores & Components

Keep: Zustand stores, URQL client, component structure.

Change: Types mirror stream-json event schema. No custom parsing/dedup logic.

### 3.7 AgentFeedback Model

Keep as-is — user ratings are orthogonal to the messaging pipeline.

---

## 4. New Unified Data Model

### Backend Models

```python
# Replace AgentEvent + AgentMessage with:

class StreamEvent(models.Model):
    """Raw stream-json event from an agent subprocess."""
    agent = models.ForeignKey(Agent, CASCADE)
    event_type = models.CharField(max_length=20)  # system, assistant, user, result
    subtype = models.CharField(max_length=30, blank=True)  # init, hook_started, etc.
    message_id = models.CharField(max_length=50, blank=True)  # Claude's message.id
    tool_use_id = models.CharField(max_length=50, blank=True)  # for tool correlation
    parent_tool_use_id = models.CharField(max_length=50, blank=True)  # subagent link
    data = models.JSONField()  # full event payload
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["agent", "event_type"]),
            models.Index(fields=["message_id"]),
            models.Index(fields=["tool_use_id"]),
        ]

class SessionResult(models.Model):
    """Per-session cost and usage summary from result events."""
    agent = models.ForeignKey(Agent, CASCADE)
    session_id = models.CharField(max_length=100)
    total_cost_usd = models.DecimalField(max_digits=10, decimal_places=6)
    duration_ms = models.IntegerField()
    duration_api_ms = models.IntegerField()
    num_turns = models.IntegerField()
    model_usage = models.JSONField()  # per-model breakdown
    created_at = models.DateTimeField(auto_now_add=True)
```

### Frontend Types

```typescript
// Replace AgentEvent + AgentMessage with:

interface StreamEvent {
  id: number;
  agentId: string;
  eventType: 'system' | 'assistant' | 'user' | 'result';
  subtype?: string;
  messageId?: string;
  toolUseId?: string;
  parentToolUseId?: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface SessionResult {
  agentId: string;
  sessionId: string;
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
}
```

---

## 5. What Gets Removed (Line Count)

| Component | File | Lines | Action |
|-----------|------|-------|--------|
| Hook shell script | provision.py:148-173 | 25 | DELETE |
| Hook event list + cmd | provision.py:175-180 | 5 | DELETE |
| Hook settings builder | provision.py:299-307 | 9 | DELETE |
| Hook script provisioning | provision.py:71-87 | 16 | DELETE |
| Hook HTTP endpoint | views.py:11-24 | 13 | DELETE |
| Hook URL route | urls.py | 1 | DELETE |
| process_hook_event() | lifecycle.py:202-317 | 115 | DELETE |
| _extract_last_response() | lifecycle.py:320-367 | 47 | DELETE |
| Tmux send_message() | comms.py:17-76 | 59 | REWRITE (stdin pipe) |
| Tmux interrupt_agent() | comms.py:79-110 | 31 | REWRITE (SIGINT) |
| Tmux attach_mcp() | comms.py:113-150 | 37 | REWRITE (stdin JSON) |
| AgentMessage model | models.py:70-82 | 12 | REMOVE (replaced by StreamEvent) |
| AgentEvent model | models.py:57-67 | 10 | REMOVE (replaced by StreamEvent) |
| Tmux launch wrapper | lifecycle.py:130-143 | 13 | REWRITE (subprocess) |
| Frontend msg dedup | command-panel.tsx:948-985 | 37 | REMOVE |
| **Total removed/rewritten** | | **~450 lines** | |

---

## 6. What Gets Added

| Component | Purpose | Est. Lines |
|-----------|---------|------------|
| StreamEventParser | Parse stdout JSON lines, emit typed events | ~60 |
| AgentSubprocess | Spawn claude with stream-json, manage stdin/stdout | ~80 |
| StreamEvent model | Typed event storage with indexes | ~25 |
| SessionResult model | Cost/usage per session | ~15 |
| Updated broadcast | Publish typed events instead of raw JSON | ~20 |
| Frontend StreamEvent type | Typed event interface | ~15 |
| Frontend SessionResult type | Cost display type | ~10 |
| **Total added** | | **~225 lines** |

**Net: ~225 fewer lines, plus typed events, cost tracking, and no brittle plumbing.**

---

## 7. Migration Path

### Phase 1: Subprocess + Parser (replaces hooks)
- Add `--output-format stream-json --verbose` to claude launch command
- Parse stdout in-process instead of waiting for HTTP callbacks
- Remove hook script provisioning, `/hooks/event` endpoint
- Keep existing models temporarily, populate from stream events

### Phase 2: New Data Model (replaces AgentEvent + AgentMessage)
- Add StreamEvent and SessionResult models
- Migrate GraphQL types and subscriptions
- Update frontend stores and types
- Remove AgentEvent and AgentMessage

### Phase 3: Stdin Input (replaces tmux)
- Switch to `--input-format stream-json` for message delivery
- Remove tmux launch wrapper
- Rewrite send_message() as stdin pipe write
- Rewrite interrupt as SIGINT

### Phase 4: Cost Dashboard
- Add cost display per agent, per project, per model
- Cache efficiency metrics (cache_read vs cache_creation)
- Token usage trends over time

---

## 8. Risk Assessment

| Risk | Mitigation |
|------|------------|
| stream-json format changes on Claude Code upgrade | Pin version, test on upgrade. Format follows Anthropic API conventions — unlikely to break. |
| Remote containers can't use subprocess stdout | For Modal/Docker, exec the claude process and stream its stdout back. Or run a thin relay inside the container that forwards stdout over WebSocket. |
| `--input-format stream-json` schema undocumented | Test with `{"type": "user", "content": "..."}` first. Fall back to text stdin if needed. |
| Migration breaks existing agents | Phase 1 is additive — keep hooks as fallback during transition. |

---

## 9. Key Insight

The current architecture treats Claude Code as a black box inside a container, using hooks (HTTP callbacks), tmux (terminal emulation), and transcript files (log scraping) to observe it from the outside. This is three separate plumbing systems, each with its own failure modes.

Stream-json treats Claude Code as a structured subprocess. One pipe in (stdin), one pipe out (stdout), fully typed JSON on both sides. The process IS the interface. No callbacks, no terminal hacks, no file parsing.

The simplification isn't just fewer lines — it's fewer failure modes, fewer network dependencies, and data (cost, tokens, cache metrics) that was previously impossible to capture.
