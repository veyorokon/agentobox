# Stream-JSON Integration Spec

Validated approach for capturing Claude Code's full messaging flow via `--output-format stream-json`. Replaces the current hooks + tmux + transcript parsing system with a single structured event pipe.

Tested against Claude Code **v2.1.37**. All claims in this doc are verified by live tests.

---

## Architecture

An in-container relay process spawns Claude with stream-json flags, reads stdout, and forwards typed events to the Agentobox backend. The backend normalizes events into a `Message` model (mirroring Claude Code's own message structure), persists them, and broadcasts to the dashboard via GraphQL subscriptions.

```
Container                                    Backend (Django)
┌──────────────────────────────────┐        ┌──────────────────────────┐
│ abox-relay (~150 lines Python)   │        │                          │
│   │                              │        │                          │
│   ├── spawns:                    │        │                          │
│   │   claude -p                  │        │                          │
│   │     --output-format stream-json       │                          │
│   │     --input-format stream-json        │                          │
│   │     --verbose                │        │                          │
│   │     --dangerously-skip-perms │        │                          │
│   │     --agent-id name@team     │        │                          │
│   │     --team-name <team>       │        │                          │
│   │     --parent-session-id <id> │        │                          │
│   │     --agent-type general-purpose      │                          │
│   │     --model claude-opus-4-6  │        │                          │
│   │                              │        │                          │
│   ├── stdout reader:             │        │                          │
│   │   line → JSON parse          │        │                          │
│   │   batch 50-100ms             │        │                          │
│   │     → POST /agents/stream ──────────→ │ process_stream_events()  │
│   │       ← response includes    │        │   → upsert Message      │
│   │         pending_input (if any)│        │   → upsert SessionResult│
│   │     → write pending to stdin │        │   → broadcast via WS     │
│   │                              │        │                          │
│   ├── stderr reader:             │        │                          │
│   │   capture + forward errors   │        │                          │
│   │                              │        │                          │
│   ├── GET /health                │        │                          │
│   │   → {relay: ok, pid, alive}  │        │                          │
│   │                              │        │                          │
│   └── optional: tmux log session │        │                          │
│       (pipes events for VNC)     │        │                          │
└──────────────────────────────────┘        └──────────────────────────┘
                                                       │
                                                       ▼
                                            ┌──────────────────────┐
                                            │ GraphQL Subscriptions│
                                            │   → WebSocket        │
                                            │   → Dashboard        │
                                            └──────────────────────┘
```

### Why a Relay (Not Direct Subprocess)

Claude runs inside Docker/Modal containers. The Django backend cannot hold a direct stdout pipe to a process in a remote container — `container.exec_run()` is completion-oriented, not streaming. The relay solves this by keeping subprocess management local to the container and using HTTP to bridge to the backend.

Benefits over direct piping:
- **Backend restart resilient** — relay runs independently. If Django restarts, it misses events during downtime but reconnects on the next POST. Relay can optionally buffer and replay.
- **No new Runtime protocol methods** — backend still uses `runtime.exec()` to communicate. Just `curl` to the relay instead of `tmux send-keys`.
- **Works identically for Docker and Modal** — relay is a container-side concern, runtimes don't change.
- **VNC visibility** — relay can pipe stream events to a read-only tmux session so users still see activity in VNC.

### Message Delivery: Piggyback Pattern

Instead of the relay running its own HTTP listener, the backend piggybacks pending input in POST responses:

```
Relay POSTs events  →  Backend responds with:
                        {"ack": true, "pending_input": null}
                        — or —
                        {"ack": true, "pending_input": {"type": "user", "message": {...}}}
```

The relay writes any `pending_input` to Claude's stdin. This eliminates the relay's `:9999` listener — the relay is push-only, and `send_message()` just enqueues input in the DB for the next POST cycle.

**Limitation:** If Claude is idle (no events to POST), there's no response to piggyback on. The relay sends periodic heartbeats (every 2s when idle) to poll for pending input.

For interrupts, the backend sets a `pending_signal: "SIGINT"` flag on the agent record. The relay checks this on each heartbeat and sends SIGINT to Claude if set.

---

## Validated Behavior

All tested on Claude Code v2.1.37.

### Single Prompt + Team Flags

```bash
echo "What is 2+2?" | claude -p \
  --output-format stream-json \
  --verbose \
  --agent-id tester@test-team \
  --agent-name tester \
  --team-name test-team \
  --parent-session-id 00000000-0000-0000-0000-000000000001 \
  --agent-type general-purpose \
  --dangerously-skip-permissions
```

Result: Works. Full event stream emitted.

### Multi-Turn via stream-json Stdin

```bash
{
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"What is 2+2?"}]}}'
  sleep 8
  echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Multiply that by 3."}]}}'
  sleep 8
} | claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --agent-id tester@test-team \
  --agent-name tester \
  --team-name test-team \
  --parent-session-id 00000000-0000-0000-0000-000000000001 \
  --agent-type general-purpose \
  --dangerously-skip-permissions
```

Result: Works. Turn 1 returns `4`, turn 2 returns `12`. Same `session_id` across turns. Context maintained.

### Tool Calls in Multi-Turn

Tested with Bash and Read tools across two turns. Full tool lifecycle emitted: `assistant` (tool_use) → `user` (tool_result) → `assistant` (text). Error cases (`is_error: true`) work correctly.

### Key Findings

| Behavior | Observed |
|---|---|
| `result` event fires per-turn, not per-session | Running cost available after every turn |
| `system/init` fires on each new turn in multi-turn | Dedup by session_id on frontend |
| `modelUsage` in `result` accumulates across turns | Total session cost always current |
| Cache reads increase across turns | `cache_read_input_tokens` grows as context reuses |
| Same `session_id` across all turns | Session continuity confirmed |

---

## Input Format

With `--input-format stream-json`, stdin accepts Anthropic API message format:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {"type": "text", "text": "Your prompt here"}
    ]
  }
}
```

Each JSON object must be a single line followed by a newline. The `message.content` array supports the same content block types as the Anthropic API (text, image, etc.).

**Important:** The simple format `{"type":"user","content":"..."}` does NOT work — it causes `TypeError: undefined is not an object (evaluating 'R.message.role')`. The full `message.role` + `message.content[]` structure is required.

---

## Output Event Stream

Each line of stdout is a self-contained JSON object. Every event includes `session_id` and `uuid`.

### 1. `system/init`

Emitted at session start AND at the beginning of each new turn in multi-turn mode.

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/path/to/project",
  "session_id": "681dfa0c-...",
  "tools": ["Task", "Bash", "Edit", "Read", "Write", "Glob", "Grep", ...],
  "mcp_servers": [
    {"name": "tavily", "status": "connected"},
    {"name": "context7", "status": "connected"}
  ],
  "model": "claude-sonnet-4-5-20250929",
  "permissionMode": "bypassPermissions",
  "agents": ["Bash", "general-purpose", "Explore", "Plan", "claude-code-guide"],
  "skills": ["react-best-practices", "zustand-state-management"],
  "claude_code_version": "2.1.37",
  "apiKeySource": "ANTHROPIC_API_KEY"
}
```

