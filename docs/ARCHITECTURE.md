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
