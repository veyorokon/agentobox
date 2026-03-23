# Architecture

## Operational Contracts

- [Testing](./testing.md)
- [Runtime Failure Audit](./RUNTIME-FAILURE-AUDIT.md)
- [Contracts](./contracts/README.md)
- [Machine Contract](./contracts/machine.md)

## System Overview

Agentobox is a managed agent workflow platform with real desktop environments. The system has two execution loops and a web dashboard for observability and control.

```
                         ┌─────────────────────────────────────────────┐
                         │              Two-Loop Architecture          │
                         │                                             │
                         │  MECHANICAL LOOP (cheap, fast, reliable)    │
                         │    cron/webhook → poll source → diff state  │
                         │    → evaluate triggers → fire effects       │
                         │    (code, not LLM — handles the 90%)        │
                         │                                             │
                         │  AGENT LOOP (expensive, slow, smart)        │
                         │    trigger → boot agent → read context      │
                         │    → do work (browse, research, draft)      │
                         │    → write results as StreamEvents → stop   │
                         │    (containerized desktop — handles the 10%)│
                         └─────────────────────────────────────────────┘

 Dashboard (Next.js)                 Backend (Django/Daphne)
 ┌──────────────────┐               ┌────────────────────────────────┐
 │  Apollo Client   │──── GraphQL ──│  Strawberry schema             │
 │  (queries/subs)  │    (HTTP+WS)  │                                │
 │                  │               │  Django Channels (Redis)       │
 │  Zustand         │               │    ├─ /graphql (subscriptions) │
 │  (UI state)      │               │    ├─ /ws/relay/<id>/ (relay)  │
 │                  │               │    └─ /ws/vnc/<id>/   (VNC)    │
 └──────────────────┘               │                                │
                                    │  /mcp (FastMCP HTTP)           │
                                    │                                │
                                    │  Mechanical Loop               │
                                    │    (Modal cron / mgmt command) │
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
                        │  Xvfb + AwesomeWM + noVNC + Chromium        │
                        │  s6-overlay (process supervision)           │
                        └─────────────────────────────────────────────┘
```

## Three Primitives

The whole platform reduces to three primitives:

| Primitive | What it is | Storage |
|-----------|-----------|---------|
| **State** | Latest agent output (JSON). Previous output kept for diffing/triggers. | `StreamEvent.data` (latest `agent_output` event type) |
| **Trigger** | Condition evaluated by the mechanical loop. Cron schedule, webhook, or state diff condition. | Workflow config (per-workflow template) |
| **Agent** | Containerized desktop environment with instructions. Reads context, does work, writes results. | `Agent` model + container |

## Two-Loop Architecture

### Mechanical Loop (cheap, fast, reliable)

Code, not LLM. Handles the 90% thats boring — checking if prices changed, if new emails arrived, if conditions are met.

```
cron tick / webhook arrives
  → poll source (fetch URL, check inbox, query API)
    → diff against previous state
      → evaluate trigger conditions
        → fire effects: notify, wake_agent, update_state
```

Runs as Modal cron functions in prod, management command locally. No LLM inference. The trigger evaluation is deterministic code.

### Agent Loop (expensive, slow, smart)

Handles the 10% that needs a brain. A trigger effect = "wake agent."

```
trigger fires "wake_agent" effect
  → agent container boots
    → relay.py connects WS to backend
      → Claude reads instructions + context (previous state, trigger data)
        → does work: browse in real Chromium, research, draft, analyze
          → writes structured output as StreamEvents
            → shuts down
```

The agent produces StreamEvents. The latest `agent_output` event becomes the new state. The mechanical loop can diff this state against previous state for the next trigger evaluation.

### Events as Universal Primitive

No separate "effects system" or "state system." Everything maps to StreamEvents (which already exist):

- Trigger fired → StreamEvent
- Agent woke → StreamEvent
- Agent output/results → StreamEvent
- Notification sent → StreamEvent (with side effect: post to webhook)

The dashboard feed already renders StreamEvents by type. "State" is just the latest agent_output event. Run history is events filtered by time range.

## Workflow Templates

A workflow is a pre-configured template targeting a specific audience. It populates:

- Agent configs (model, MCP servers, instructions)
- Trigger conditions (cron schedule, webhook, state diff rules)
- Effect set (notify channels, output format)

