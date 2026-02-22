# Architecture

Technical reference for Agentobox. Read this before writing backend code, adding hook interceptions, implementing stream event handlers, or modifying agent provisioning.

For product-level axioms and principles, see `docs/FOUNDATIONS.md`. For dashboard UX, see `docs/DASHBOARD-UX-SPEC.md`.

## The Insight

Agentobox is a coordination layer, not a runtime.

Every agent runtime — Claude Code, OpenClaw, Codex — handles "single agent doing work" well. None of them handle "multiple agents working together" well. Claude Code's native team system is file-based and single-machine. OpenClaw's RFC #10036 acknowledges the gap. Clawe duct-tapes coordination on top. Codex has no team concept at all.

Agentobox fills that gap: coordination tools + backend state + fleet observability.

```
Any Agent Runtime              Agentobox (our code)
(OpenClaw, CC, Codex)
┌──────────────────┐          ┌──────────────────┐
│ read/write/edit  │          │ Coordination MCP  │
│ bash/browser     │  ◄────►  │ (team/task/msg)   │
│ skills/desktop   │          └────────┬──────────┘
│ "do the work"    │                   │
└──────────────────┘          ┌────────▼──────────┐
                              │  Django Backend    │
                              │  (state + events)  │
                              └────────┬──────────┘
                                       │
                              ┌────────▼──────────┐
                              │    Dashboard       │
                              │  (observability)   │
                              └───────────────────┘
```

The runtime handles tool execution, file I/O, browser control. Agentobox handles everything between agents: push messaging, shared task state, event aggregation, cost tracking, and a dashboard that shows what the fleet is doing.

## What Exists Today (V2)

The current deployed system — what's actually running. All code paths described below are real and in production.

### Components

- **Backend**: Django 6.0 + Strawberry GraphQL + Daphne (ASGI). ~3,468 lines in `backend/agents/services/`.
- **Dashboard**: Next.js + urql + Zustand + augmented-ui. Real-time updates via GraphQL subscriptions over WebSocket.
- **Agent container**: Alpine/Debian image with s6-overlay, AwesomeWM, Firefox, noVNC, Claude Code, and the abox-relay process.
- **Runtimes**: Docker (local dev) and Modal (serverless). Abstracted behind `Runtime` protocol in `backend/agents/runtimes/base.py`.

### System Overview

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
│ MCP Coordination Tools    │        │     → broadcast via WS    │
│   abox-coord ─────────────────────→│ /mcp (FastMCP)            │
│   ← tool response         │        │                          │
└───────────────────────────┘        └──────────┬───────────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │ GraphQL Subscriptions│
                                     │   → WebSocket        │
                                     │   → Dashboard        │
                                     └─────────────────────┘
```

## Runtime Protocol

The `Runtime` protocol (`backend/agents/runtimes/base.py`) abstracts container operations across Docker and Modal:

```python
class Runtime(Protocol):
    async def create(self, name, env, volumes=None) -> SandboxInstance: ...
    async def exec(self, sandbox_id, cmd, user="agent") -> str: ...
    async def write_file(self, sandbox_id, content, dest) -> None: ...
    async def terminate(self, sandbox_id) -> None: ...
    async def list_sandboxes(self) -> list[SandboxInstance]: ...
    async def get_status(self, sandbox_id) -> str: ...
```

`SandboxInstance` returns `id` and `vnc_url`. `VolumeMount` specifies `name`, `mount_path`, `host_path` (Docker bind mounts), and `read_only`.

## Relay Process

**File:** `agent/rootfs/opt/abox/relay.py` (~516 lines)

The relay is an in-container Python process that bridges Claude's stdout to the backend via HTTP. Uses only stdlib (no external dependencies).

**Responsibilities:**
1. Spawn Claude with stream-json flags
2. Read stdout line-by-line, batch events (75ms window), POST batch to backend
3. Read stderr separately, include in `process_exit` event
4. Parse POST response for `pending_input` — write each to Claude's stdin
5. Parse POST response for `pending_signal` — send SIGINT to Claude if present
6. Send heartbeat POST every 2s when idle to poll for pending input/signals
7. On Claude exit: POST synthetic `process_exit` event, optionally restart with `--resume`

**Spawn command:**
```
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  --agent-id {name}@{team} \
  --agent-name {name} \
  --team-name {team} \
  --parent-session-id {project_uuid} \
  --agent-type general-purpose \
  --model {model}
