# Architecture

Technical reference for Agentobox. Read this before writing backend code, adding hook interceptions, implementing stream event handlers, or modifying agent provisioning.

## System Overview

Agentobox runs Claude Code agents in isolated Docker (or Modal) containers, observes their activity via stream-json, and presents it through a web dashboard.

```
Container                              Backend (Django)
┌───────────────────────────┐        ┌──────────────────────────┐
│ Claude Code (stream-json) │        │                          │
│   stdout → abox-relay     │        │                          │
│   relay batches events ───────────→│ POST /agents/stream      │
│   relay reads response ←──────────←│   process_stream_events()│
│     (pending_input, signal)│        │     → upsert Message     │
│   relay writes to stdin   │        │     → upsert SessionResult│
│                           │        │     → route interagent    │
│ Hooks (PreToolUse)        │        │     → broadcast via WS    │
│   pre-tool-use.py ────────────────→│ POST /agents/.../hook     │
│   ← feedback (exit 2)    │        │                          │
└───────────────────────────┘        └──────────┬───────────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │ GraphQL Subscriptions│
                                     │   → WebSocket        │
                                     │   → Dashboard        │
                                     └─────────────────────┘
```

**Components:**
- **Agent container**: Alpine/Debian image with s6-overlay, AwesomeWM, Firefox, noVNC, Claude Code, and the abox-relay process
- **abox-relay**: ~150-line Python process inside each container. Spawns Claude with `--output-format stream-json`, reads stdout, batches events, POSTs to backend, writes pending_input to stdin
- **Backend**: Django 6.0 + Strawberry GraphQL + Daphne (ASGI). Processes stream events, manages agent lifecycle, routes inter-agent messages
- **Dashboard**: Next.js + urql + Zustand + augmented-ui. Receives updates via GraphQL subscriptions over WebSocket

## Claude Code Integration

### What Claude Code Provides Natively

Claude Code has built-in support for agent teams: mailbox communication, shared task lists, hooks, and a file-based coordination system. Agentobox extends (not replaces) these capabilities.

**Native tools when teaming is active:**

| Tool | Purpose | Who uses it |
|------|---------|-------------|
| `TeamCreate` | Create team namespace (config.json, task dirs, inboxes) | Lead only |
| `Task` (with `team_name`) | Spawn a new teammate | Lead |
| `SendMessage` | Direct message, broadcast, shutdown request/response | All agents |
| `TaskCreate` | Create a work item in the shared task list | All agents |
| `TaskUpdate` | Update status, assign owner, set dependencies | All agents |
| `TaskList` / `TaskGet` | View tasks and status | All agents |
| `TeamDelete` | Remove team config and task dirs | Lead only |

### Task Tool: Two Modes

The `Task` tool has two fundamentally different modes controlled by the `team_name` parameter:

| | Subagent mode | Teammate mode |
|---|---|---|
| **Parameters** | `Task(prompt, subagent_type)` | `Task(prompt, subagent_type, team_name, name)` |
| **Lifecycle** | Ephemeral — blocks caller, returns result, dies | Persistent — runs independently until shutdown |
| **Communication** | Return value only | File-based mailbox (SendMessage) |
| **Registration** | None | Added to config.json with agentId, tmuxPaneId |
| **tmux** | No pane | Gets own tmux pane |

### File-Based Internals

Claude Code's team system is entirely file-based:

| Component | Path | Format |
|-----------|------|--------|
| Team config | `~/.claude/teams/{team}/config.json` | Member roster with agentId, name, model, cwd |
| Inboxes | `~/.claude/teams/{team}/inboxes/{agent}.json` | JSON array of message objects |
| Tasks | `~/.claude/tasks/{team}/` | `.lock` file + individual task files |

**Key behaviors:**
- `SendMessage` reads config.json to find the target, writes to the target's inbox file
- Receiving uses an internal polling loop (~1s interval) that reads the agent's own inbox file
- `--parent-session-id` is a namespace key — any UUID works, agents sharing the same value can communicate
- agentId format: `{name}@{team-name}`
- File locking via `filelock.FileLock` for cross-process atomicity
- Atomic writes via tempfile + `os.replace` to prevent partial reads

## Distributed Bridge

### The Gap

Claude Code's file-based tools assume all agents share a filesystem. In Agentobox, each agent runs in a separate container. When Agent A calls `SendMessage` targeting Agent B, Claude writes to a local file that Agent B never sees.