Workflows are a UX concept — same infra underneath, different front door per audience. User picks a workflow, it generates the configs, agents execute.

The AI coding team use case is one workflow template among many. Dogfooding (using agentobox to build agentobox) is still the dev workflow.

## Agent Lifecycle

| Step | What happens | File |
|------|-------------|------|
| 1. `createAgent` mutation | Creates Agent row (status=`deploying`), spawns background task | `services/lifecycle.py` `create_agent()` |
| 2. Container provisioning | Runtime creates container, writes agent-private `CLAUDE.md`, `.mcp.json`, settings, secrets, API key to the machine surface | `services/lifecycle.py` `_provision_agent()`, `services/provision.py` |
| 3. Relay env written | `.relay_env` written with agent ID, token, model, team config | `services/lifecycle.py` `_provision_agent()` |
| 4. Agent marked IDLE | `relay_token` + `sandbox_id` saved to DB, s6 relay service signaled to start | `services/lifecycle.py` `_save_provisioned()` |
| 5. Relay connects | transport reads env, opens WS to `/ws/relay/<agent_id>/` with Bearer token | `agent/transports/agentobox/client.py` `AgentoboxTransportClient` |
| 6. SDK client starts | managed session creates executor, spawns Claude CLI subprocess | `agent/runtime/managed_session.py` `ManagedRelaySession` |
| 7. Events stream back | SDK messages forwarded as raw JSON dicts over WS to `RelayConsumer` | `consumers.py` `RelayConsumer.receive_json()` → `services/stream.py` |

On restart (`hard_restart_agent`), the old container is terminated, the agent is reset to `deploying`, and a new container is provisioned with a best-effort `--resume` hint using the previous `session_id`. Continuity is only confirmed by the new runtime's subsequent session/output, not by passing that hint alone. On kill, the container is terminated and status set to `stopped`.

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

StreamEvents are the universal primitive for both the agent loop output and the mechanical loop's trigger/effect audit trail. No separate WorkflowRun model needed — a "run" is a time-bounded window of StreamEvents.

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

Adding a new domain requires adding it to `_VALID_DOMAINS` in `tests/test_architecture.py`. The full taxonomy spec is in `docs/drafts/event-taxonomy.md`. The standard runtime debugging procedure and failure-class audit process is in `docs/RUNTIME-FAILURE-AUDIT.md`.

## Adapters (Ports & Adapters)

`backend/agents/adapters/` implements the Ports and Adapters pattern. `AgentAdapter` is a Protocol (`base.py`) defining pure functions: `last_output()`, `live_action()`, `cost()`, `duration()`, `turns()`, `is_permission_request()`, `is_plan_proposal()`. `ClaudeCodeAdapter` (`claude_code.py`) implements this for Claude Code's stream-json format. Adapters have no DB access, no side effects, and never mutate the snapshot. The registry (`__init__.py`) maps `agent_type` strings to adapter instances — currently only `"claude-code"` is registered.

## Key Models

All in `backend/agents/models.py`:

| Model | Purpose |
|-------|---------|
| `Agent` | Container instance — status, config, latest_snapshot, materialized cost/phase/attention |
| `StreamEvent` | Append-only event log. One row per stream-json event. Source of truth. Universal primitive for both agent output and mechanical loop audit trail. |
| `SessionResult` | Cost/usage snapshot per turn (from `result` events). One row per turn, not upserted. |
| `TeamFeedItem` | Curated dashboard feed entries. Flat union — every field on every row, null where N/A. |
| `AgentTask` | Team tasks created via MCP `task_add`. Synced from MCP calls, visible in dashboard. |
| `AccountSecret` | Fernet-encrypted secrets at account (user) level. Inherited by all projects. |
| `ProjectSecret` | Fernet-encrypted secrets at project level. Overrides account secrets with same key. Optional agent scoping via M2M. |
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

`build_api_key_files()` writes secrets to `/run/secrets/<name>` with 0600 root:root permissions. The provisioning flow handles both Docker and Modal via the runtime adapter. Secrets resolve in priority order: project secret > account secret > global settings fallback.

**Blocks:** `docker inspect`, `/proc/1/environ`, cross-container access, agent user reading files directly.

### Layer 2: HTTP Proxy for Anthropic Key (process isolation)

The proxy prevents the agent process from ever possessing the real Anthropic API key. This is process-level isolation — the key exists only in the proxy's memory (running as root), never in the agent's environment or memory space.