Use: Populate agent capabilities panel (tools, MCP servers, model). Dedup by `session_id` — only process the first one per session.

### 2. `system/hook_started` and `system/hook_response`

Hook lifecycle events. Emitted if the agent has hooks configured.

```json
{"type": "system", "subtype": "hook_started", "hook_id": "...", "hook_name": "SessionStart:startup", ...}
{"type": "system", "subtype": "hook_response", "hook_id": "...", "exit_code": 0, "outcome": "success", ...}
```

Use: Optional observability. Can be ignored if relay handles all event forwarding.

### 3. `system/process_exit` (synthetic, emitted by relay)

Emitted by the relay when the Claude process exits. Not part of Claude's output — the relay creates this.

```json
{
  "type": "system",
  "subtype": "process_exit",
  "exit_code": 0,
  "stderr": "",
  "session_id": "...",
  "agent_id": "..."
}
```

Use: Detect clean exit vs crash. `exit_code != 0` or non-empty `stderr` indicates a problem.

### 4. `assistant` (text content)

Model-generated text.

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_01Mhp...",
    "role": "assistant",
    "content": [
      {"type": "text", "text": "I'll list the top-level files."}
    ],
    "stop_reason": null,
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 13637,
      "cache_read_input_tokens": 13860,
      "output_tokens": 5
    }
  },
  "parent_tool_use_id": null,
  "session_id": "..."
}
```

Key fields:
- `message.id` — stable across incremental updates to the same message. Use as dedup key.
- `message.usage` — per-turn token counts with cache breakdown.
- `parent_tool_use_id` — non-null when this is a subagent response.

### 5. `assistant` (tool_use content)

Model requesting a tool call. Same `type: "assistant"`, content part is `tool_use`.

```json
{
  "type": "assistant",
  "message": {
    "id": "msg_01Mhp...",
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01Vz4...",
        "name": "Bash",
        "input": {
          "command": "ls /path",
          "description": "List files"
        }
      }
    ]
  }
}
```

Use: Show tool call in-progress with name and parameters.

### 6. `user` (tool_result)

Tool execution result. Role is `user` because tool results are user-turn messages in the Anthropic API.

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01Vz4...",
        "type": "tool_result",
        "content": "file1.txt\nfile2.txt\n...",
        "is_error": false
      }
    ]
  },
  "tool_use_result": {
    "stdout": "file1.txt\nfile2.txt\n...",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  }
}
```