### SendMessage Routing

```
Agent A calls SendMessage(recipient="agent-b", content="hello")
  │
  ├─ Claude writes to local inbox file (harmless no-op)
  │
  ├─ assistant event with SendMessage tool_use flows to backend via relay
  │
  ├─ stream.py → _handle_assistant → route_inter_agent_messages()
  │   └─ Extracts recipient + content from tool_use input
  │   └─ Finds target Agent by name in same project
  │   └─ Formats as stream-json user input, atomically enqueues in target.pending_input
  │
  ├─ Target relay picks up pending_input in next piggyback response
  │
  └─ Relay writes to Claude's stdin → Agent B receives message as a user turn
```

**File:** `backend/agents/services/interagent.py` — `route_inter_agent_messages()`

### Task Interception (PreToolUse Hook)

If `Task(team_name=..., name=...)` executes locally, Claude spawns a tmux pane inside the container — consuming API tokens with no relay, no backend tracking, no VNC. The PreToolUse hook intercepts this.

```
Agent calls Task(team_name="my-team", name="helper")
  │
  ├─ PreToolUse hook fires → pre-tool-use.py reads stdin JSON
  │
  ├─ Detects team_name in tool_input → POSTs to backend hook endpoint
  │
  ├─ Backend creates a real container via create_agent()
  │
  └─ Hook returns exit code 2 + "Deploying teammate..." feedback
     └─ Claude receives feedback, continues working (doesn't block)
```

Plain `Task(prompt=...)` without `team_name` passes through — subagents run locally and that's fine.

**Files:**
- `agent/rootfs/opt/abox/hooks/pre-tool-use.py` — Hook script in container
- `backend/agents/services/provision.py` — Hook config in `_build_settings_json()`
- `backend/agents/views.py` — `hook_create_teammate` endpoint

### Team Config Provisioning

At container creation, `provision_team_config()` creates:
- `~/.claude/teams/{team}/config.json` — member roster (all agents in the project)
- `~/.claude/teams/{team}/inboxes/{agent}.json` — empty inbox file
- `~/.claude/tasks/{team}/` — task directory

When a new agent is created, `update_team_configs()` pushes updated config.json to all running agents so they can discover the new teammate.

## Control Plane Patterns

### Decision Tree

```
Does local execution cause harm?
  YES → PreToolUse hook (block + redirect)
  NO  → Does the backend need to know?
    YES → Stream observation (sync after execution)
    NO  → Do nothing
```

### Mechanism 1: PreToolUse Hooks (Block + Redirect)

**When:** Local execution is actively harmful and must be prevented.

**How:** Claude Code fires a PreToolUse hook before tool execution. The hook script reads stdin (JSON with tool_name and tool_input), decides whether to intercept, and exits with code 2 to block execution and inject feedback.

**Exit codes:**
- `0` — allow (tool executes normally)
- `2` — feedback mode (stderr content injected as system message, tool blocked)
- Other — non-blocking error (logged, does not affect agent)

**Current interception:** `Task` with `team_name` parameter (teammate spawning).

### Mechanism 2: Stream Observation (Sync After Execution)

**When:** Local execution is correct, but the backend needs to mirror the state.

**How:** Claude executes the tool locally. The stream-json relay sends assistant events to the backend. We scan content parts for specific tool_use calls and sync to the database as a side-effect.

**Current observations:**
- `SendMessage` — route to target agent via pending_input (`interagent.py`)
- `TaskCreate` / `TaskUpdate` — sync to AgentTask records (`interagent.py`)

### Adding New Interceptions

1. Ask: does local execution cause harm?
2. If YES: add a PreToolUse hook case in `pre-tool-use.py` + backend endpoint
3. If NO but backend needs data: add observation in `interagent.py` + call from `stream.py`
4. If NO and backend doesn't need data: do nothing

## Stream-JSON Pipeline

### Relay Process

The relay is an in-container Python process (~150 lines) that bridges Claude's stdout to the backend via HTTP.

**Responsibilities:**
1. Spawn Claude with stream-json flags
2. Read stdout line-by-line, batch events (50-100ms), POST batch to backend
3. Read stderr in a separate thread, include in `process_exit` event
4. Parse POST response for `pending_input` — write each to Claude's stdin
5. Parse POST response for `pending_signal` — send SIGINT to Claude if present
6. Send heartbeat POST every 2s when idle to poll for pending input/signals
7. On Claude exit, POST a final `process_exit` event (synthetic, relay-created)

