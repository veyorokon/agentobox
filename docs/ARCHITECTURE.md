# Architecture

## System Overview

Agentobox is a platform for running teams of Claude Code agents in managed containers. The dashboard (Next.js) talks to the backend (Django + Strawberry GraphQL + Django Channels) over GraphQL queries/mutations/subscriptions. Each agent runs in a container with a relay process that bridges the Claude Code SDK to the backend over a persistent WebSocket. Agents coordinate via an MCP server mounted at `/mcp` on the backend.

```
 Dashboard (Next.js)                 Backend (Django/Daphne)
 ┌──────────────────┐               ┌────────────────────────────────┐
 │  Apollo Client   │──── GraphQL ──│  Strawberry schema             │
 │  (queries/subs)  │    (HTTP+WS)  │                                │
 │                  │               │  Django Channels (Redis)       │
 │  Zustand         │               │    ├─ /graphql (subscriptions) │
 │  (UI state)      │               │    ├─ /ws/relay/<id>/ (relay)  │
 └──────────────────┘               │    └─ /ws/vnc/<id>/   (VNC)   │
                                    │                                │
                                    │  /mcp (FastMCP HTTP)           │
                                    │                                │
                                    │  Postgres ◄── models/ORM       │
                                    │  Redis    ◄── Channels pub/sub │
                                    └──────────┬─────────────────────┘
                                               │
                        ┌──────────────────────┼──────────────────────┐
                        │ Agent Container      │                      │
                        │                      │ WS (relay↔backend)   │
                        │  relay.py ───────────┘                      │
                        │    │                                        │
                        │    └─── Claude Code SDK ─── Claude CLI      │
                        │                                             │
                        │  Xvfb + AwesomeWM + noVNC + Firefox         │
                        │  s6-overlay (process supervision)           │
                        └─────────────────────────────────────────────┘
```

## Agent Lifecycle

| Step | What happens | File |
|------|-------------|------|
| 1. `createAgent` mutation | Creates Agent row (status=`deploying`), spawns background task | `services/lifecycle.py` `create_agent()` |
| 2. Container provisioning | Runtime creates container, writes CLAUDE.md, `.mcp.json`, settings, secrets, API key to tmpfs | `services/lifecycle.py` `_provision_agent()`, `services/provision.py` |
| 3. Relay env written | `.relay_env` written with agent ID, token, model, team config | `services/lifecycle.py` `_provision_agent()` |
| 4. Agent marked IDLE | `relay_token` + `sandbox_id` saved to DB, s6 relay service signaled to start | `services/lifecycle.py` `_save_provisioned()` |
| 5. Relay connects | relay.py reads env, opens WS to `/ws/relay/<agent_id>/` with Bearer token | `agent/rootfs/opt/abox/relay.py` `WSTransport.connect()` |
| 6. SDK client starts | relay creates `ClaudeSDKClient`, spawns Claude CLI subprocess | `agent/rootfs/opt/abox/relay.py` `SDKRelay.run()` |
| 7. Events stream back | SDK messages forwarded as raw JSON dicts over WS to `RelayConsumer` | `consumers.py` `RelayConsumer.receive_json()` → `services/stream.py` |

On restart (`hard_restart_agent`), the old container is terminated, agent is reset to `deploying`, and a new container is provisioned with `--resume` using the previous `session_id`. On kill, the container is terminated and status set to `stopped`.

## Communication Architecture

Agents communicate via the **team** MCP server — a FastMCP HTTP app mounted at `/mcp` on the ASGI server (`config/asgi.py`). Auth is Bearer token per agent (`relay_token`). Tool schemas match Claude Code's native team tools; built-ins are disabled via `disallowedTools`.

| MCP Tool | Purpose |
|----------|---------|
| `send_message(type, content, recipient, summary)` | DM, broadcast, or shutdown request |
| `task_create(subject, description, active_form, metadata)` | Create a task |
| `task_update(task_id, status, owner, ...)` | Update task fields, claim, set dependencies |
| `task_get(task_id)` | Get full task details |
| `task_list()` | List all project tasks |
| `teammate_spawn(name, instructions, model)` | Create a new agent in the same project |
| `task_add(subject, description)` | Create a team task |
| `task_claim(task_id)` | Claim and start a task |
| `task_complete(task_id)` | Mark a task done |
| `task_list()` | List all project tasks |
| `team_status()` | List all active agents with status/cost |

**Message delivery flow:**

```
Agent calls MCP tool (e.g. teammate_message)
  → HTTP POST to /mcp (Bearer token auth)
    → mcp_coord.py looks up sender Agent by relay_token
      → interagent.py formats message as stream-json user input
        → Channels group_send to relay_{target_agent_id}
          → RelayConsumer forwards to target relay WS
            → relay.py writes to Claude stdin via SDK query()
```

