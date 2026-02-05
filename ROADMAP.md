# AgentBox Implementation Roadmap

Living document tracking architecture decisions, completed work, and next steps.

## Architecture (current)

```
Dashboard (Next.js :3000)              User (CLI)
  |                                       |
  +-- polls/SSE ----+                     +-- MCP tools (stdio)
                     |                    |
                     v                    v
               Hono Server (:9900)  <--  MCP Server (HTTP client)
               /api/v1/*                 fetch() calls to Hono
               |
               +-- Agento LLM (per-project, server-side)
               |     Anthropic SDK + tool-use loop
               |     Tools: create_agent, kill_agent, send_keys, read_output, list_agents
               |     Conversation history keyed by projectId
               |
               +-- Agent lifecycle (Docker + tmux)
               |     createAgentCore, killAgentCore, sendKeysCore, ...
               |
               +-- State (in-memory, SQLite planned)
               |     agents Map, eventStore, chatStore, waiters
               |
               +-- Worker containers
                     Worker A              Worker B
                     Claude Code           Claude Code
                     computer-use MCP      computer-use MCP
                     Container + VNC       Container + VNC
```

**Agento** is a server-side LLM orchestrator (not a container). It's an Anthropic API client
with tool-calling that manages worker agents via the same REST API the dashboard uses.
Each project gets its own conversation history. In production, this could be swapped for
any LLM with tool-calling (LangChain, LiteLLM, etc.) — it's isolated to one file (`services/agento.ts`).

**MCP Server** is now a stateless HTTP client. All state lives in the Hono server.
MCP tools call `fetch()` to `/api/v1/*` endpoints. This means the Hono server must
be running before the MCP server starts.

## Three Layers / Intelligent Teaming

Each layer handles what it can and escalates what it can't.

| Layer | Handles | Escalates to |
|-------|---------|--------------|
| Worker | Task execution, desktop interaction | Agento (blocked, completion) |
| Agento | Agent lifecycle, coordination, monitoring | User (auth, decisions, unresolvable blocks) |
| User | Strategic direction, credentials, approvals | N/A |

**Signal flow:**
- Upward: HTTP POST to Hono server (`/api/v1/projects/:id/event`) with `{agent, state, msg}`
- Downward: REST API calls (create_agent, send_keys, etc.) or MCP tools wrapping same
- Lateral: Dashboard polls or SSE from `/api/v1/projects/:id/stream` (SSE planned)

## Event System (implemented)

### Schema

```json
{"ts": "2026-02-02T10:30:00Z", "agent": "scout", "state": "working", "msg": "Go to google.com and search for..."}
```

4 fields. `state` is a structural enum: `idle`, `working`, `completed`, `blocked`, `dead`. `msg` is free-form text (max 100 chars) — semantic, interpretable by LLMs for coordination and by diffusion models for visualization (e.g. "reading documentation" → pixel art of agent reading a book).

### State Machine

| State | Set by | Mechanism |
|-------|--------|-----------|
| `idle` | System | After creation. Agent may set personality msg ("waiting", "bored") |
| `working` | System + Agent | `send_keys` sets initial state. Agent updates msg as activity changes ("reading docs", "browsing google.com") |
| `completed` | System | Stop hook fires → `POST /event {state: "completed"}` |
| `blocked` | Agent | Worker curls `/event` with reason ("need GitHub credentials") |
| `dead` | System | `tmuxHasSession` fails — msg is last line from terminal |

System sets the baseline transitions mechanically. Agents update msg to describe what they're doing — this feeds both the orchestrator (coordination) and the dashboard (visualization via diffusion-generated sprites).

### Completion Signaling

```
Agent finishes task
  -> Claude Code fires Stop hook
  -> curl POST http://AGENTO_HOSTNAME:9900/event {"agent":"<name>","state":"completed","msg":""}
  -> Callback server updates agent status + pushes event
  -> wait_for_completion resolves
```

**Config written during create_agent:**
- `~/.claude/settings.json` — Stop hook with curl callback to `/event`
- `~/.claude.json` — API key pre-approval, skip onboarding, dark theme
- `$WORKSPACE/CLAUDE.md` — Agent instructions (templated with name + hostname for blocked signaling)
- `$WORKSPACE/.mcp.json` — MCP server config

## Computer-Use MCP

| Variant | Target | Used by |
|---------|--------|---------|
| computer-use (fixed) | localhost:8808 (own desktop) | Workers |