**Spawn command:**
```python
cmd = [
    "claude", "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--agent-id", f"{name}@{team}",
    "--agent-name", name,
    "--team-name", team,
    "--parent-session-id", parent_session_id,
    "--agent-type", "general-purpose",
    "--model", model,
]
```

**Key flags:** `-p` (non-interactive), `--output-format stream-json` (structured events on stdout), `--input-format stream-json` (accepts JSON on stdin for multi-turn), `--verbose` (required by stream-json).

### Message Delivery: Piggyback Pattern

Instead of the relay running its own HTTP listener, the backend piggybacks pending input in POST responses:

```
Relay POSTs events  →  Backend responds with:
                        {"ack": true, "pending_input": [], "pending_signal": null}
                        — or —
                        {"ack": true, "pending_input": [{...}], "pending_signal": "SIGINT"}
```

The relay writes any `pending_input` items to Claude's stdin. When Claude is idle (no events to POST), the relay sends periodic heartbeats (every 2s) to poll for pending input.

### Event Types

| Event | Source | Content |
|-------|--------|---------|
| `system/init` | Claude | tools, mcp_servers, model, version. Fires at session start AND each turn. |
| `system/process_exit` | Relay (synthetic) | exit_code, stderr. Fires when Claude process exits. |
| `assistant` | Claude | message.content[] with text and/or tool_use parts. 1 part per event. |
| `user` | Claude | message.content[] with tool_result parts. 1 part per event. |
| `result` | Claude | Cumulative cost/usage/duration. Fires after each turn. |

### Content Part Accumulation

**Critical:** Assistant events carry exactly 1 content part each with the same `message.id`. Parts arrive incrementally:

```
assistant {message.id: "msg_A", content: [{type: "text"}]}          ← 1 part
assistant {message.id: "msg_A", content: [{type: "tool_use"}]}      ← 1 part
assistant {message.id: "msg_A", content: [{type: "tool_use"}]}      ← 1 part (parallel)
user      {content: [{tool_use_id: "toolu_X", type: "tool_result"}]}
assistant {message.id: "msg_B", content: [{type: "text"}]}          ← new turn
```

The backend must **APPEND** parts to the Message, not replace. See `_handle_assistant()` in `stream.py`.

### Event Processing

**File:** `backend/agents/services/stream.py` — `process_stream_events()`

Each event type routes to a handler:

| Event | Handler | Action |
|-------|---------|--------|
| `system/init` | `_handle_system` | Upsert `agent.capabilities`, update `session_id` |
| `system/process_exit` | `_handle_system` | Set `agent.status` to stopped or error |
| `assistant` | `_handle_assistant` | Get-or-create Message by `message_id`, APPEND parts, route interagent messages, route task operations, broadcast |
| `user` | `_handle_user` | Create Message by event `uuid` (idempotent), store tool_result parts |
| `result` | `_handle_result` | Create SessionResult (per-turn snapshot), update `agent.session_cost_usd`, mark agent idle |

## Hook Reference

### Hook Events

| Event | When | Key Fields |
|-------|------|------------|
| PreToolUse | Before any tool runs | `tool_name`, `tool_input`, `tool_use_id` |
| PostToolUse | After tool completes | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| Stop | Agent considers stopping | `reason` |
| SessionStart | Session begins | `source`, `model` |
| SessionEnd | Session ends | `reason` |
| TeammateIdle | Teammate becomes idle | `teammate_name`, `team_name` |
| TaskCompleted | Task marked complete | `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name` |
| SubagentStart | Subagent spawned | `agent_id`, `agent_type` |
| SubagentStop | Subagent stopping | `agent_id`, `agent_type`, `agent_transcript_path` |
| PreCompact | Before context compaction | (none extra) |

### Hook Input Format

All hooks receive JSON via stdin with common fields:

```json
{
  "session_id": "uuid",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/working/dir",
  "hook_event_name": "PreToolUse",
  "permission_mode": "bypassPermissions"
}
```

Plus event-specific fields (e.g., `tool_name` + `tool_input` for PreToolUse).

### Hook Output

**Exit codes:**
- `0` — allow action to proceed
- `2` — feedback: stderr content injected as system message to Claude, tool blocked
- Other — non-blocking error (logged)