```

Key flags: `-p` (non-interactive), `--output-format stream-json` (structured events on stdout), `--input-format stream-json` (accepts JSON on stdin for multi-turn), `--verbose` (required by stream-json).

**Restart modes:**
- **Soft restart** (`pending_signal="restart"`): SIGINT → respawn with `--resume {session_id}`. MCP servers re-init from updated `.mcp.json`.
- **Clear** (`pending_signal="clear"`): SIGINT → respawn fresh (no `--resume`).
- **Hard restart** (backend `hard_restart_agent()`): Terminate container, reprovision with `RESUME_SESSION_ID` env var.

## Piggyback Pattern

Instead of the relay running its own HTTP listener, the backend piggybacks pending input in POST responses:

```
Relay POSTs events  →  Backend responds with:
                        {"ack": true, "pending_input": [], "pending_signal": null}
                        — or —
                        {"ack": true, "pending_input": [{...}], "pending_signal": "SIGINT"}
```

The relay writes any `pending_input` items to Claude's stdin. When Claude is idle (no events to POST), the relay sends periodic heartbeats (every 2s) to poll for pending input.

**Why this pattern:**
- No port binding in container (security + simplicity)
- Single HTTP connection
- Backpressure-aware (relay polls when idle)
- No firewall/networking setup

**File:** `backend/agents/services/comms.py` — builds piggyback responses. `backend/agents/views.py` — `/agents/stream` endpoint.

### Context Injection via Piggyback

The piggyback channel can deliver structured context updates — not just user messages. Claude is trained to treat `<system-reminder>` tags as authoritative system-level context. By wrapping structured information in these tags and delivering via `pending_input`, the backend can inject context mid-session without interrupting the agent's workflow.

**Use cases:**

| Injection | Trigger | Content |
|-----------|---------|---------|
| Instruction update | `update_agent_instructions` mutation | "Your instructions were updated. Re-read CLAUDE.md." |
| Secret availability | `set_secret` / `delete_secret` mutation | "New secret available: `KEY_NAME`. Access via `$KEY_NAME`." |
| Teammate status | Agent status change broadcast | "Teammate status: backend=running, qa=idle, frontend=stopped" |
| Tool/MCP changes | MCP config update + restart | "MCP server `playwright` added. Available after restart." |
| Scope change | Task reassignment | "New task assigned: [description]" with context |

**Format:** Deliver as a user-role message with content wrapped in `<system-reminder>` tags. Claude treats these as system-level context rather than conversational input — it processes the information without treating it as a user question requiring a response.

**Not yet implemented.** Currently only user messages and tool_results flow through `pending_input`. Context injection is a future enhancement that leverages the existing transport.

## Event Processing

### Event Types

| Event | Source | Content |
|-------|--------|---------|
| `system/init` | Claude | tools, mcp_servers, model, version. Fires at session start. |
| `system/process_exit` | Relay (synthetic) | exit_code, stderr. Fires when Claude process exits. |
| `assistant` | Claude | message.content[] with text and/or tool_use parts. 1 part per event. |
| `user` | Claude | message.content[] with tool_result parts. |
| `result` | Claude | Cumulative cost/usage/duration. Fires after each turn. |

### Event Processing Logic

**File:** `backend/agents/services/stream.py` — `process_stream_events()`

Each event type routes to a handler:

| Event | Handler | Action |
|-------|---------|--------|
| `system/init` | `_handle_system` | Upsert `agent.capabilities`, update `session_id` |
| `system/process_exit` | `_handle_system` | Set `agent.status` to stopped (exit 0) or error (exit != 0) |
| `assistant` | `_handle_assistant` | Get-or-create Message by `message_id`, APPEND parts, route interagent messages, route task operations, broadcast |
| `user` | `_handle_user` | Create Message by event `uuid` (idempotent), store tool_result parts |
| `result` | `_handle_result` | Create SessionResult (per-turn snapshot), update `agent.session_cost_usd`, mark agent idle |

### Content Part Accumulation (Streaming Callbacks)

**Critical:** Assistant events carry exactly 1 content part each with the same `message.id`. Parts arrive incrementally:

```
assistant {message.id: "msg_A", content: [{type: "text"}]}          ← 1 part
assistant {message.id: "msg_A", content: [{type: "tool_use"}]}      ← 1 part
assistant {message.id: "msg_A", content: [{type: "tool_use"}]}      ← 1 part (parallel)
user      {content: [{tool_use_id: "toolu_X", type: "tool_result"}]}
assistant {message.id: "msg_B", content: [{type: "text"}]}          ← new turn
```

The backend must **APPEND** parts to the Message, not replace. Same pattern as the Anthropic API streaming and Crush's AppendContent().

### Turn Lifecycle

```
system/init (session start)
  → assistant event (text part)           ← status: running
  → assistant event (tool_use part)
  → user event (tool_result)
  → assistant event (text part, new msg)
  → result event                          ← status: idle, cost updated
  ...
  → system/process_exit (Claude exits)    ← status: stopped or error