Agento is a text-only coordinator. It monitors workers via state events and `read_output`, not screenshots or desktop interaction.

## Completed

### Phase 1: Container Image
- [x] Kasm desktop base (Ubuntu Focal + XFCE + KasmVNC)
- [x] Google Chrome installed (wrapped with --no-sandbox)
- [x] Node.js 20 + Claude Code CLI
- [x] computer-use MCP server (nut-js, jimp, HTTP transport)
- [x] Entrypoint script starts VNC + MCP server

### Phase 2: Agent Manager MCP
- [x] create_agent — full bootstrap: container, config, Claude Code, bypass, ready
- [x] kill_agent — stop container, free ports, clean up
- [x] send_keys — atomic tmux actions (text + key sequences)
- [x] read_output — capture tmux buffer
- [x] list_agents — enumerate agents with status, last event, ports, uptime
- [x] wait_for_output — poll for specific text in terminal (case-insensitive)
- [x] wait_for_completion — block until Stop hook callback

### Phase 3: In-Container Claude Code
- [x] Claude Code runs inside container (not on host)
- [x] All tmux commands route through docker exec
- [x] API key passed via env var, pre-approved in .claude.json
- [x] Onboarding skipped via hasCompletedOnboarding + theme preset
- [x] Agent recovery on MCP restart (scan docker ps for abox-* containers)
- [x] API key sanitized from error messages

### Phase 4: Completion Signaling
- [x] HTTP callback server on port 9900
- [x] Stop hook written to ~/.claude/settings.json during create_agent
- [x] wait_for_completion tool resolves on callback
- [x] Agent status updated to "completed" with timestamp

### Phase 5: Agento as Container
- [x] Single Dockerfile with ABOX_ROLE build arg (worker vs agento)
- [x] Docker CLI installed in agento image for container management
- [x] agent-manager MCP built inside agento image
- [x] CLAUDE.md for Agento: orchestrator instructions, worker lifecycle
- [x] .mcp.json for Agento: agent-manager MCP (stdio) + computer-use MCP (HTTP)
- [x] Docker network `agentobox` for inter-container communication
- [x] Callback hostname parameterized via ABOX_AGENTO_HOSTNAME env var
- [x] start-agento.sh launch script (builds both images, creates network, starts container)
- [x] docker-compose.yml updated with network + agento service
- [x] Docker socket mounted for container management
- [x] Entrypoint agento branch: config injection + Claude Code tmux launch
- [x] Verified: Agento creates workers, sends tasks, wait_for_completion works over Docker network

### Phase 5b: Slim Agento Image
- [x] Separate `docker/Dockerfile.agento` — node:20-slim (~498MB vs 3.66GB)
- [x] `docker/agento-entrypoint.sh` — terminal-only, tmux + Claude Code
- [x] Worker Dockerfile cleaned (no ABOX_ROLE conditionals)
- [x] `start-agento.sh` + `docker-compose.yml` updated

### Phase 5c: Dynamic Auth
- [x] `AuthConfig` interface + `resolveAuth()` + `claudeConfigJson()` helpers
- [x] `create_agent` accepts optional `api_key` / `oauth_token` per-agent overrides
- [x] Workers inherit Agento's auth by default, explicit params override
- [x] OAuth mode (`CLAUDE_CODE_OAUTH_TOKEN`) skips `customApiKeyResponses`
- [x] Both env vars forwarded through all layers (start script, compose, docker run)
- [x] Secrets sanitized in error messages (both API key and OAuth token)

### Phase 5d: Atomic Bootstrap & send_keys
- [x] `send_message` replaced with `send_keys` — ordered list of text/key actions, no auto-Enter
- [x] `create_agent` handles full bootstrap: port wait, config write, Claude Code launch, bypass accept, interactive ready
- [x] Returns `{ready: true}` only when worker is ready for tasks — one call instead of five
- [x] Health check uses TCP port probe instead of HTTP to nonexistent path
- [x] `waitForText` helper with case-insensitive matching
- [x] Workers are long-lived — no auto-kill after tasks, reusable for multiple tasks
- [x] Agento CLAUDE.md simplified to 4-step lifecycle (create, send, wait, read)
- [x] Parallel `create_agent` calls supported — each is independent async