**PreToolUse JSON output:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "updatedInput": {}
  }
}
```

### Hook Config

Hooks are configured in `.claude/settings.json` via `_build_settings_json()` in `provision.py`. Currently only `PreToolUse` on `Task` tool is configured.

**Matcher syntax:**
- `"Task"` — exact match
- `"Read|Write|Edit"` — multiple tools (OR)
- `"*"` — wildcard (all tools)
- `"mcp__.*__delete.*"` — regex

## Data Models

### Agent

**File:** `backend/agents/models.py`

| Field | Purpose |
|-------|---------|
| `status` | Lifecycle: deploying → idle → running → stopped/error |
| `team_name` | Claude Code team namespace |
| `parent_session_id` | Team coordination key (project UUID) |
| `session_id` | Current Claude session (from system/init) |
| `capabilities` | Tools, MCP servers, model, version (from system/init) |
| `pending_input` | Queue of stream-json messages for relay piggyback |
| `pending_inbox` | Queue of inter-agent inbox messages for relay |
| `pending_signal` | Queued signal (e.g., "SIGINT") for relay |
| `relay_token` | Auth token for relay → backend |
| `last_heartbeat_at` | Relay health inference (stale > 10s = down) |
| `session_cost_usd` | Running total from SessionResult |
| `config_snapshot` | Saved creation config for restart |
| `mcp_servers` | MCP server config dict |
| `workspace_path` | Host path bind-mounted into container |
| `volume_mounts` | Explicit volume mount list |
| `instructions` | Role instructions injected into CLAUDE.md |

**Status lifecycle:**
```
deploying → idle (provisioned) → running (assistant event) → idle (result event)
                                                           → stopped (exit 0)
                                                           → error (exit != 0)
```

### Message

Mirrors Claude Code's stream-json events. Each `assistant` or `user` event becomes a Message.

| Field | Source |
|-------|--------|
| `message_id` | `event.message.id` (assistant) or `event.uuid` (user) — stable dedup key |
| `session_id` | `event.session_id` |
| `role` | "assistant" or "user" |
| `parts` | Typed content parts array: text, tool_use, tool_result |
| `usage` | Token counts with cache breakdown |
| `parent_tool_use_id` | Non-null for subagent responses |
| `turn_number` | Set from result event's `num_turns` |

**Content parts format** (same as Anthropic API):
```json
[
  {"type": "text", "text": "I'll list the files."},
  {"type": "tool_use", "id": "toolu_xxx", "name": "Bash", "input": {"command": "ls"}},
  {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "file1.txt\n...", "is_error": false}
]
```

### SessionResult

Cost/usage snapshot per turn. `result` events fire per-turn with cumulative totals. Each turn gets its own row for a full cost timeline.

| Field | Source |
|-------|--------|
| `total_cost_usd` | Cumulative session cost |
| `duration_ms` / `duration_api_ms` | Total wall time vs API time (diff = tool exec time) |
| `num_turns` | Conversation depth |
| `model_usage` | Per-model cost/token breakdown |

### AgentTask

Synced from stream observation when agents call `TaskCreate`/`TaskUpdate`.

| Field | Source |
|-------|--------|
| `task_id` | Claude's internal task ID |
| `subject` / `description` | Task content |
| `status` | pending → in_progress → completed |
| `owner` | Which agent owns the task |

### AgentEvent

Lifecycle events for the dashboard feed (created, stopped, restarted, provision_failed).

## Key Services

### lifecycle.py

Agent lifecycle management.

| Function | Purpose |
|----------|---------|
| `create_agent()` | Create agent record, resolve secrets, provision container in background |
| `kill_agent()` | Terminate container, mark stopped |
| `restart_agent()` | Terminate + re-provision using saved `config_snapshot` |
| `_provision_agent()` | Background task: create container, provision workspace, launch relay |

### stream.py

Stream event processing — the main data pipeline.

| Function | Purpose |
|----------|---------|
| `process_stream_events()` | Entry point: iterate events, route to handlers |
| `_handle_system()` | Upsert capabilities, handle process_exit |
| `_handle_assistant()` | Upsert Message (APPEND parts), route interagent, route tasks |
| `_handle_user()` | Create Message for tool_result |
| `_handle_result()` | Create SessionResult, update agent cost/status |

### interagent.py

Inter-agent message routing and task observation.

| Function | Purpose |
|----------|---------|
| `route_inter_agent_messages()` | Scan for SendMessage tool_use, route to target agent |
| `route_task_operations()` | Scan for TaskCreate/TaskUpdate, sync to AgentTask |
| `_deliver_to_stdin()` | Format team message as stream-json input, atomically enqueue in pending_input |
| `_atomic_enqueue()` | Append to pending_input under row lock |

### provision.py

Workspace setup and team config.

| Function | Purpose |
|----------|---------|
| `provision_workspace()` | Write CLAUDE.md, settings.json, .mcp.json, .claude.json, security hardening |
| `provision_team_config()` | Create config.json, inboxes, task dir inside container |
| `update_team_configs()` | Push updated config.json to all running agents |
| `_build_claude_md()` | Generate agent CLAUDE.md with project context, instructions, team roster |
| `_build_settings_json()` | Generate settings with hook config and apiKeyHelper |
| `_build_mcp_json()` | Generate .mcp.json with secrets injected into env blocks |

### broadcast.py

WebSocket push to dashboard via GraphQL subscriptions.

## Agent Provisioning

### Container Creation Flow

```
create_agent()
  ├─ Create Agent record (status: deploying)
  ├─ Resolve project secrets
  ├─ Broadcast agent update to dashboard
  ├─ Background: _provision_agent()
  │    ├─ runtime.create() with env vars + volume mounts
  │    ├─ provision_workspace()
  │    │    ├─ Write /home/agent/CLAUDE.md (project context, instructions, team roster)
  │    │    ├─ Write /home/agent/.claude/settings.json (hooks, apiKeyHelper)
  │    │    ├─ Write /home/agent/.mcp.json (MCP servers with secrets in env blocks)
  │    │    ├─ Write /home/agent/.claude.json (onboarding complete, key approved)
  │    │    ├─ Provision API key helper (tmpfs + script)
  │    │    └─ Provision scoped sudo (package-manager-only)
  │    ├─ provision_team_config()
  │    │    ├─ Write ~/.claude/teams/{team}/config.json (member roster)
  │    │    ├─ Write ~/.claude/teams/{team}/inboxes/{agent}.json (empty inbox)
  │    │    └─ Create ~/.claude/tasks/{team}/ directory
  │    ├─ Write /home/agent/.relay_env (relay environment variables)
  │    └─ Launch relay via: tmux new-session -d -s claude -x 200 -y 50
  └─ Background: update_team_configs() → push roster to all running agents