No hooks are used for communication. The relay is a dumb pipe — it forwards raw dicts both ways.

## Event Processing

All events flow through `services/stream.py` `process_stream_event()`. The write path is deliberately simple: every event from the relay is one INSERT into `StreamEvent` (append-only log), one broadcast to dashboard subscribers, and optional side effects on the Agent model.

| Event type | Side effects |
|-----------|-------------|
| `assistant` | Set status to `running`, update `latest_snapshot` |
| `result` | Insert `SessionResult`, update cost/status/phase, create `TeamFeedItem`, recompute attention |
| `system` (init) | Store capabilities, session_id |
| `system` (status) | Update permission_mode, derive frontend mode |
| `system` (process_exit) | Set status to `stopped`/`error` |
| `stream_event` | Extract phase transitions (thinking, responding, tool-input, tool-use) |

**latest_snapshot** is a JSON field on Agent: `{"assistant": <event>, "result": <event>}`. New assistant events pop the result key; result events add it. Adapters read this at query time to extract display fields.

Raw events are stored verbatim — no filtering, no transformation. The relay forwards everything Claude Code outputs. New event types Anthropic adds are captured automatically.

## Structured Logging (Event Taxonomy)

All backend logging uses `structlog` with a `domain.action` naming convention enforced by architecture tests.

**Logger names** use the `abox.` prefix: `abox.relay`, `abox.stream`, `abox.comms`, `abox.lifecycle`, `abox.mcp`, `abox.broadcast`, `abox.feed`, `abox.graphql`. Runtimes use 3-level: `abox.runtime.docker`, `abox.runtime.modal`.

**Event names** follow `domain.action` or `domain.sub_action` format. The architecture test (`test_event_names_follow_taxonomy`) validates every event against a regex and a domain registry:

| Domain | Scope | Files |
|--------|-------|-------|
| `lifecycle` | Agent create, provision, restart, kill | `lifecycle.py`, `provision.py` |
| `relay` | WebSocket relay connection, events | `consumers.py` |
| `vnc` | VNC proxy connection lifecycle | `consumers.py` |
| `stream` | Stream event processing, plans | `stream.py` |
| `comms` | Message delivery, mode changes, signals | `comms.py` |
| `mcp` | MCP tool calls (send, task, spawn) | `mcp_coord.py` |
| `broadcast` | Channels group_send to subscribers | `broadcast.py` |
| `feed` | TeamFeedItem creation/broadcast | `feed.py` |
| `reconciler` | GDA reconciliation loop | `reconcile.py` |
| `runtime` | Container/sandbox operations | `runtimes/docker.py`, `runtimes/modal.py` |
| `callback` | Permission/hook callbacks from relay | `callbacks.py` |
| `graphql` | Query/mutation/subscription events | `mutations.py`, `subscriptions.py`, `views.py` |
| `auth` | Relay token authentication | `auth_relay.py` |

Adding a new domain requires adding it to `_VALID_DOMAINS` in `tests/test_architecture.py`. The full taxonomy spec is in `docs/drafts/event-taxonomy.md`.

## Adapters (Ports & Adapters)

`backend/agents/adapters/` implements the Ports and Adapters pattern. `AgentAdapter` is a Protocol (`base.py`) defining pure functions: `last_output()`, `live_action()`, `cost()`, `duration()`, `turns()`, `is_permission_request()`, `is_plan_proposal()`. `ClaudeCodeAdapter` (`claude_code.py`) implements this for Claude Code's stream-json format. Adapters have no DB access, no side effects, and never mutate the snapshot. The registry (`__init__.py`) maps `agent_type` strings to adapter instances — currently only `"claude-code"` is registered.

## Key Models

All in `backend/agents/models.py`:

| Model | Purpose |
|-------|---------|
| `Agent` | Container instance — status, config, latest_snapshot, materialized cost/phase/attention |
| `StreamEvent` | Append-only event log. One row per stream-json event. Source of truth. |
| `SessionResult` | Cost/usage snapshot per turn (from `result` events). One row per turn, not upserted. |
| `TeamFeedItem` | Curated dashboard feed entries. Flat union — every field on every row, null where N/A. |
| `AgentTask` | Team tasks created via MCP `task_add`. Synced from MCP calls, visible in dashboard. |
| `ProjectSecret` | Fernet-encrypted secrets at project level. Optional agent scoping via M2M. |
| `AgentFeedback` | User ratings/comments on agent sessions. |

## Frontend Data Layer

**Apollo Client** (`dashboard/lib/graphql/`):
- `hooks/use-agents.ts`: `useAgents()` (cache-only query), `useSetAgentMode()`, `useAcknowledgeAgent()` — all via `cache.modify`
- `hooks/use-feed.ts`: `useFeed()` (cache-only query), `useResolvePermission()`, `useResolvePlan()` — bridge hooks that update both FeedItem and Agent attention in cache
- `subscriptions/agents.ts`: `ON_AGENT_CHANGED` — fields: status, attention, mode, cost, phase, task, liveAction
- `subscriptions/feed.ts`: `ON_FEED_ITEM_CHANGED` — full feed item fields including permission/plan status