### Phase 6: Event System
- [x] Unified `POST /event` endpoint replaces `/done` — accepts `{agent, state, msg}`
- [x] 5 agent states: `idle`, `working`, `completed`, `blocked`, `dead`
- [x] `send_keys` automatically sets worker to `working` with task text as msg
- [x] Stop hook POSTs `{state: "completed"}` — mechanical, not behavioral
- [x] Workers self-report status updates — msg describes current activity for coordination + visualization
- [x] `list_agents` detects dead sessions and captures last terminal line as diagnostic
- [x] In-memory event store (capped 50 per agent) with `GET /events?agent=X`
- [x] `AgentEvent` type: `{ts, agent, state, msg}` — 4 fields, flat JSON
- [x] `list_agents` includes `lastEvent` msg — single status view for Agento
- [x] Worker CLAUDE.md templated with agent name + hostname for blocked signaling
- [x] Agento CLAUDE.md documents state system + dispatcher role (not babysitter)
- [x] `screenshot_terminal` removed — Agento is text-only coordinator
- [x] Agento tool surface scoped via `permissions.deny`: `wait_for_completion`, `wait_for_output`, `screenshot_terminal` blocked
- [x] Agento entrypoint Stop hook updated to POST `/event`

### Phase 6b: Batched Event Injection (deprecated)
- [x] Callback server injects events into Agento's local tmux session via `localTmuxSendKeys`
- [x] Batching: `completed` events buffered (5s window / 10 max), deduplicated per agent on flush
- [x] Immediate injection for `blocked` and `dead` (bypass buffer, flush pending first)

*Note: tmux injection was removed in Phase 8a. Agento is now a server-side LLM orchestrator,
not a container with a tmux session. Events reach Agento through the REST API.*

### Phase 7: Dashboard (initial)
- [x] Next.js app at `:3000` with neo-brutalism / Rose Pine Moon aesthetic
- [x] Live VNC desktop streams via noVNC embedded iframes
- [x] Agent grid view with live state indicators and status badges
- [x] Command panel with Agento chat (message input + history)
- [x] Agent roster with status, task, and VNC port display
- [x] Zustand stores for agents, events, and chat state
- [x] Polling hooks for agents, events, and chat (3s interval)
- [x] `API_V1` constant for versioned API endpoints

### Phase 8a: Backend — Hono Server + REST API
- [x] Standalone `server/` package (Hono + @hono/node-server)
- [x] All state centralized in Hono server (agents Map, eventStore, chatStore, waiters)
- [x] Versioned REST API under `/api/v1/` with full CRUD for agents, events, chat
- [x] Backward-compat aliases for agent container callbacks (`POST /event`, `GET /agents`)
- [x] Agento as server-side LLM orchestrator (`services/agento.ts`) — not a container
- [x] `AbortSignal` support on long-poll endpoints (wait-completion, wait-output)
- [x] Agent lifecycle services lifted from MCP (docker, tmux, ports utils)
- [x] MCP server converted to stateless HTTP client (fetch to Hono)
- [x] MCP `main.ts` retries Hono connection with backoff on startup
- [x] Dashboard hooks switched to `API_V1` URLs
- [x] Dropped tmux injection (`localTmuxSendKeys`, `injectIntoAgento`, batched event buffer)
- [x] All 3 packages build clean (server, MCP, dashboard)

## Next Up

### Phase 8b: Async Docker
Unblock the event loop. Container operations no longer freeze the server.

- [ ] Replace `execFileSync` with promisified `execFile` in `server/src/utils/docker.ts`
- [ ] Convert tmux utils to async in `server/src/utils/tmux.ts`
- [ ] Update all callers in services layer (`await` on docker/tmux calls)
- [ ] Parallel agent creation without blocking

### Phase 8c: SSE + EventBus
Single SSE stream replaces 3 polling hooks. Real-time updates.

- [ ] `EventBus` class (EventEmitter) in `server/src/bus.ts`
- [ ] `GET /api/v1/projects/:id/stream` — SSE endpoint with heartbeat
- [ ] Services emit events on agent/event/chat changes
- [ ] Dashboard `useSSE` hook replaces 3 polling hooks
- [ ] Delete `use-agent-poller.ts`, `use-event-poller.ts`, `use-chat-poller.ts`

### Phase 8d: Drizzle + SQLite
Persist state across server restarts.