```

## Control Plane Patterns

### MCP Coordination Tools

Agents use MCP tools from `abox-coord` for all coordination. These are real tool calls that go through the MCP coordination server mounted at `/mcp`. No hooks, no file-based config, no stream observation needed.

Tools: `teammate_message`, `teammate_broadcast`, `teammate_spawn`, `task_add`, `task_claim`, `task_complete`, `task_list`, `team_status`.

## Distributed Bridge

### The Gap

Claude Code's file-based team system assumes all agents share a filesystem. In Agentobox, each agent runs in a separate container. When Agent A calls `SendMessage` targeting Agent B, Claude writes to a local inbox file that Agent B never sees.

### SendMessage Routing

```
Agent A calls SendMessage(recipient="agent-b", content="hello")
  ├─ Claude writes to local inbox file (harmless no-op)
  ├─ assistant event with SendMessage tool_use flows to backend via relay
  ├─ stream.py → _handle_assistant → route_inter_agent_messages()
  │   ├─ Extracts recipient + content from tool_use input
  │   ├─ Finds target Agent by name in same project
  │   └─ Formats as stream-json user input, atomically enqueues in target.pending_input
  ├─ Target relay picks up pending_input in next piggyback response
  └─ Relay writes to Claude's stdin → Agent B receives message as a user turn