Key fields:
- `tool_use_id` — correlates to the `tool_use` event's `id`.
- `content` — tool output. The Anthropic API allows this to be either a `string` or an array of content blocks (`ContentBlock[]`). The backend's `_normalize_parts()` function normalizes it to always be a string before DB storage, so downstream consumers (frontend, `extractMessageItems`) can trust the shape.
- `is_error` — whether the tool failed.
- `tool_use_result.interrupted` — whether tool was canceled.

### 7. `result`

Turn summary. Fires after EACH turn completes, not just at session end.

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 6664,
  "duration_api_ms": 6173,
  "num_turns": 2,
  "result": "The final text output...",
  "total_cost_usd": 0.1128,
  "usage": {
    "input_tokens": 7,
    "cache_creation_input_tokens": 13792,
    "cache_read_input_tokens": 41357,
    "output_tokens": 216,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    }
  },
  "modelUsage": {
    "claude-sonnet-4-5-20250929": {
      "inputTokens": 7,
      "outputTokens": 216,
      "cacheReadInputTokens": 41357,
      "cacheCreationInputTokens": 13792,
      "costUSD": 0.1123,
      "contextWindow": 200000,
      "maxOutputTokens": 64000
    }
  },
  "session_id": "...",
  "permission_denials": []
}
```

Key fields:
- `total_cost_usd` — cumulative session cost (accumulates across turns).
- `modelUsage` — per-model cost/token breakdown.
- `duration_ms` vs `duration_api_ms` — difference = tool execution time.
- `num_turns` — conversation depth so far.
- `permission_denials` — blocked tool attempts.

---

## Event Correlation

### Message Threading

Events within a single assistant turn share `message.id`. **Each event carries exactly 1 content part** — parts arrive incrementally, not accumulated. Verified by testing:

```
assistant {message.id: "msg_A", content: [{type: "text"}]}                    ← text (1 part)
assistant {message.id: "msg_A", content: [{type: "tool_use", name: "Read"}]}  ← tool call (1 part)
assistant {message.id: "msg_A", content: [{type: "tool_use", name: "Bash"}]}  ← parallel tool call (1 part)
user      {uuid: "u1", content: [{tool_use_id: "toolu_X", type: "tool_result"}]}  ← result (1 part)
user      {uuid: "u2", content: [{tool_use_id: "toolu_Y", type: "tool_result"}]}  ← result (1 part)
assistant {message.id: "msg_B", content: [{type: "text"}]}                    ← next turn (1 part)
```

**Critical:** Because parts arrive one at a time, the backend must APPEND parts to the Message, not replace. See "Event Processing Logic" for the correct pattern (modeled after Crush's `AppendContent()`/`AddToolCall()`).

### Tool Call Lifecycle

```
assistant (tool_use, id: "toolu_X")  → tool requested  → show spinner
user (tool_result, tool_use_id: "toolu_X")
  → is_error: false  → show result
  → is_error: true   → show error
  → interrupted: true → show canceled
```

### Subagent Tracking

`parent_tool_use_id` links child events to the parent Task tool call:

```
assistant {content: [{type: "tool_use", id: "toolu_TASK", name: "Task"}]}
  → subagent events have parent_tool_use_id: "toolu_TASK"