**Zustand** (`dashboard/lib/stores/`):
- `sidebar.ts`: UI state — panel visibility, tabs, expanded agents, search/filter, attention stepper
- `team.ts`: Composer recipients only (not agent data). Falls back to `team-lead` default.

Zero prop drilling: all components subscribe directly to hooks/stores. The page component (`app/p/[projectId]/page.tsx`) is a pure layout shell.

## Security & Secrets

Agent containers need secrets (API keys, CLI tokens, MCP credentials) but the agent process is inherently untrusted — prompt injection, malicious MCPs, or careless `echo $SECRET` could leak credentials. Three defense layers, each addressing a different attack surface:

### Layer 1: Secret File Mounts (protect at rest)

`build_api_key_files()` writes secrets to `/run/secrets/<name>` with 0600 root:root permissions. The provisioning flow handles both Docker and Modal via the runtime adapter.

**Blocks:** `docker inspect`, `/proc/1/environ`, cross-container access, agent user reading files directly.

### Layer 2: HTTP Proxy for Anthropic Key (protect in transit)

`svc-apiproxy` (`api-proxy.py`) runs on `localhost:9999`, reads the real key from `/run/secrets/proxy_key`, injects it into outbound requests to `api.anthropic.com`. The relay gets a placeholder key (`_PROXY_PLACEHOLDER_KEY`) that passes CLI validation but is worthless if leaked.

```
Claude CLI  →  ANTHROPIC_BASE_URL=http://localhost:9999
            →  api-proxy.py reads /run/secrets/proxy_key
            →  injects real Authorization header
            →  forwards to api.anthropic.com
```

**Blocks:** Everything in Layer 1, plus `echo $ANTHROPIC_API_KEY` prints the placeholder, `env | grep` shows nothing useful, process memory inspection of the relay.

| Component | Responsibility | File |
|-----------|---------------|------|
| Adapter (`claude_code/__init__.py`) | Decides WHAT secrets to provision, builds file specs and env content | Backend |
| Provisioning (`provision.py`) | Writes secrets to container filesystem, sets permissions | Backend |
| Lifecycle (`lifecycle.py`) | Orchestrates the provisioning sequence | Backend |
| API Proxy (`api-proxy.py`) | Intercepts Anthropic API calls, injects real key | Agent image |
| Relay (`relay.py`) | Redacts secrets from output stream before forwarding | Agent image |
| s6 services (`svc-*/run`) | Process isolation — each service has own user/env | Agent image |

### Layer 3: Output Stream Redaction (protect in output)

The relay (`relay.py`) is the single chokepoint — every event flows through `_send_event()` before reaching the backend WebSocket. A `_Redactor` class loads secret values from `/run/secrets/` and `/mnt/abox-state/secrets/env` at boot, then scrubs matching substrings from every outbound event dict (via JSON serialize → replace → deserialize).

**Blocks:** `echo $GITHUB_TOKEN` → `[REDACTED]` in dashboard, `env | grep TOKEN` → values redacted, `cat .env` → values redacted.

**Does not block (by design):** network exfiltration (process sends secret to external URL), base64-encoded secrets, secrets the relay can't read (root-only files).

This is a **UX safety net**, not a security boundary. See `docs/drafts/agent-secrets.md` for the full threat model.

### Future: s6 MCP Secret Isolation

When secret-bearing MCPs are added (github, aws, etc.), each MCP runs as its own s6 `longrun` service under its own linux user. The agent process never possesses the secret — only a socket path.

```
s6 orchestrator
  ├── svc-relay (user: agent) — no secrets, only socket paths + placeholder key
  ├── svc-apiproxy (user: root) — reads /run/secrets/proxy_key
  ├── svc-mcp-github (user: mcp-github) — GITHUB_TOKEN via s6-envdir
  └── svc-mcp-aws (user: mcp-aws) — AWS creds via s6-envdir
```

Each MCP:
- Runs as its own s6 `longrun` service with a dedicated linux user
- Gets secrets via `s6-envdir /run/secrets/mcp-<name>/`
- Listens on unix socket `/run/mcp/<name>.sock` or local HTTP port
- Agent connects via MCP SSE/HTTP transport (not stdio)
- Agent never possesses the secret — only the socket path

**Not built yet.** When the first secret-bearing MCP is added, create: the s6 service directory (`svc-mcp-<name>/`), the linux user in the Dockerfile, secret provisioning in lifecycle.py, and the `.mcp.json` entry with `type: "sse"` transport pointing to the local socket.