```

**File:** `backend/agents/services/interagent.py` — `route_inter_agent_messages()`

### Message Types

| Type | Behavior |
|------|----------|
| `message` | Direct message to named recipient |
| `broadcast` | Sent to all non-stopped agents in project |
| `shutdown_request` | Direct message requesting agent shutdown |
| `shutdown_response` | Broadcast (no explicit recipient) |
| `plan_approval_response` | Direct message |

### Atomic Enqueue

Messages are appended to `pending_input` under a database row lock (`select_for_update()`) to prevent concurrent clobber. If the target agent is idle, its status is set to running.

## Data Model

**File:** `backend/agents/models.py`

### Agent

| Field | Purpose |
|-------|---------|
| `status` | Lifecycle: deploying → idle → running → stopped/error |
| `team_name` | Claude Code team namespace |
| `parent_session_id` | Team coordination key (project UUID) |
| `session_id` | Current Claude session (from system/init) |
| `capabilities` | Tools, MCP servers, model, version (from system/init) |
| `pending_input` | Queue of stream-json messages for relay piggyback |
| `pending_signal` | Queued signal (e.g., "SIGINT", "restart", "clear") for relay |
| `relay_token` | Auth token for relay → backend |
| `last_heartbeat_at` | Relay health inference (stale > 10s = down) |
| `session_cost_usd` | Running total from SessionResult |
| `config_snapshot` | Saved creation config for restart |
| `mcp_servers` | MCP server config dict |
| `workspace_path` | Host path bind-mounted into container |
| `volume_mounts` | Explicit volume mount list |
| `instructions` | Role instructions injected into CLAUDE.md |
| `role` | "lead" or "worker" |

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
| `stop_reason` | "end_turn", "tool_use", "max_tokens" |
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

### ProjectSecret

Fernet-encrypted secrets at project level. Scoped to specific agents via `scoped_agents` M2M, or delivered to all agents if unscoped.

## Claude Code Integration

### Native Team Tools

When teaming is active, Claude Code provides:

| Tool | Purpose | Who uses it |
|------|---------|-------------|
| `Task` (with `team_name`) | Spawn a new teammate | Lead |
| `SendMessage` | Direct message, broadcast, shutdown | All agents |
| `TaskCreate` / `TaskUpdate` | Create/update work items | All agents |
| `TaskList` / `TaskGet` | View tasks and status | All agents |

### File-Based Internals

Claude Code's team system is entirely file-based:

| Component | Path | Format |
|-----------|------|--------|
| Team config | `~/.claude/teams/{team}/config.json` | Member roster with agentId, name, model, cwd |
| Inboxes | `~/.claude/teams/{team}/inboxes/{agent}.json` | JSON array of message objects |
| Tasks | `~/.claude/tasks/{team}/` | `.lock` file + individual task files |

Key behaviors:
- `SendMessage` reads config.json to find the target, writes to the target's inbox file
- Receiving uses an internal polling loop (~1s interval) that reads the agent's own inbox file
- `--parent-session-id` is a namespace key — agents sharing the same value can communicate
- agentId format: `{name}@{team-name}`

### Task Tool: Two Modes

| | Subagent mode | Teammate mode |
|---|---|---|
| **Parameters** | `Task(prompt, subagent_type)` | `Task(prompt, subagent_type, team_name, name)` |
| **Lifecycle** | Ephemeral — blocks caller, returns result, dies | Persistent — runs independently until shutdown |
| **Communication** | Return value only | File-based mailbox (SendMessage) |

## Agent Provisioning

### Container Creation Flow

```
create_agent()
  ├─ Create Agent record (status: deploying)
  ├─ Resolve project secrets
  ├─ Broadcast agent update to dashboard
  ├─ Background: _provision_agent()
  │    ├─ runtime.create() with env vars + volume mounts
  │    ├─ Set up session persistence: symlink ~/.claude to volume-backed dir
  │    ├─ Write shared secrets env file + source from .bashrc
  │    ├─ provision_workspace()
  │    │    ├─ Write /home/agent/CLAUDE.md (project context, instructions, team roster)
  │    │    ├─ Write /home/agent/.claude/settings.json (apiKeyHelper)
  │    │    ├─ Write /home/agent/.mcp.json (abox-coord + user MCP servers with secrets)
  │    │    ├─ Write /home/agent/.claude.json (onboarding complete, key approved)
  │    │    ├─ Provision API key helper (tmpfs + script)
  │    │    └─ Provision scoped sudo (package-manager-only)
  │    ├─ Write /home/agent/.relay_env (relay environment variables)
  │    ├─ Signal s6-supervised relay: s6-svc -t /run/service/svc-relay
  │    └─ Spawn tmux session tailing relay logs (VNC debug visibility)
```

### Security

- **API key**: Delivered via `apiKeyHelper` in settings.json. Key stored in tmpfs (`/run/secrets/anthropic_key`, root:root 0400), read by a helper script. Not in shell environment.
- **Scoped sudo**: Agents can only `sudo apt-get/apt/dpkg`. Cannot `sudo cat`, `sudo bash`, etc.
- **CLAUDE.md security section**: Instructions to never output secrets, never read /run/secrets.
- **Relay auth**: Per-agent `relay_token` generated at provisioning, validated on every stream POST.
- **Secrets in MCP**: Project secrets injected into every MCP server's env block. MCP servers ignore keys they don't recognize.
- **BASH_ENV**: Set to `/mnt/abox-state/secrets/env` so non-interactive shells (Claude Code's Bash tool) have access to secrets.

### MCP Registry

Two types in `provision.py`:
- **Bundled**: Pre-installed in agent image (e.g., `computer-use` — node server at `/opt/mcp-servers/`)
- **npx**: Downloaded at runtime (e.g., `playwright` via `npx @playwright/mcp@latest`)

Each registry entry has: `command`, `args`, `compat` (image variants), and optional `instructions` (injected into CLAUDE.md).

## The MCP Coordination Server

The core new component — an MCP server that any agent runtime can consume. This is the path from "CC-only coordination" to "runtime-agnostic coordination."

### Implementation: FastMCP on Daphne

Built with [FastMCP](https://github.com/jlowin/fastmcp) (29k stars, v3.0.0, Feb 2026). Mounted alongside Django on the existing Daphne ASGI server at `/mcp`. No separate process, no bridge library, no extra dependencies beyond `fastmcp`.

**Why FastMCP over django-mcp-server:** `django-mcp-server` is pre-1.0, single-maintainer (last commit Oct 2025), with open bugs (406 errors on WSGI, 100% CPU under Gunicorn). FastMCP is the production-grade MCP SDK that all Django wrappers build on anyway.

**ASGI mounting:**

```python
# asgi.py
from django.core.asgi import get_asgi_application
from agents.services.mcp_coord import mcp