user {content: [{tool_use_id: "toolu_TASK", type: "tool_result"}]}
```

---

## Relay Process

### Responsibilities

1. Spawn Claude with stream-json flags
2. Read stdout line-by-line, batch events (50-100ms), POST batch to backend
3. Read stderr in a separate thread, include in `process_exit` event
4. Parse POST response for `pending_input` (list) — write each to Claude's stdin in order
5. Parse POST response for `pending_signal` — send SIGINT to Claude if present
6. Send heartbeat POST every 2s when idle (empty batch) to poll for pending input/signals
7. Backend infers relay health from heartbeat recency (`last_heartbeat_at` > 10s stale = down)
8. Optionally pipe events to a tmux log session for VNC visibility
9. On Claude exit, POST a final `process_exit` event and self-terminate

### Spawn Command

```python
cmd = [
    "claude", "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--agent-id", f"{agent_name}@{team_name}",
    "--agent-name", agent_name,
    "--team-name", team_name,
    "--parent-session-id", parent_session_id,
    "--agent-type", "general-purpose",
    "--model", "claude-opus-4-6",
]

proc = subprocess.Popen(
    cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
```

### All Spawn Flags

| Flag | Purpose |
|------|---------|
| `-p` / `--print` | Non-interactive mode (required for stream-json) |
| `--output-format stream-json` | Structured JSON event stream on stdout |
| `--input-format stream-json` | Accept structured JSON on stdin (bidirectional) |
| `--verbose` | Required by stream-json |
| `--include-partial-messages` | Stream token-level deltas (optional, high volume) |
| `--replay-user-messages` | Echo user messages back on stdout for acknowledgment |
| `--dangerously-skip-permissions` | Skip permission prompts (for sandboxed agents) |
| `--session-id <uuid>` | Explicit session ID for tracking |
| `-r` / `--resume <id>` | Resume existing session |
| `--model <model>` | Model selection |
| `--allowedTools <tools>` | Restrict available tools |
| `--system-prompt <prompt>` | Custom system prompt |
| `--append-system-prompt <prompt>` | Append to default system prompt |
| `--max-budget-usd <amount>` | Cost cap per session |
| `--permission-mode <mode>` | Permission mode (default, plan, bypassPermissions) |
| `--mcp-config <json>` | Load additional MCP servers |

**Team-specific flags:**

| Flag | Purpose |
|------|---------|
| `--agent-id <name>@<role>` | Agent identifier with role |
| `--agent-name <name>` | Display name |
| `--team-name <team>` | Team affiliation |
| `--agent-color <color>` | UI color coding |
| `--parent-session-id <uuid>` | Links to parent session |
| `--agent-type <type>` | Agent specialization (general-purpose, Bash, Explore, Plan) |

### Environment Variables

```
CLAUDECODE=1
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
ANTHROPIC_API_KEY=<key>
AGENT_ID=<uuid>
ABOX_CALLBACK_URL=<backend-url>
RELAY_AUTH_TOKEN=<token>
```

### Stdin Buffering Behavior

When a message is sent while Claude is mid-response, stream-json stdin buffers the input. Claude processes the next prompt after the current turn completes (confirmed by multi-turn testing). The relay does not need its own queue — stdin buffering handles this natively.

---

## Backend Changes

### What Gets Removed

| Component | File |
|---|---|
| Hook shell script | provision.py |
| Hook event list + cmd | provision.py |
| Hook settings builder | provision.py |
| Hook script provisioning | provision.py |
| Hook HTTP endpoint | views.py |
| Hook URL route | urls.py |
| ProcessExit curl wrapper | lifecycle.py (tmux exit handler) |
| `process_hook_event()` | lifecycle.py |
| `_extract_last_response()` | lifecycle.py |
| Tmux launch wrapper | lifecycle.py |
| `AgentMessage` model | models.py |
| `AgentEvent` model | models.py |
| `attach_mcp()` via tmux | comms.py (MCP configured at launch via `--mcp-config`) |

### What Gets Added

| Component | Purpose |
|---|---|
| `/agents/stream` endpoint | Receives batched stream-json events from relay |
| `process_stream_events()` | Parses events, upserts Message/SessionResult, broadcasts |
| `Message` model | Typed message with content parts (mirrors Claude Code) |
| `SessionResult` model | Cost/usage per session (upserted per turn) |
| Updated `send_message()` | Enqueue pending_input on Agent record (relay picks up via piggyback) |
| Updated `interrupt_agent()` | Set pending_signal on Agent record (relay picks up via heartbeat) |
| Updated `_provision_agent()` | Launches relay instead of tmux |

### What Stays

- Runtime protocol (`base.py`) — no changes
- Docker/Modal runtimes — `exec()` for health checks
- `create_agent()` / `kill_agent()` — container lifecycle unchanged
- `_build_claude_md()` — agent instructions unchanged
- Broadcast system — publishes typed events instead of raw JSON
- GraphQL subscription pattern — payload types change
- AgentFeedback model — FK migrates from AgentMessage to Message

### `/agents/stream` Endpoint

Receives batched events from relay. Authenticated via `RELAY_AUTH_TOKEN` header (generated during provisioning, passed to relay as env var).

```python
@csrf_exempt
def stream_events(request, agent_id):
    # Validate relay auth token
    token = request.headers.get("X-Relay-Token")
    agent = Agent.objects.get(id=agent_id)
    if token != agent.relay_token:
        return JsonResponse({"error": "unauthorized"}, status=401)

    events = json.loads(request.body)  # array of events (or empty for heartbeat)
    for event in events:
        process_stream_event(agent, event)

    # Update heartbeat timestamp (relay health inference)
    agent.last_heartbeat_at = timezone.now()

    # Piggyback pending input queue + signal in response
    response = {"ack": True, "pending_input": [], "pending_signal": None}
    if agent.pending_input:  # list of queued messages
        response["pending_input"] = agent.pending_input
        agent.pending_input = []
    if agent.pending_signal:
        response["pending_signal"] = agent.pending_signal
        agent.pending_signal = None
    agent.save(update_fields=["pending_input", "pending_signal", "last_heartbeat_at"])
    return JsonResponse(response)
```

---

## Data Model

The data model mirrors Claude Code's message structure directly, following the same pattern Crush uses — typed content parts inside messages, not separate opaque event blobs.

### Message Model (replaces AgentMessage + AgentEvent)

```python
class Message(models.Model):
    """
    Mirrors Claude Code's message structure.
    Each stream-json assistant/user event becomes a Message.
    Content parts use the same typed array format as the Anthropic API.
    """
    agent = models.ForeignKey(Agent, CASCADE, related_name="stream_messages")
    message_id = models.CharField(max_length=50, db_index=True)  # Claude's msg_xxx (stable dedup key)
    session_id = models.CharField(max_length=100, db_index=True)
    role = models.CharField(max_length=10)  # assistant, user
    model = models.CharField(max_length=50, blank=True)
    parts = models.JSONField(default=list)  # typed content parts array (see below)
    usage = models.JSONField(null=True)  # {input_tokens, output_tokens, cache_*}
    parent_tool_use_id = models.CharField(max_length=50, blank=True, db_index=True)
    stop_reason = models.CharField(max_length=20, blank=True)
    turn_number = models.IntegerField(default=0)  # incremented on each result event
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["agent", "session_id", "turn_number"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["agent", "message_id"], name="unique_agent_message"),
        ]