```

### Security

- **API key**: Delivered via `apiKeyHelper` in settings.json. Key stored in tmpfs (`/run/secrets/anthropic_key`, root:root 0400), read by a helper script. Not in shell environment.
- **Scoped sudo**: Agents can only `sudo apt-get/apt/dpkg`. Cannot `sudo cat`, `sudo bash`, etc.
- **CLAUDE.md security section**: Instructions to never output secrets, never read /run/secrets.
- **Relay auth**: Per-agent `relay_token` generated at provisioning, validated on every stream POST.
- **Secrets in MCP**: Project secrets injected into every MCP server's env block. MCP servers ignore keys they don't recognize.

### MCP Registry

Two types in `provision.py`:
- **Bundled**: Pre-installed in agent image (e.g., `computer-use` — node server at `/opt/mcp-servers/`)
- **npx**: Downloaded at runtime (e.g., `playwright` via `npx @playwright/mcp@latest`)

Each registry entry has: `command`, `args`, `compat` (image variants), and optional `instructions` (injected into CLAUDE.md).

## File Reference

| File | Role |
|------|------|
| `backend/agents/models.py` | Agent, Message, SessionResult, AgentTask, AgentEvent models |
| `backend/agents/services/lifecycle.py` | create_agent, kill_agent, restart_agent |
| `backend/agents/services/stream.py` | Stream event processing pipeline |
| `backend/agents/services/interagent.py` | Inter-agent message routing + task observation |
| `backend/agents/services/provision.py` | Workspace setup, settings, CLAUDE.md, team config, MCP registry |
| `backend/agents/services/broadcast.py` | WebSocket push to dashboard |
| `backend/agents/views.py` | GraphQL mutations + hook callback endpoints |
| `backend/agents/runtimes/base.py` | Runtime protocol (create, terminate, exec, write_file) |
| `backend/agents/runtimes/docker.py` | Docker runtime implementation |
| `backend/agents/runtimes/modal.py` | Modal runtime implementation |
| `agent/rootfs/opt/abox/relay.py` | In-container relay process |
| `agent/rootfs/opt/abox/hooks/pre-tool-use.py` | PreToolUse hook script |