django_app = get_asgi_application()

async def application(scope, receive, send):
    if scope["path"].startswith("/mcp"):
        await mcp_app.asgi_app(scope, receive, send)
    else:
        await django_app(scope, receive, send)
```

**Agent `.mcp.json` config** (Claude Code natively supports HTTP MCP):

```json
{
  "abox-coord": {
    "type": "http",
    "url": "http://backend:8000/mcp",
    "headers": {
      "Authorization": "Bearer ${RELAY_AUTH_TOKEN}"
    }
  }
}
```

No local MCP process in the container. No `mcp-remote`. Claude Code connects directly via native HTTP MCP transport using the `relay_token` the agent already has.

```
Agent Container                          Django Backend (Daphne)
┌──────────────────────┐                ┌──────────────────────┐
│ Claude Code          │                │                      │
│   ├─ relay (events)  │── HTTP POST ──→│ /agents/stream       │
│   └─ MCP (coord)     │── HTTP ───────→│ /mcp                 │
│       (native HTTP   │                │   FastMCP            │
│        transport)    │                │   → Django services   │
└──────────────────────┘                └──────────────────────┘
```

### Tool Surface

| Tool | Purpose |
|------|---------|
| `team_create` | Create a team namespace |
| `teammate_spawn` | Deploy a new agent container |
| `teammate_message` | Send a direct message to a teammate |
| `teammate_broadcast` | Message all teammates |
| `task_add` | Create a task |
| `task_claim` | Claim a task for execution |
| `task_complete` | Mark a task done |
| `task_list` | List tasks with status |
| `team_status` | Fleet overview (statuses, costs, last activity) |

Tools are decorated functions that call existing Django services directly — no GraphQL middleman:

```python
from fastmcp import FastMCP

mcp = FastMCP("agentobox")

@mcp.tool()
async def teammate_message(recipient: str, content: str) -> dict:
    """Send a message to a teammate by name."""
    # Calls _deliver_to_stdin() from interagent.py directly
    ...

@mcp.tool()
async def teammate_spawn(name: str, instructions: str, model: str = "claude-sonnet-4-5-20250929") -> dict:
    """Deploy a new agent container as a teammate."""
    # Calls create_agent() from lifecycle.py directly
    ...

@mcp.tool()
async def team_status() -> dict:
    """Fleet overview: agent statuses, costs, last activity."""
    # Queries Agent model directly
    ...