```

### Content Parts Format

`parts` stores the same typed array that Claude emits in `message.content[]`:

```json
[
  {"type": "text", "text": "I'll list the files."},
  {"type": "tool_use", "id": "toolu_xxx", "name": "Bash", "input": {"command": "ls"}},
  {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "file1.txt\n...", "is_error": false}
]
```

**Normalization:** The Anthropic API allows `tool_result.content` to be either a `string` or an array of content blocks (`ContentBlock[]`). The backend's `_normalize_parts()` function normalizes it to always be a string before storage. This runs at both the `_handle_assistant` and `_handle_user` ingestion points in `stream.py`, so `parts` always contains `tool_result.content` as a string.

No translation layer beyond this normalization. The frontend reads the same content part types that Claude produces. This matches how Crush stores messages — typed parts array in a JSON column.

### SessionResult Model

```python
class SessionResult(models.Model):
    """
    Cost and usage per session, upserted on each result event.
    Since result events fire per-turn with cumulative totals,
    this is always one row per (agent, session_id) with the latest values.
    """
    agent = models.ForeignKey(Agent, CASCADE, related_name="session_results")
    session_id = models.CharField(max_length=100)
    is_error = models.BooleanField(default=False)
    total_cost_usd = models.DecimalField(max_digits=10, decimal_places=6)
    duration_ms = models.IntegerField()
    duration_api_ms = models.IntegerField()
    num_turns = models.IntegerField()
    model_usage = models.JSONField()  # per-model breakdown
    permission_denials = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent", "session_id"], name="unique_session_result"),
        ]
```

### Agent Model Changes

```python
# Remove:
transcript_path  # no longer reading transcript files