`svc-apiproxy` (`api-proxy.py`) runs as root on `localhost:9999`, reads the real key from `/run/secrets/proxy_key` once at startup, and injects it into every outbound request to `api.anthropic.com`. The relay process gets a placeholder key (`sk-ant-proxy00-placeholder-key-for-agentobox-validation`) that passes CLI format validation but is rejected by the real API.

```
Provisioning (backend)
  ├── writes real key → /run/secrets/proxy_key (0600 root:root)
  ├── sets ANTHROPIC_API_KEY = placeholder in relay env
  └── sets ANTHROPIC_BASE_URL = http://localhost:9999 in relay env

Runtime (inside container)
  Claude CLI (agent user)
    → POST http://localhost:9999/v1/messages
      → api-proxy.py (root) strips placeholder, injects real key
        → HTTPS POST api.anthropic.com/v1/messages
          → response streamed back through proxy → CLI
```

**Blocks:** Everything in Layer 1, plus: `echo $ANTHROPIC_API_KEY` prints the placeholder (worthless), `env | grep` shows nothing useful, process memory inspection of the relay finds only the placeholder.

**Scope:** Only the Anthropic API key uses the proxy. Other secrets (GitHub tokens, MCP credentials) get Layers 1 + 3 only, until s6 MCP isolation is built.

**Important:** The proxy injects the key on ALL requests it receives (it has no path allowlist). This is correct because only Claude CLI traffic hits `localhost:9999` via `ANTHROPIC_BASE_URL`. Do not reuse this proxy for non-Anthropic APIs without adding path-based filtering.

### Layer 3: Output Stream Redaction (UX safety net)

> **This is a UX safety net, not a security boundary.** A compromised agent can trivially bypass redaction via base64 encoding, character splitting, or network exfiltration. Redaction prevents accidental exposure in the dashboard — it does not prevent intentional exfiltration.

The relay (`relay.py`) is the single chokepoint — every event flows through `_send_event()` before reaching the backend WebSocket. A `_Redactor` class loads secret values from `/run/secrets/` and `/mnt/abox-state/secrets/env` at boot, then scrubs matching substrings from every outbound event dict (JSON serialize → substring replace → deserialize). Redaction happens before WS send and before event buffering — no unredacted event ever leaves the container.

**Blocks:** `echo $GITHUB_TOKEN` → `[REDACTED]` in dashboard, `env | grep TOKEN` → values redacted, `cat .env` → values redacted.

**Does not block (by design):** network exfiltration, base64-encoded secrets, secrets the relay can't read (root-only files when relay runs as `agent` user).

**Redaction strategy:** Recursive dict traversal with substring matching (longest first). Walks every string value in the event dict and replaces secret substrings. Operates on Python objects, not serialized JSON — avoids breakage when secrets contain JSON syntax characters (quotes, backslashes). Short secrets (<8 chars) are excluded to avoid false positives.

### Which layers protect which secrets

| Secret type | Layer 1 (mounts) | Layer 2 (proxy) | Layer 3 (redaction) |
|-------------|:-:|:-:|:-:|
| Anthropic API key | yes | **yes** | yes |
| Project secrets (GitHub, etc.) | yes | no | **yes** |
| MCP credentials (future) | yes | no (s6 isolation instead) | yes |

### Component Responsibilities

| Component | Responsibility | File |
|-----------|---------------|------|
| Adapter (`claude_code/__init__.py`) | Decides WHAT secrets to provision, builds file specs and env content | Backend |
| Provisioning (`provision.py`) | Writes secrets to container filesystem, sets permissions | Backend |
| Lifecycle (`lifecycle.py`) | Orchestrates the provisioning sequence | Backend |
| API Proxy (`api-proxy.py`) | Intercepts Anthropic API calls, injects real key | Agent image |
| Relay (`relay.py`) | Redacts secrets from output stream before forwarding | Agent image |
| s6 services (`svc-*/run`) | Process isolation — each service has own user/env | Agent image |

See `docs/drafts/agent-secrets.md` for the full threat model matrix and design rationale.

## MCP Server Architecture

MCP servers give agents capabilities beyond the CLI — browser control, computer interaction, external API access. The architecture isolates MCP secrets from the agent process using a gateway pattern.