- [ ] `drizzle-orm` + `better-sqlite3` with WAL mode
- [ ] Schema: projects, agents, events, messages, conversations
- [ ] Replace in-memory Maps in `state.ts` with Drizzle queries
- [ ] Startup recovery from SQLite + Docker cross-reference
- [ ] Conversation history persisted for Agento LLM

### Phase 8e: MCP Consolidation + Cleanup
Embed MCP directly in Hono. Eliminate the separate `mcps/agent-manager/` package.

- [ ] Add `@modelcontextprotocol/sdk` to server package
- [ ] MCP tool definitions call service functions directly (no HTTP hop)
- [ ] Streamable HTTP transport at `/mcp` endpoint
- [ ] Update `.mcp.json` templates to use HTTP transport URL
- [ ] Delete `mcps/agent-manager/` entirely
- [ ] Update agent container Dockerfiles (no MCP binary to build/install)
- [ ] Update backward-compat aliases to versioned URLs in container templates
- [ ] `GET /api/v1/health` endpoint

### Dashboard Enhancements
- [ ] Agent sprites: diffusion-generated pixel art depicting current activity (msg → sprite)
- [ ] Detail view: full-size desktop + terminal + chat per agent
- [ ] User can take control (mouse/keyboard passthrough via noVNC)
- [ ] Event feed with state filtering
- [ ] Chat routing: talk to Agento or any worker directly

### Future: Deployment Backends
- [ ] K8s backend for agent lifecycle (kubectl / k8s API)
- [ ] Modal backend (Modal sandboxes)
- [ ] Backend interface abstraction in server services

## Dropped

### ~~Remote Computer-Use for Agento~~
Dropped. Agento is a text-only coordinator — it doesn't need to see or control worker desktops. It monitors workers via state events (`list_agents`) and reads terminal output (`read_output`) for drill-down.

### ~~Agento as Container~~
Dropped in Phase 8a. Agento is now a server-side LLM orchestrator (Anthropic SDK + tool-use loop) running inside the Hono server process. Each project gets its own conversation history. In production, swappable for any LLM with tool-calling (LangChain, LiteLLM, etc.) — isolated to `services/agento.ts`. This eliminated tmux injection, batched event buffering, and the Agento container image.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Claude Code inside container | Bash/files run in isolation, not on host |
| Stop hook for completion | Mechanical, not behavioral — agent can't forget |
| Hono server owns all state | Single source of truth. No split-brain between processes |
| MCP as stateless HTTP client | Eliminates duplicate state. Will be folded into Hono entirely (Phase 8e) |
| Agento is server-side LLM | Not a container. Anthropic SDK + tool-use loop in `services/agento.ts`. Swappable for LangChain/LiteLLM |
| Versioned API (`/api/v1/`) | Clean contract. Backward-compat aliases for container hooks until Phase 8e |
| tmux send-keys for downward messages | Same pattern at every layer |
| send_keys over send_message | Honest about what it is (tmux wrapper), atomic actions, no auto-Enter |
| create_agent = full bootstrap | One call returns ready worker — mechanical, not behavioral |
| Workers are long-lived | Reuse for multiple tasks, kill only when no longer needed |
| No role param in create_agent | Role is implicit in CLAUDE.md + .mcp.json config |
| API key pre-seed in .claude.json | Skip onboarding without human intervention |
| VNC-only port mapping | MCP is internal (localhost:8808), no host exposure needed |
| 4-field event schema | `{ts, agent, state, msg}` — minimal surface, free-form msg for LLMs |
| Agents own their msg | System sets state mechanically; agents update msg semantically ("reading docs", "bored"). Two consumers: LLMs for coordination, diffusion models for sprite visualization |
| In-memory event store (for now) | Events are ephemeral coordination signals; SQLite persistence in Phase 8d |
| AbortSignal on long-polls | Clean up waiters when clients disconnect — no leaked promises |

## Env Vars

| Var | Default | Used by |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | (required) | server — Agento LLM |
| `ABOX_LLM_MODEL` | `claude-sonnet-4-20250514` | server — Agento LLM |
| `ABOX_SERVER_PORT` | `9900` | server — Hono listen port |
| `ABOX_SERVER_URL` | `http://localhost:9900` | MCP — server address (until Phase 8e) |
| `ABOX_AGENTO_HOSTNAME` | `host.docker.internal` | server — container networking |
| `ABOX_NETWORK` | `agentobox` | server — Docker network |
| `NEXT_PUBLIC_API_URL` | `http://localhost:9900` | dashboard — API base |
