# AgentBox Implementation Roadmap

Living document tracking architecture decisions, completed work, and next steps.

## Architecture (current)

```
User (CLI / future UI)
  |
  +-- Agento (orchestrator)
  |     Claude Code + agent-manager MCP
  |     Text-only coordinator (no desktop access)
  |     Receives events via tmux injection (tagged @abox:e:XXXX)
  |     |
  |     +-- Worker A                +-- Worker B
  |     |   Claude Code             |   Claude Code
  |     |   computer-use MCP        |   computer-use MCP
  |     |   (fixed: own desktop)    |   (fixed: own desktop)
  |     |   Container + VNC         |   Container + VNC
  |     |                           |
  |     +-- Worker C ...
  |
  +-- Callback Server (port 9900)
  |     POST /event — unified state ingestion from all agents
  |     GET /events — query events by agent
  |     Batched event injection into Agento's tmux session
  |     Routes completion events to wait_for_completion waiters
  |
  +-- Event Store (in-memory)
        Capped per-agent (50 events)
        Persistent storage deferred to Dashboard phase
```

## Three Layers / Intelligent Teaming

Each layer handles what it can and escalates what it can't.

| Layer | Handles | Escalates to |
|-------|---------|--------------|
| Worker | Task execution, desktop interaction | Agento (blocked, completion) |
| Agento | Agent lifecycle, coordination, monitoring | User (auth, decisions, unresolvable blocks) |
| User | Strategic direction, credentials, approvals | N/A |

**Signal flow:**
- Upward: HTTP POST to callback server (port 9900) with `{agent, state, msg}`
- Downward: MCP tools (send_keys, create_agent, etc.)

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

### Phase 6b: Batched Event Injection
- [x] Callback server injects events into Agento's local tmux session via `localTmuxSendKeys`
- [x] Batching: `completed` events buffered (5s window / 10 max), deduplicated per agent on flush
- [x] Immediate injection for `blocked` and `dead` (bypass buffer, flush pending first)
- [x] `working` and `idle` events filtered out — not injected, visible via `list_agents`
- [x] Tagged format: `@abox:e:XXXX [agent] state: msg` — nonce prevents collision with user messages
- [x] `ABOX_EVENT_TAG` env var for production; random 4-char hex fallback for local dev
- [x] Agento CLAUDE.md documents event stream format, noop (`{}`), and handling per state
- [x] Agento excluded from self-injection (own Stop hook events not injected back)
- [x] Agento excluded from `recoverAgents` (container name `abox-agento` no longer tracked as worker)
- [x] Agento entrypoint auto-accepts bypass prompt (wait + Down + Enter, same as worker bootstrap)
- [x] `dockerRun` removes existing stopped containers before `docker run` (prevents name conflicts)
- [x] Kasm default desktop icons (Downloads/Uploads) removed in worker Dockerfile

## Next Up

### Phase 7: Dashboard
Web UI for observation and control.

- [ ] Next.js app with noVNC for live desktop streams
- [ ] Grid view: all agent thumbnails with live state
- [ ] Agent sprites: diffusion-generated pixel art depicting current activity (msg → sprite)
  - "reading documentation" → agent reading a book
  - "browsing google.com" → agent on laptop
  - "bored" → agent yawning
  - Sprite cache by semantic similarity to avoid regenerating per-event
- [ ] Detail view: desktop + terminal + chat
- [ ] User can take control (mouse/keyboard passthrough)
- [ ] Event feed with state filtering
- [ ] Chat with Agento or any worker
- [ ] Persistent event storage (SQLite) for historical analysis

### Future: Deployment Backends
- [ ] K8s backend for agent-manager (kubectl / k8s API)
- [ ] Modal backend (Modal sandboxes)
- [ ] Backend interface abstraction in agent-manager

## Dropped

### ~~Phase 7: Remote Computer-Use~~
Dropped. Agento is a text-only coordinator — it doesn't need to see or control worker desktops. It monitors workers via state events (`list_agents`) and reads terminal output (`read_output`) for drill-down. Screenshots and remote desktop add complexity without clear value for coordination.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Claude Code inside container | Bash/files run in isolation, not on host |
| Stop hook for completion | Mechanical, not behavioral — agent can't forget |
| Callback server as event bus | Universal upward signal path for all layers via `POST /event` |
| tmux send-keys for downward messages | Same pattern at every layer |
| send_keys over send_message | Honest about what it is (tmux wrapper), atomic actions, no auto-Enter |
| create_agent = full bootstrap | One call returns ready worker — mechanical, not behavioral |
| Workers are long-lived | Reuse for multiple tasks, kill only when no longer needed |
| Agent-manager is worker-only | Doesn't track Agento; User->Agento is a separate channel |
| Agento in container | Inspectable, testable, same tooling as workers |
| Agento is text-only coordinator | No screenshots, no remote desktop — monitors via events + read_output |
| No role param in create_agent | Role is implicit in CLAUDE.md + .mcp.json config |
| API key pre-seed in .claude.json | Skip onboarding without human intervention |
| VNC-only port mapping | MCP is internal (localhost:8808), no host exposure needed |
| 4-field event schema | `{ts, agent, state, msg}` — minimal surface, free-form msg for LLMs |
| Agents own their msg | System sets state mechanically; agents update msg semantically ("reading docs", "bored"). Two consumers: LLMs for coordination, diffusion models for sprite visualization |
| Agento is a dispatcher | Tools scoped via permissions.deny — no wait_for_completion, no polling. Dispatch and return to user. Events come to Agento, not the other way around |
| In-memory event store | Events are ephemeral coordination signals; persist when dashboard needs history |
| Batched event injection | Reduces Agento turn count — batch completions, inject blocked/dead immediately |
| Tagged event messages | `@abox:e:XXXX` prefix with session nonce — UI can filter events from user messages |
| Events as tmux user messages | Only external injection point into running Claude Code — no API for system messages |