```

### Auth

Bearer token auth using the same `relay_token` generated at provisioning. Each tool calls `_authenticate()` which extracts the Bearer token from HTTP headers via `get_http_headers()` and looks up the Agent by `relay_token`. Same token the relay uses for stream POSTs — no new auth mechanism.

## Key Services

### lifecycle.py

Agent lifecycle management.

| Function | Purpose |
|----------|---------|
| `create_agent()` | Create agent record, resolve secrets, provision container in background |
| `kill_agent()` | Terminate container, mark stopped |
| `remove_agent()` | Delete agent record permanently |
| `hard_restart_agent()` | Terminate + re-provision using saved `config_snapshot`, preserve session via `--resume` |

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

Inter-agent message delivery.

| Function | Purpose |
|----------|---------|
| `_deliver_to_stdin()` | Format team message as stream-json input, atomically enqueue in pending_input |
| `_handle_broadcast()` | Deliver message to all teammates in the project |
| `_atomic_enqueue()` | Append to pending_input under row lock |

### provision.py

Workspace setup.

| Function | Purpose |
|----------|---------|
| `provision_workspace()` | Write CLAUDE.md, settings.json, .mcp.json, .claude.json, security hardening |
| `_build_claude_md()` | Generate agent CLAUDE.md with project context, instructions, team roster |
| `_build_settings_json()` | Generate settings with apiKeyHelper |
| `_build_mcp_json()` | Generate .mcp.json with abox-coord + user MCP servers |
| `push_secrets_to_agent()` | Hot-reload secrets on running agent |

### comms.py

Message persistence and inter-agent delivery. Builds piggyback responses for relay.

### broadcast.py

WebSocket push to dashboard via GraphQL subscriptions.

### feed_transform.py

Transforms stream events and lifecycle events into `FeedItem` objects for the dashboard.

## Known Issues

1. **Agent state drift** — Agent shows "running" but relay is down. `last_heartbeat_at` stale detection exists (>10s = down) but reconciliation may not fire consistently. Needs `reconcile.py` to run reliably.

2. **Message delivery not guaranteed** — `pending_input` piggyback has no delivery confirmation. If the relay misses a response (network blip, timeout), the message is lost. Backend clears `pending_input` after including it in a response. No retry queue.

3. **Feed scroll refinements** — Recent commits (`36f1d44`, `3c18de5`, `41793d2`) stabilized scroll-to-bottom with height-based approach + pinned-state tracking. Stable but may need tuning for edge cases (long tool outputs, rapid message bursts).

## Roadmap

1. ~~**MCP coordination server**~~ — Done. `backend/agents/services/mcp_coord.py` mounted at `/mcp`.
2. ~~**Remove old patterns**~~ — Done. Removed PreToolUse hooks, file-based team config, stream observation routing.
3. **Reliability fixes** — Heartbeat reconciliation, message delivery guarantees (retry queue for pending_input)
4. **Feed/UI stabilization** — Edge case scroll fixes, performance with large feeds
5. **Casebase** — Session storage + retrieval for institutional memory (from FOUNDATIONS.md open questions)

## File Reference

| File | Role |
|------|------|
| `backend/agents/models.py` | Agent, Message, SessionResult, AgentTask, AgentEvent, ProjectSecret models |
| `backend/agents/services/lifecycle.py` | create_agent, kill_agent, remove_agent, hard_restart_agent |
| `backend/agents/services/stream.py` | Stream event processing pipeline |
| `backend/agents/services/interagent.py` | Inter-agent message delivery |
| `backend/agents/services/provision.py` | Workspace setup, settings, CLAUDE.md, MCP registry |
| `backend/agents/services/comms.py` | Message persistence + piggyback response building |
| `backend/agents/services/broadcast.py` | WebSocket push to dashboard |
| `backend/agents/services/feed_transform.py` | Stream event → FeedItem transform |
| `backend/agents/services/media.py` | S3 image externalization from base64 |
| `backend/agents/services/reconcile.py` | Agent state reconciliation |
| `backend/agents/services/secrets.py` | Secret encryption/decryption |
| `backend/agents/views.py` | Relay stream endpoint + file uploads |
| `backend/agents/services/mcp_coord.py` | MCP coordination server (teammate, task, team tools) |
| `backend/agents/runtimes/base.py` | Runtime protocol (create, terminate, exec, write_file) |
| `backend/agents/runtimes/docker.py` | Docker runtime implementation |
| `backend/agents/runtimes/modal.py` | Modal runtime implementation |
| `agent/rootfs/opt/abox/relay.py` | In-container relay process |

## Archived Docs

Previous architectural iterations are preserved in `docs/archive/` for historical reference:

- `V2-REDESIGN.md` — V2 relay/stream redesign spec
- `V3-ARCHITECTURE.md` — Multi-layer gateway architecture (not implemented)
- `V4-ARCHITECTURE.md` — OpenClaw runtime research + strategic direction
- `LIFT-MAP.md` — Implementation sequencing (superseded by Roadmap above)