# Add:
session_cost_usd = models.DecimalField(...)  # running total from SessionResult
capabilities = models.JSONField(null=True)   # tools, mcp_servers, model from system/init
pending_input = models.JSONField(default=list)  # queue of messages for relay piggyback (list, not single)
pending_signal = models.CharField(null=True)  # queued signal (SIGINT) for relay piggyback
relay_token = models.CharField(max_length=64) # auth token for relay → backend
last_heartbeat_at = models.DateTimeField(null=True)  # relay health inference (stale > 10s = down)
```

### Event Processing Logic

```python
def process_stream_event(agent, event):
    event_type = event.get("type")

    if event_type == "system":
        subtype = event.get("subtype")
        if subtype == "init":
            # Upsert capabilities (dedup by session_id — only first init per session)
            if not agent.capabilities:
                agent.capabilities = {
                    "tools": event.get("tools", []),
                    "mcp_servers": event.get("mcp_servers", []),
                    "model": event.get("model"),
                    "version": event.get("claude_code_version"),
                }
                agent.save(update_fields=["capabilities"])
        elif subtype == "process_exit":
            exit_code = event.get("exit_code", -1)
            # STOPPED (not IDLE) — process is gone, agent can't accept input
            agent.status = "stopped" if exit_code == 0 else "error"
            agent.save(update_fields=["status"])

    elif event_type == "assistant":
        msg_data = event.get("message", {})
        message_id = msg_data.get("id", "")
        # IMPORTANT: Claude sends each content block as a separate event with
        # the same message_id (text first, then each tool_use individually).
        # We must APPEND parts, not replace — same pattern Crush uses with
        # AppendContent()/AddToolCall().
        # See: docs/CRUSH-ARCHITECTURE.md, "Streaming Callbacks"
        message, created = Message.objects.get_or_create(
            agent=agent, message_id=message_id,
            defaults={
                "session_id": event.get("session_id", ""),
                "role": "assistant",
                "model": msg_data.get("model", ""),
                "parts": [],
                "parent_tool_use_id": event.get("parent_tool_use_id", ""),
            }
        )
        # Normalize content parts (tool_result.content: array → string) then append
        new_parts = _normalize_parts(msg_data.get("content", []))
        message.parts = message.parts + new_parts
        message.usage = msg_data.get("usage") or message.usage
        message.stop_reason = msg_data.get("stop_reason") or message.stop_reason
        message.save(update_fields=["parts", "usage", "stop_reason", "updated_at"])
        agent.status = "working"
        agent.save(update_fields=["status"])
        broadcast_message(agent, message)

    elif event_type == "user":
        # Tool results — each tool_result arrives as a separate event.
        # Use the event's uuid as message_id (not tool_use_id) for
        # idempotency on relay retry. get_or_create for safety.
        # Normalize content parts (tool_result.content: array → string)
        msg_data = event.get("message", {})
        content = _normalize_parts(msg_data.get("content", []))
        event_uuid = event.get("uuid", "")
        Message.objects.get_or_create(
            agent=agent,
            message_id=event_uuid,
            defaults={
                "session_id": event.get("session_id", ""),
                "role": "user",
                "parts": content,
            }
        )

    elif event_type == "result":
        session_id = event.get("session_id", "")
        SessionResult.objects.update_or_create(
            agent=agent, session_id=session_id,
            defaults={
                "is_error": event.get("is_error", False),
                "total_cost_usd": event.get("total_cost_usd", 0),
                "duration_ms": event.get("duration_ms", 0),
                "duration_api_ms": event.get("duration_api_ms", 0),
                "num_turns": event.get("num_turns", 0),
                "model_usage": event.get("modelUsage", {}),
                "permission_denials": event.get("permission_denials", []),
            }
        )
        agent.session_cost_usd = event.get("total_cost_usd", 0)
        agent.status = "idle"
        agent.save(update_fields=["session_cost_usd", "status"])
        # Increment turn_number on recent messages
        Message.objects.filter(
            agent=agent, session_id=session_id, turn_number=0
        ).update(turn_number=event.get("num_turns", 1))
        broadcast_session_result(agent, session_id)
```

---

## Frontend Changes

### Data Flow

```
Relay → POST events → Backend process_stream_events()
  │
  ├── Persist: Message model (typed parts) + SessionResult (cost)
  │
  └── Broadcast: GraphQL subscription → typed payloads
      │
      └── Dashboard stores → components