### Registry → Config → Runtime Flow

```
MCP_REGISTRY (registries.py)
  Each entry: {command, args, env, secrets[], compat[], instructions}
  └── "playwright":   {npx @playwright/mcp, secrets: []}
                │
                ▼
createAgent(mcp_servers: ["playwright"])
                │
                ▼
adapter.resolve_mcp_servers(names, variant="debian")
  → filters by compat, returns {name: {command, args, env, secrets}}
  → stored on Agent.mcp_servers (JSONField)
                │
                ▼
provision_workspace()
  ├── adapter.build_instructions()
  │     → writes /vol/.../home/agent/CLAUDE.md
  ├── adapter.build_mcp_config()
  │     → writes /vol/.../home/agent/.mcp.json
  │       {"mcpServers": {"playwright": {command, args, env}}}
  │
  └── write scoped secrets
        → /vol/.../run/secrets/mcp-{name}/{KEY} (0600 permissions)
                │
                ▼
Container Boot (s6-overlay)
  ├── init-volume oneshot
  │     → symlinks /run/secrets → volume path
  │
  └── runtime starts
        → mounts agent-private home
        → mounts shared workspace
        → makes /run/secrets available
                │
                ▼
Claude Code invocation starts
  ├── reads /home/agent/.mcp.json
  ├── spawns stdio MCPs directly from config
  ├── connects to remote MCPs directly from config
  └── makes JSON-RPC tool calls (screenshot, click, navigate, etc.)
```

### Secret Isolation

Provisioning materializes scoped MCP secrets under `run/secrets/mcp-{name}`. When the backend renders `/home/agent/.mcp.json`, it injects only the env keys explicitly required by that MCP. Claude then spawns stdio MCPs directly using that config.

```
Claude Code invocation
  ├── reads /home/agent/.mcp.json
  ├── spawns playwright stdio server — env: {}
  ├── spawns tavily stdio server — env: {TAVILY_API_KEY=sk-...}
  └── connects to remote MCPs — headers/oauth inline in config when required
```

**How secrets flow:**

```
AccountSecret / ProjectSecret (encrypted in DB)
        │
        ▼
resolve_agent_secrets() — merges account (base) + project (override), decrypts
        │
        ▼
provision_workspace() — matches MCP registry secrets[] to resolved secrets:
  if "TAVILY_API_KEY" in mcp.secrets and "TAVILY_API_KEY" in secret_envs:
    vol.write_secret("run/secrets/mcp-tavily/TAVILY_API_KEY", value)
        │
        ▼
adapter.build_mcp_config():
  reads /run/secrets/mcp-{name}/* as {filename: contents} dict
  injects only the declared secret keys into that MCP's env block
        │
        ▼
Claude spawns MCP subprocess with scoped env:
  TAVILY_API_KEY=sk-... (only this MCP sees it)
  other MCPs do not receive it
```

### MCP Registry

`backend/agents/adapters/claude_code/registries.py` defines `MCP_REGISTRY`:

| Field | Purpose |
|-------|---------|
| `command` | Executable to spawn (e.g. `node`, `npx`) |
| `args` | Command arguments (e.g. `["@playwright/mcp@latest"]`) |
| `env` | Non-secret environment variables required by the MCP |
| `secrets` | List of required secret key names (e.g. `["TAVILY_API_KEY"]`) |
| `compat` | Compatible image variants (e.g. `["debian"]`) |
| `instructions` | Behavioral guidance injected into `/home/agent/CLAUDE.md` |

Bundled MCPs are only the ones the image actually ships or can invoke directly. Today the canonical bundled MCP is `playwright`.

Adding a new MCP requires: (1) add to `MCP_REGISTRY`, (2) install the binary in the image or use an explicit external command, (3) document required secrets in the `secrets` field, and (4) prove the path exists in the target image/profile. The config writer handles everything else — there is no separate gateway service.

### Direct Config vs Service Gateway

The current architecture uses direct Claude Code config rather than an in-container gateway service because:
- **Honest image contract**: the config only references tools the current image/profile can actually execute
- **Lower indirection**: no localhost bridge, port allocation, or secondary supervisor to debug
- **Per-agent configuration**: MCP availability comes from the agent's private `.mcp.json`, not shared runtime services
- **Simpler reload model**: updating `.mcp.json` changes the next Claude invocation without a container redeploy