```

### New Types

```typescript
// Mirrors backend Message model, which mirrors Claude Code's message structure
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

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean };
  // Note: tool_result.content is normalized to string by backend (_normalize_parts).
  // The Anthropic API allows string | ContentBlock[], but we always store string.

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

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

interface AgentCapabilities {
  tools: string[];
  mcpServers: { name: string; status: string }[];
  model: string;
  version: string;
}
```

### What Gets Removed from Frontend

- Message deduplication logic in `command-panel.tsx` (~40 lines)
- Triple data path (query + events + subscription converging with `direction:content` dedup)
- Opaque `AgentEvent` type with string-matched `eventType`
- `AgentMessage` type with `direction: 'inbound' | 'outbound'`

### What Gets Added

- `Message` type with typed `ContentPart[]` — no translation needed from wire format
- `SessionResult` type for cost display
- `AgentCapabilities` type for agent info panel
- Cost badge on agent cards (`totalCostUsd` from SessionResult)
- Agent capabilities panel (tools, MCP servers from system/init)
- Messages keyed by `messageId` — no dedup needed, just upsert
- `turnNumber` for grouping messages into logical turns

---

## Metrics Available

| Metric | Source | Granularity |
|---|---|---|
| Cost (USD) | `result.total_cost_usd` | Per turn (cumulative) |
| Cost by model | `result.modelUsage[model].costUSD` | Per model per session |
| Input tokens | `assistant.message.usage.input_tokens` | Per turn |
| Output tokens | `assistant.message.usage.output_tokens` | Per turn |
| Cache creation | `usage.cache_creation_input_tokens` | Per turn |
| Cache read | `usage.cache_read_input_tokens` | Per turn |
| Cache hit rate | `cache_read / (cache_read + cache_creation + input)` | Derived |
| API latency | `result.duration_api_ms` | Per turn |
| Total latency | `result.duration_ms` | Per turn |
| Tool execution time | `duration_ms - duration_api_ms` | Derived |
| Turn count | `result.num_turns` | Per session (cumulative) |
| Permission denials | `result.permission_denials` | Per session |
| Tools available | `init.tools` | Per agent |
| MCP server status | `init.mcp_servers` | Per agent |
| Web search usage | `usage.server_tool_use.web_search_requests` | Per session |

---

## VNC Visibility

VNC is for observing agents equipped with computer-use MCP navigating a desktop environment — watching the mouse move, Firefox open, GUI interactions. This is **unaffected** by the relay approach.

The relay changes how Claude communicates (stream-json stdin/stdout instead of tmux), not what Claude does. Computer-use MCP still controls the X11 display, mouse still moves, screenshots still happen. VNC shows all of that regardless of whether Claude runs in interactive mode or `-p` mode.

No changes needed to VNC. The tmux session that previously showed Claude's terminal text was never the point of VNC — it was just a side effect of the launch method.

---

## Migration Path

### Phase 0: Spike (1 day)
- Build minimal relay (~50 lines) inside a Docker container
- Spawn Claude with all flags, verify stdout events arrive at backend
- Verify multi-turn via stdin for 10+ minutes without dropped events
- Verify SIGINT interrupt works
- Verify event batching (50-100ms) doesn't drop events

### Phase 1: Relay + Backend (replaces tmux launch, additive models)
- Bundle relay in agent image
- Add `/agents/stream` endpoint with relay auth token
- Add `Message` and `SessionResult` models (additive — old models still exist)
- Add `process_stream_events()` alongside existing `process_hook_event()`
- **Replace tmux launch with relay launch** — this is the switch point for how Claude starts
- Keep hooks configured in `.claude/settings.json` so hook events still fire during transition
- Rewrite `send_message()` to enqueue `pending_input` on Agent record
- Rewrite `interrupt_agent()` to set `pending_signal` on Agent record
- MCP servers configured at launch time via `--mcp-config` (remove runtime `attach_mcp()`)
- Validate data parity between hook events and stream events

### Phase 2: Frontend Migration
- Add new types (`Message`, `SessionResult`, `ContentPart`, `AgentCapabilities`)
- Messages store keyed by `messageId` — upsert, no dedup
- ChatView reads from new store, renders typed content parts
- Remove dedup logic, old `AgentMessage` queries
- Add cost badge, capabilities panel
- Group messages by `turnNumber`

### Phase 3: Cleanup
- Remove hook shell script, provisioning, hook settings builder
- Remove `/hooks/event` endpoint and URL route
- Remove `process_hook_event()`, `_extract_last_response()`
- Remove `AgentEvent` and `AgentMessage` models
- Migrate `AgentFeedback.message` FK from AgentMessage to Message
- Remove `transcript_path` from Agent model
- Migration to drop old tables

---

## Risks

| Risk | Mitigation |
|---|---|
| stream-json format changes on Claude Code upgrade | Pin version, test on upgrade. Format follows Anthropic API conventions. |
| Relay process crashes | s6-overlay restarts it. Or relay is Claude's parent — if relay dies, Claude dies, backend gets no events, marks agent as error via heartbeat timeout. |
| Backend downtime misses events | Relay buffers last N events in memory. On backend reconnect, replay buffer. Or: accept gap, `result` event at turn end gives cumulative totals regardless. |
| Long-running agents (hours) | Tested multi-turn. Each turn is independent — relay just keeps reading stdout. No connection timeout concern since it's a local pipe. |
| `--include-partial-messages` volume | Optional flag. Don't enable by default. If enabled, backend should NOT persist deltas — only relay to ephemeral WebSocket for live streaming. |
| Relay auth token leaked | Token is per-agent, short-lived (agent lifetime). Rotate on agent restart. Container-internal only. |
| Stdin buffering during active turn | Confirmed: stream-json stdin buffers input, processes next prompt after current turn completes. No relay-side queue needed. |
| Claude crashes mid-turn | Relay captures exit code + stderr, sends `process_exit` event. Backend marks agent as error. No orphaned spinners — frontend handles `process_exit` by resolving pending tool calls. |

---

## Partial Messages (Live Streaming)

With `--include-partial-messages`, Claude emits `stream_event` events wrapping the raw Anthropic streaming API. Validated on v2.1.37.

### Event Lifecycle

```
stream_event {event.type: "message_start"}
stream_event {event.type: "content_block_start", content_block: {type: "text"}}
stream_event {event.type: "content_block_delta", delta: {type: "text_delta", text: "I'll list"}}
stream_event {event.type: "content_block_delta", delta: {type: "text_delta", text: " the files."}}
assistant    {message.content: [{type: "text", text: "I'll list the files."}]}  ← full message
stream_event {event.type: "content_block_stop"}
stream_event {event.type: "content_block_start", content_block: {type: "tool_use"}}
stream_event {event.type: "content_block_delta", delta: {type: "input_json_delta", partial_json: "{\"comm"}}
stream_event {event.type: "content_block_delta", delta: {type: "input_json_delta", partial_json: "and\": \"ls\""}}
assistant    {message.content: [{type: "tool_use", name: "Bash", ...}]}  ← full tool call
stream_event {event.type: "content_block_stop"}
stream_event {event.type: "message_delta", delta: {stop_reason: "end_turn"}}
stream_event {event.type: "message_stop"}
```

### Key Findings

| Behavior | Observed |
|---|---|
| Granularity | Chunk-level (2-5 words), not token-level. Perfect for typing effect. |
| Delta types | `text_delta` for text, `input_json_delta` for tool input (streaming JSON) |
| Full message still emitted | `assistant` event fires after streaming completes — deltas AND final message |
| MCP tools | Same streaming pattern as native tools. `content_block_start {type: "tool_use"}` streams MCP tool input. |
| Event type | `stream_event` — distinct from `assistant`/`user`/`result`, easy to filter |
| Block boundaries | `content_block_start/stop` provide clean transition points for UI |
| Turn boundaries | `message_start/stop` + `message_delta` with `stop_reason` |

### Architecture Recommendation

- **Relay:** Forward `stream_event` events to backend in real-time (not batched)
- **Backend:** Do NOT persist `stream_event` — pass through to WebSocket only
- **Frontend:** Render deltas for live typing. On `assistant` event, replace accumulated deltas with final message.
- **Subscription:** Separate ephemeral channel for `stream_event` (e.g. `agentStreaming(agentId)`) vs persistent `messageReceived` for final messages.

### stream_event Schema

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "chunk of text"
    }
  },
  "session_id": "...",
  "parent_tool_use_id": null,
  "uuid": "..."
}
```

---

## Open Questions

1. **Session resume with stream-json** — Does `-r <session-id>` with stream-json replay history or start fresh? Matters for agent restart without context loss.
2. **Context management events** — The `context_management` field in assistant messages is null in tests. When does it populate? May relate to auto-summarization.
