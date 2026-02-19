# Lift Map

What to steal, from where, for every part of the system. Organized by concern, not by source. Each section names the winner, the exact files/types, and what (if anything) to change for multi-agent scale.

**Sources analyzed:**
- **OpenClaw** (`/tmp/openclaw`) — 600K LoC TypeScript, personal AI assistant with multi-channel
- **IronClaw** (`/tmp/ironclaw`) — 100K LoC Rust, Docker worker orchestrator
- **EdgeClaw** (`/tmp/EdgeClaw`) — 290K LoC TypeScript, OpenClaw fork with privacy routing
- **Crush** (`/tmp/crush`) — Charmbracelet CLI, Go/Bubble Tea, production design system
- **Claude Code** — teaming primitives (TeamCreate, SendMessage, TaskList, TaskUpdate)

**Rule:** if a system already solved it, steal it. Only build what no system has.

---

## Naming Glossary

Unified type names used throughout this document and the codebase. Each source project uses different names for the same concepts — this glossary normalizes them.

| Our Name | What It Is | Source Names |
|----------|-----------|--------------|
| **Frame** | WebSocket message envelope (req/res/event) | OpenClaw `RequestFrame`/`ResponseFrame`/`EventFrame` |
| **FrameError** | Error payload on the wire | OpenClaw `ErrorShape`, IronClaw `Error` enum |
| **AgentEvent** | Timestamped event from an agent stream | OpenClaw `AgentEvent`, IronClaw `JobEventPayload` |
| **FeedItem** | Rendered item in the dashboard feed | OpenClaw `ChatItem`, IronClaw SSE event types |
| **Message** | Inter-agent or user→agent text message | CC `SendMessage`, IronClaw `job_message` |
| **SessionToken** | Ephemeral per-agent auth token (relay↔backend) | IronClaw `TokenStore` entry |
| **UserToken** | JWT for dashboard user auth | OpenClaw device token |
| **AgentStatus** | Lifecycle state enum | IronClaw `JobState`, OpenClaw inferred from events |
| **HookPoint** | Named interception point in agent execution | EdgeClaw hook names, OpenClaw plugin hooks |
| **HookResult** | Return value from a hook (block/modify/pass) | EdgeClaw hook return types |
| **HookContext** | Data passed to a hook handler | EdgeClaw hook params |
| **HookMode** | Failure behavior (fail-open / fail-closed) | IronClaw `HookFailureMode` |
| **Agent** | A deployed agent instance (container + session) | IronClaw `Job`, OpenClaw agent process |
| **Session** | One agent run (start→stop, has events + cost) | OpenClaw session, IronClaw job run |
| **Team** | Group of agents on a project | CC team concept, our addition |
| **TeamMember** | One agent's entry in the team roster | CC `TeamCreate` result |
| **AgentTask** | A task assigned to an agent | CC `TaskCreate`/`TaskUpdate` |
| **SessionResult** | Final cost + token summary for a session | IronClaw `Result` event, OpenClaw `cost_usd` |
| **SecretGrant** | Permission for an agent to access a secret | IronClaw `SecretAccess.allowed_names` |
| **ProjectSecret** | An encrypted secret scoped to a project | IronClaw secret store entry |

All sections below use these names. Where source code uses the original name, both are shown.

---

## 1. WebSocket Wire Protocol

**Steal from: OpenClaw**

OpenClaw has a production-grade WebSocket protocol with versioning, handshake, heartbeat, backpressure, and sequence numbers. IronClaw's WS is a toy (browser-only, no reconnection, no heartbeat from server).

### What to take

**Message envelope** — three frame types, discriminated by `type`:
```typescript
// src/gateway/protocol/schema/frames.ts
RequestFrame  = { type: "req",   id: string, method: string, params?: unknown }
ResponseFrame = { type: "res",   id: string, ok: boolean, payload?: unknown, error?: ErrorShape }
EventFrame    = { type: "event", event: string, payload?: unknown, seq?: number }
```

**Handshake** — challenge-response with protocol version negotiation:
```
1. Server → Client: { type: "event", event: "connect.challenge", payload: { nonce, ts } }
2. Client → Server: { type: "req", method: "connect", params: { auth, minProtocol, maxProtocol } }
3. Server → Client: { type: "res", ok: true, payload: { snapshot, features, policy } }
```
- Handshake timeout: 10 seconds
- Protocol version: integer, negotiated on connect
- `policy` in hello response tells client: `{ maxPayload, maxBufferedBytes, tickIntervalMs }`

**Heartbeat** — server-initiated tick every 30s:
```typescript
TICK_INTERVAL_MS = 30_000
// Server sends: { type: "event", event: "tick", payload: { ts } }
```

**Sequence numbers** — global `seq` on every event frame. Client tracks `lastSeq`. Gap detection: if `seq > lastSeq + 1`, client knows it missed events.

**Backpressure / slow consumer** — per-client buffer tracking:
```typescript
// src/gateway/server-broadcast.ts
MAX_PAYLOAD = 25 * 1024 * 1024          // 25 MB per message
MAX_BUFFERED = 50 * 1024 * 1024         // 50 MB total buffered per client

// If client.socket.bufferedAmount > MAX_BUFFERED:
//   dropIfSlow: true  → silently drop event for this client
//   dropIfSlow: false → force-close client with code 1008 "slow consumer"
```

**Client reconnection** — exponential backoff:
```typescript
// ui/src/ui/gateway.ts — GatewayBrowserClient
initialBackoff = 800       // ms
maxBackoff = 15_000        // ms
backoffMultiplier = 1.7
jitter = Math.random() * 1000   // 0-1s random jitter to prevent thundering herd
// On disconnect: reject pending requests, schedule reconnect, re-handshake fresh
```

### What to change for multi-agent

- OpenClaw has one gateway process managing one agent. We have N agent relays + M dashboard clients. The protocol itself works unchanged — each relay connection is independent. The broadcaster needs to fan out per-project (don't send agent A's events to users watching project B).
- Add `agentId` field to EventFrame for relay connections.
- **Drop custom `seq` — use Redis Stream IDs as canonical ordering.** OpenClaw has custom sequence numbers per event stream. We also have Redis Streams (section 5). Two ordering systems is a bug factory. Redis Stream IDs are already monotonic (`{ms}-{seq}`) and unique. Dashboard clients track `lastStreamId` per agent, reconnect via `XREAD STREAMS agent_events:{agentId} {lastStreamId}`. One ordering system, fewer bugs.
- **Event replay on reconnect:** OpenClaw doesn't have this (events lost during disconnect). For fleet monitoring, Redis Streams provides replay (section 5). Gateway is stateless — no in-memory buffers. Gateway's only job: auth validation, WS pipe, fan-out. It holds no business logic, no state, no truth. This is deliberate — a stateless gateway scales horizontally without coordination.

**Files:** `src/gateway/protocol/schema/frames.ts`, `src/gateway/server-broadcast.ts`, `src/gateway/server.impl.ts`, `ui/src/ui/gateway.ts`

---

## 2. Auth

**Steal from: OpenClaw (user/device auth) + IronClaw (agent/relay auth)**

OpenClaw has device-bound auth with Ed25519 signatures, RBAC scopes, and rate limiting. IronClaw has per-job ephemeral tokens with constant-time comparison. We need both — user auth for dashboard, relay auth for agent containers.

### What to take

**User/device auth (from OpenClaw):**

```typescript
// src/gateway/auth.ts — auth modes
type AuthMode = "none" | "token" | "password" | "trusted-proxy"

// Device identity — Ed25519 keypair per device
// Client generates keypair, derives deviceId from pubkey
// Signs: { deviceId, clientId, role, scopes, signedAtMs, token, nonce }
// Server verifies signature, issues rotating deviceToken
```

**RBAC scopes (from OpenClaw):**
```typescript
// src/gateway/method-scopes.ts
type Role = "operator" | "node"
// Operator scopes: admin, read, write, approvals, pairing
// Node scopes: node.invoke.result, node.event, skills.bins
// Default-deny: unmatched methods require operator.admin
```

**Auth rate limiting (from OpenClaw):**
```typescript
// In-memory sliding window per {scope, ip}
// maxAttempts: 10, windowMs: 60_000, lockoutMs: 300_000
// Loopback addresses exempt
```

**Relay token auth (from IronClaw):**
```rust
// src/orchestrator/auth.rs — per-job ephemeral tokens
struct TokenStore {
    tokens: HashMap<Uuid, String>,  // job_id → token_hash
}
// 32 bytes CSPRNG → hex → SHA-256 hash stored
// Constant-time comparison via subtle::ConstantTimeEq
// Revoked on container stop
```

**Auth middleware (from IronClaw):**
```rust
// src/orchestrator/api.rs — axum middleware
// Extracts job_id from URL path, Bearer token from header
// Validates token against TokenStore
// Applied as route_layer on /worker/* routes only
```

### What to change for multi-agent

- OpenClaw's auth is single-user (one operator). We need multi-user with project-level isolation. Replace device-token store with JWT (Django issues, gateway validates). Keep the RBAC scope model.
- IronClaw's TokenStore scales to N agents already (HashMap<Uuid, String> behind RwLock). Port to Python with `secrets.compare_digest()`.
- **Combine:** dashboard users get JWT (from Django). Agent relays get ephemeral per-session tokens (from IronClaw's pattern). Gateway validates both.

**Files:** OpenClaw `src/gateway/auth.ts`, `src/gateway/method-scopes.ts`, `src/gateway/auth-rate-limit.ts`; IronClaw `src/orchestrator/auth.rs`, `src/orchestrator/api.rs`

---

## 3. Agent Lifecycle State Machine

**Steal from: IronClaw**

IronClaw has a proper 8-state machine with transition guards. OpenClaw doesn't have an explicit state machine — status is inferred from event streams (messy).

### What to take

```rust
// src/context/state.rs — JobState
pub enum JobState {
    Pending, InProgress, Completed, Submitted, Accepted, Failed, Stuck, Cancelled,
}

pub fn can_transition_to(&self, target: JobState) -> bool {
    matches!(
        (self, target),
        (Pending, InProgress) | (Pending, Cancelled) |
        (InProgress, Completed) | (InProgress, Failed) |
        (InProgress, Stuck) | (InProgress, Cancelled) |
        (Completed, Submitted) | (Completed, Failed) |
        (Submitted, Accepted) | (Submitted, Failed) |
        (Stuck, InProgress) | (Stuck, Failed) | (Stuck, Cancelled)
    )
}
```

Terminal states: `Accepted`, `Failed`, `Cancelled`. Recovery: `Stuck → InProgress`. Transition history capped at 200 entries with timestamps.

**Stuck detection** — IronClaw has `mark_job_stuck()` / `get_stuck_jobs()` in the DB. Agents that stop heartbeating get marked stuck. Recovery loop attempts restart.

**Container state (from IronClaw):**
```rust
// src/orchestrator/job_manager.rs
pub enum ContainerState { Creating, Running, Stopped, Failed }
```

### What to change for multi-agent

- Rename to match our domain: `Pending → pending`, `InProgress → running`, `Stuck → unresponsive`, etc.
- Add `deploying` state (between pending and running — container is provisioning).
- The transition guard pattern ports directly to Python as a method on the Agent model.
- **Dual heartbeat system** — a single "last_heartbeat_at" conflates container liveness with session activity. A tool call that takes 5 minutes is not a stuck agent. Need two signals:
  - **Container heartbeat** — relay → backend, every 30s. "The container is alive and the relay process is running." If stale for >90s, transition to `unresponsive`. This catches OOM kills, network partitions, crashed relays.
  - **Session activity heartbeat** — derived from CC's event stream. Any `AgentEvent` (text chunk, tool call, tool result) resets the activity timer. If no activity for >5 minutes AND the container heartbeat is healthy, the agent is likely stuck in a long think or a hung tool call — flag as `idle` (not `unresponsive`), surface in dashboard as "no activity for 5m" but don't kill it.
  - IronClaw's `mark_job_stuck()` / `get_stuck_jobs()` DB pattern applies to the container heartbeat. The session activity check is new.

**Files:** IronClaw `src/context/state.rs`, `src/orchestrator/job_manager.rs`, `src/db/libsql/jobs.rs`

---

## 4. Error Types & Propagation

**Steal from: IronClaw (typed hierarchy) + OpenClaw (wire error format)**

### What to take

**Error type hierarchy (from IronClaw):**
```rust
// src/error.rs — every error domain is its own enum
pub enum Error {
    Config(ConfigError), Database(DatabaseError), Channel(ChannelError),
    Llm(LlmError), Tool(ToolError), Safety(SafetyError), Job(JobError),
    Orchestrator(OrchestratorError), Worker(WorkerError), Hook(HookError),
}

// Key sub-errors:
LlmError::RateLimited { provider, retry_after: Option<Duration> }
JobError::InvalidTransition { id, state, target }
OrchestratorError::ContainerCreationFailed { job_id, reason }
```

**Wire error format (from OpenClaw):**
```typescript
// src/gateway/protocol/schema/error-codes.ts
ErrorShape = {
  code: string,        // "AGENT_TIMEOUT", "INVALID_REQUEST", "UNAVAILABLE", etc.
  message: string,     // human-readable
  details?: unknown,   // structured context
  retryable?: boolean, // can the client retry?
  retryAfterMs?: number
}
```

**LLM failover errors (from OpenClaw):**
```typescript
// src/agents/failover-error.ts
FailoverReason = "billing" (402) | "rate_limit" (429) | "auth" (401/403) |
                 "timeout" (408) | "format" (400)
// Used for automatic model failover — first model fails, try next
```

**Circuit breaker (from IronClaw):**
```rust
// src/llm/circuit_breaker.rs — three-state wrapping LlmProvider
// States: Closed (normal) → Open (failing) → HalfOpen (probing)
// Thresholds: 5 failures → open, 30s recovery, 2 probe successes → close
// Only transient errors count: RateLimited, RequestFailed, InvalidResponse
```

**LLM retry (from IronClaw):**
```rust
// src/llm/retry.rs — exponential backoff with 25% jitter
// Retryable on HTTP 429, 500, 502, 503, 504
```

### What to change for multi-agent

- Port error hierarchy to Python dataclasses.
- Wire error format goes on all gateway ↔ dashboard messages.
- Circuit breaker and retry are per-agent (each adapter manages its own). Port to Python, use in the relay.
- **Add structured error propagation from containers.** IronClaw's workers serialize errors to strings at the boundary (bad). We should send typed error payloads over the relay so the backend can make intelligent retry/escalation decisions.

**Files:** IronClaw `src/error.rs`, `src/llm/circuit_breaker.rs`, `src/llm/retry.rs`; OpenClaw `src/gateway/protocol/schema/error-codes.ts`, `src/agents/failover-error.ts`

---

## 5. Reconnection & State Rehydration

**Steal from: OpenClaw**

IronClaw has NO reconnection logic (workers fail on disconnect, orchestrator restart orphans all containers). OpenClaw has client-side reconnection with full snapshot rehydration.

### What to take

**Reconnection (from OpenClaw client):**
```typescript
// ui/src/ui/gateway.ts
scheduleReconnect() {
  backoffMs = min(backoffMs * 1.7, 15_000)  // 800ms → 15s
  setTimeout(() => connect(), backoffMs)
}
// On reconnect: full handshake, snapshot delivery, reset in-flight state
```

**Snapshot rehydration (from OpenClaw):**
```typescript
// ui/src/ui/app-gateway.ts — onHello callback after reconnect
host.chatRunId = null;         // reset orphaned in-flight state
resetToolStream(host);         // clear live tool stream
applySnapshot(host, hello);    // restore presence, health, session defaults
loadAssistantIdentity(host);
loadAgents(host);
refreshActiveTab(host);
```

Every `HelloOk` contains a full state snapshot: `presence[]`, `health`, `stateVersion`, `uptimeMs`. This is the only sync mechanism — no delta sync.

**Sequence gap detection (from OpenClaw):**
```typescript
// Client tracks lastSeq per event stream
// If seq > lastSeq + 1 → fire onGap({ expected, received })
// No automatic replay — sets lastError = "event gap detected"
```

### What to change for multi-agent

- **This is the biggest gap across all projects.** OpenClaw delivers a full snapshot on reconnect but has no event replay. Events during disconnect are permanently lost. IronClaw has nothing.
- For a fleet dashboard: add a 60-second ring buffer per agent in the gateway. On dashboard reconnect, replay buffered events after the snapshot. This covers brief disconnects (page refresh, network blip).
- For relay reconnect (agent container ↔ gateway): container should buffer events locally during disconnect, flush on reconnect. The relay already writes events — add a small SQLite WAL or flat file buffer.
- **Use Redis Streams, not in-memory buffers.** In-memory ring buffers die on gateway restart/horizontal scaling. Instead: relays push AgentEvents to a Redis Stream (TTL 1 hour). Gateway is stateless — on dashboard reconnect, it queries `XREAD ... STREAMS agent_events:{agentId} {lastSeq}`. Perfect stateless replay with zero custom buffering logic. The relay doesn't need a local WAL either — Redis is the buffer.
- This is net-new integration but uses Redis Streams (proven primitive), not custom code.

**Files:** OpenClaw `ui/src/ui/gateway.ts`, `ui/src/ui/app-gateway.ts`

---

## 6. Event Persistence & History

**Steal from: OpenClaw (JSONL format) + EdgeClaw (dual-track pattern)**

### What to take

**JSONL session files (from OpenClaw):**
```typescript
// src/gateway/session-utils.fs.ts
// Each session = one .jsonl file, one JSON object per line
// Format: { message: <Anthropic API message object> } per line
// Compaction markers: { type: "compaction", id, timestamp }
```

**Dual-track history (from EdgeClaw):**
```
sessions/full/{sessionKey}.jsonl    ← complete (local/trusted view)
sessions/clean/{sessionKey}.jsonl   ← redacted (cloud/dashboard view)
```

```typescript
// extensions/guardclaw/src/session-manager.ts
async persistMessage(sessionKey, message, agentId) {
  await this.writeToHistory(sessionKey, message, agentId, "full");
  if (!this.isGuardAgentMessage(message)) {
    await this.writeToHistory(sessionKey, message, agentId, "clean");
  }
}
```

**In-memory event routing (from OpenClaw):**
```typescript
// src/infra/agent-events.ts
// Set<listener> — process-level event emitter
// Per-run seq counter in Map<runId, number>
// Events emitted in-process, forwarded to WS clients via broadcaster
```

### What to change for multi-agent

- JSONL per-session is fine for container-local history. For the backend (fleet-level persistence), use PostgreSQL — not flat files.
- Dual-track pattern maps to our `tool_result_persist` hook: full output stays in container, redacted version goes to the DB/dashboard.
- In-memory event routing works per-container. The relay forwards events to the gateway which fans out to dashboard clients.
- **DB batching — don't write individual streaming chunks.** A multi-agent system will hammer PostgreSQL with high-frequency INSERTs for every token chunk and tool step. Instead: buffer events in Redis Streams (section 5), batch-write to PostgreSQL on `session_end` or every `5s + random(0, 2000)ms`. The jitter prevents N relays from flushing at the exact same millisecond and creating write contention or transaction deadlocks. Write the final assembled markdown block, not the individual chunks. The live feed reads from Redis/WS; the DB is the system of record, not the live stream.

**Source of truth hierarchy (make this explicit — four layers, one canonical):**

| Layer | Role | TTL | Canonical? |
|-------|------|-----|-----------|
| **PostgreSQL** | System of record | Permanent | **YES** — all queries, dashboards, billing, and analytics read from here |
| **Redis Streams** | Live event stream + short-term replay | 1 hour TTL | No — ephemeral buffer for real-time delivery and reconnection replay |
| **Container JSONL** | Full local session history | Container lifetime | No — ephemeral, dies with container. Used for CC session resumption only |
| **Gateway** | WS pipe + projection | None (stateless) | No — holds no state, no truth. Pure fan-out. Can restart/scale freely |

When in doubt: Postgres wins. Redis is the live delivery mechanism. Container files are local ephemeral copies. Gateway is a dumb pipe.

**Files:** OpenClaw `src/gateway/session-utils.fs.ts`, `src/infra/agent-events.ts`; EdgeClaw `extensions/guardclaw/src/session-manager.ts`

---

## 7. Feed / UI Item Types

**Steal from: OpenClaw**

### What to take

**ChatItem union (from OpenClaw):**
```typescript
// ui/src/ui/types/chat-types.ts
type ChatItem =
  | { kind: "message";           key, message }
  | { kind: "divider";           key, label, timestamp }
  | { kind: "stream";            key, text, startedAt }
  | { kind: "reading-indicator"; key }

type MessageContentItem =
  | { type: "text"; text }
  | { type: "tool_call"; name, args }
  | { type: "tool_result"; name, text }
```

**Live tool stream (from OpenClaw):**
```typescript
// ui/src/ui/app-tool-stream.ts
type ToolStreamEntry = {
  toolCallId, runId, sessionKey?,
  name, args?, output?,
  startedAt, updatedAt, message
}
// Throttled at 80ms, capped at 50 entries, output truncated at 120K chars
```

**Agent events wire schema (from OpenClaw):**
```typescript
// src/gateway/protocol/schema/agent.ts
AgentEvent = {
  runId: string, seq: number, stream: string,
  ts: number, data: Record<string, unknown>
}
// stream values: "lifecycle", "tool", "assistant", "error", "compaction"
```

**SSE event types (from IronClaw — more granular):**
```
response, thinking, tool_started, tool_completed, tool_result, stream_chunk,
status, job_started, approval_needed, auth_required, auth_completed, error,
heartbeat, job_message, job_tool_use, job_tool_result, job_status, job_result
```

### What to change for multi-agent

- Extend ChatItem with fleet-specific kinds: `task-start`, `task-end`, `agent-join`, `agent-leave`, `team-message`, `broadcast`. We already have these in our v2 feed renderers — carry them forward.
- Tool stream throttle (80ms) and cap (50 entries) are good defaults. Keep them.
- Add `agentId` to every event (OpenClaw doesn't need this — single agent. We do.)

**Files:** OpenClaw `ui/src/ui/types/chat-types.ts`, `ui/src/ui/app-tool-stream.ts`, `src/gateway/protocol/schema/agent.ts`; IronClaw `src/channels/web/types.rs`

---

## 8. Rate Limiting & Backpressure

**Steal from: OpenClaw (auth + slow consumer) + IronClaw (WASM rate limiter + circuit breaker)**

### What to take

**Auth rate limiting (from OpenClaw):**
```typescript
// src/gateway/auth-rate-limit.ts
// In-memory sliding window per {scope, ip}
// Default: 10 attempts / 60s window / 5 min lockout
// Loopback exempt
```

**Control plane write rate limit (from OpenClaw):**
```typescript
// src/gateway/control-plane-rate-limit.ts
// 3 requests per 60s for config mutations
// Per {deviceId, ip}
// Returns UNAVAILABLE with retryAfterMs
```

**Slow consumer backpressure (from OpenClaw):**
```typescript
// src/gateway/server-broadcast.ts
// Per-client bufferedAmount tracking
// > 50 MB → close with 1008 "slow consumer"
// dropIfSlow: true → silently drop for lagging clients
```

**Per-tool rate limiter (from IronClaw):**
```rust
// src/tools/wasm/rate_limiter.rs
// Per (user_id, tool_name) key
// Dual window: per-minute + per-hour
// Returns RateLimitResult::Limited { retry_after, limit_type }
```

**Broadcast channel with lag handling (from IronClaw):**
```rust
// broadcast::channel(256) — slow subscribers silently miss events
// mpsc::channel(64) — for WS handler → agent pipe
```

### What to change for multi-agent

- Auth rate limiting: works as-is.
- Slow consumer: works as-is, applied per dashboard WS client.
- **Add per-agent event throughput limiting.** None of the projects have this. A rogue agent flooding 10K events/sec shouldn't overwhelm the gateway. Add a token bucket per relay connection (e.g., 100 events/sec sustained, 500 burst).
- Per-tool rate limiting: useful if we expose tool-level controls. Port from IronClaw.

**Files:** OpenClaw `src/gateway/auth-rate-limit.ts`, `src/gateway/control-plane-rate-limit.ts`, `src/gateway/server-broadcast.ts`; IronClaw `src/tools/wasm/rate_limiter.rs`

---

## 9. Logging & Telemetry

**Steal from: OpenClaw (subsystem loggers + redaction) + IronClaw (web broadcast layer)**

### What to take

**Subsystem logging (from OpenClaw):**
```typescript
// src/logging/logger.ts — tslog v4 with file rotation
// Max log age: 24h, rotating files in ~/.openclaw/tmp/
// src/logging/subsystem.ts — per-subsystem logger instances
createSubsystemLogger("gateway/ws")
createSubsystemLogger("agents/lifecycle")
// Filter by subsystem via OPENCLAW_LOG_SUBSYSTEM env var
```

**Log redaction (from OpenClaw):**
```typescript
// src/logging/redact.ts
// Pattern-matches API keys, tokens, passwords in log strings
// Applied before any log output
```

**WS access log (from OpenClaw):**
```typescript
// src/gateway/ws-log.ts
// Per-request structured logging with direction arrows (←/→)
// Three styles: verbose, compact, optimized (errors + slow only)
// Sensitive data redacted via redact.ts
```

**Web log broadcast (from IronClaw):**
```rust
// src/channels/web/log_layer.rs — WebLogLayer
// Custom tracing_subscriber::Layer
// Forwards DEBUG+ events to a LogBroadcaster
// 500-entry ring buffer for late-joining clients
// All messages scrubbed through LeakDetector before broadcast
```

```rust
// src/tracing_fmt.rs — TruncatingStderr
// Custom MakeWriter that caps each event at 500 bytes
// Prevents LLM JSON bodies from flooding terminal
// Full event still broadcast via WebLogLayer
```

### What to change for multi-agent

- Subsystem loggers: map to our services (`agents/lifecycle`, `agents/comms`, `relay/ws`, `gateway/channels`).
- Log redaction: critical for multi-tenant. Port OpenClaw's pattern matcher.
- Web log broadcast: IronClaw's ring buffer pattern (500 entries for late joiners) is ideal for our dashboard's log panel. Port to Python/Node.
- **Add per-agent log namespacing.** Neither project tracks which agent produced which log. Add `agentId` to every structured log entry.
- **Add metrics.** Neither project has Prometheus/OTEL metrics. We need: active containers gauge, events/sec per agent, LLM cost accumulator, circuit breaker state. This is new code (~100 lines).

**Files:** OpenClaw `src/logging/logger.ts`, `src/logging/subsystem.ts`, `src/logging/redact.ts`, `src/gateway/ws-log.ts`; IronClaw `src/channels/web/log_layer.rs`, `src/tracing_fmt.rs`

---

## 10. Hook System

**Steal from: EdgeClaw (8 hook points) + IronClaw (failure modes + timeout) + OpenClaw (18-hook surface for future expansion)**

### What to take

**Hook points (from EdgeClaw — validated in production):**
```
message_received, resolve_model, before_tool_call, after_tool_call,
tool_result_persist, session_end, message_sending, before_agent_start
```

**Hook execution model (from EdgeClaw):**
```typescript
// extensions/guardclaw/src/hooks.ts
// Modifying hooks (resolve_model, before_tool_call, message_sending):
//   → run sequentially in priority order, each can modify payload
// Void hooks (message_received, after_tool_call, session_end):
//   → run in parallel, fire-and-forget
```

**Hook failure modes (from IronClaw):**
```rust
// src/hooks/mod.rs
enum HookFailureMode {
    FailOpen,   // hook error → proceed anyway
    FailClosed, // hook error → block the action
}
// + timeout per hook
```

**Hook result types (from EdgeClaw):**
```typescript
// before_tool_call can return:
{ block: true, blockReason: string }           // hard block
{ modify: true, input: modifiedInput }         // modify tool input

// resolve_model can return:
{ provider, model, reason }                     // change model
{ sessionKey, directResponse }                  // redirect to different session

// message_sending can return:
{ cancel: true }                                // suppress outbound
{ content: redactedContent }                    // modify outbound
```

**Future hook surface (from OpenClaw — 18 hooks for reference):**
```
gateway_start, gateway_stop,
before_compaction, after_compaction,
before_message_write, after_message_write,
session_start, agent_started,
llm_input, llm_output,
error
```
These are available when we need them. Start with EdgeClaw's 8, add from OpenClaw as needed.

### What to change for multi-agent

- Add `failure_mode` and `timeout` from IronClaw to every hook definition.
- Team routing hook (`before_tool_call` intercepting `Task(team_name=...)`) is our primary addition — none of them have this.
- Consider adding `agent_started` (from OpenClaw) — fires after boot, useful for "agent ready" dashboard notification.
- **Hook observability (none of the projects have this).** Hook systems feel clean early, then become invisible execution graphs. Every hook invocation must be traced: which hooks fired, what they returned, how long they took, whether they timed out. This is critical for debugging "why did this agent behave weirdly" — the answer is often a hook that blocked, modified, or timed out silently. Add: (1) hook trace logging per event (which hooks ran, in what order, with what result), (2) hook duration metrics (per hook name, p50/p95/p99), (3) timeout telemetry (count of timeouts per hook), (4) deterministic execution ordering documented and enforced (modifying hooks sequential in priority order, void hooks parallel — already specified above, but must be tested).

**Files:** EdgeClaw `extensions/guardclaw/src/hooks.ts`; IronClaw `src/hooks/mod.rs`; OpenClaw `src/plugins/hooks.ts`

---

## 11. Provider Abstraction (Model Registry)

**Steal from: OpenClaw**

### What to take

```typescript
// Provider config — endpoint, auth, available models
interface ModelProviderConfig {
  id: string;                    // "anthropic"
  baseUrl: string;
  apiKey?: string;
  authMode?: "bearer" | "api-key" | "none";
  customHeaders?: Record<string, string>;
  models: ModelDefinitionConfig[];
}

// Per-model cost and capability
interface ModelDefinitionConfig {
  id: string;                    // "claude-sonnet-4-6"
  name: string;
  api: ModelApi;                 // openai-completions, anthropic-messages, etc.
  reasoning?: boolean;
  inputTypes?: string[];         // ["text", "image", "pdf"]
  cost: { input, output, cacheRead?, cacheWrite? };  // $/1M tokens
  contextWindow: number;
  maxTokens: number;
  compat: { computerUse?, promptCaching?, streaming? };
}

enum ModelApi {
  OpenaiCompletions, AnthropicMessages, GoogleGenerativeAi, Bedrock, Ollama
}
```

### What to change for multi-agent

- **Provider agnosticism — lift OpenClaw's pattern directly.** OpenClaw's `ModelProviderConfig` + `ModelDefinitionConfig` is exactly the registry we need. Store in DB, seed from OpenClaw's model list, update costs without code changes. `ModelApi` maps to LiteLLM's `provider/model_id` format (`anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `groq/llama-3.3-70b`).
- The `compat` field tells the dashboard what to show (e.g., reasoning toggle, image upload button).
- **Fleet-level LLM rate limiting (the N-agent scaling wall).** Each agent container runs CC, which makes its own API calls. 100 agents sharing the same Anthropic API key will obliterate TPM limits within seconds. IronClaw's per-agent circuit breaker can't solve this — each agent retries independently, making the stampede worse. **Fix: LiteLLM Proxy.** Deploy LiteLLM in proxy mode as a shared service. Configure all agent containers to route LLM calls through it (`ANTHROPIC_BASE_URL=http://litellm-proxy:4000`). LiteLLM already provides: fleet-level TPM/RPM tracking across all agents, global queuing (agents pause gracefully instead of getting 429s), provider failover (Anthropic down → route to OpenAI or Bedrock), per-model routing and load balancing, cost tracking aggregated across the fleet. This is the clean path — no custom code, proven tool, and it inherits OpenClaw's provider-agnostic model registry.

**Files:** OpenClaw — search for `ModelDefinitionConfig`, `ModelProviderConfig`, `ModelApi` in `src/`

---

## 12. Channel Adapters

**Steal from: OpenClaw**

### What to take

**Channel plugin interface:**
```typescript
interface ChannelPlugin {
  id: string;
  meta: { name, description };
  capabilities: {
    streaming: boolean;
    threading: boolean;
    attachments: string[];       // ["image", "document", "audio"]
    maxMessageLength: number;
  };
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  send(channelId: string, msg: PlatformMessage): Promise<void>;
}
```

**Library choices (from OpenClaw — production-validated):**

| Channel | Library | OpenClaw uses it |
|---------|---------|-----------------|
| WhatsApp | `@whiskeysockets/baileys` | Yes |
| Telegram | `grammy` | Yes |
| Slack | `@slack/bolt` | Yes |
| Discord | `discord.js` | Yes |
| Email | `nodemailer` + IMAP | Yes |

### What to change for multi-agent

- Add `capabilities` to our ChannelAdapter interface — dashboard needs it for composer rendering.
- OpenClaw routes one channel → one agent. We route channel → project → agent (via ChannelBinding model). The routing lookup is our addition.

**Files:** OpenClaw — search for `ChannelPlugin`, channel adapter implementations in `src/channels/`

---

## 13. Claude Code Bridge (NDJSON Stream Parsing)

**Steal from: IronClaw**

### What to take

```rust
// IronClaw spawns claude with stream-json output
Command::new("claude")
    .args(["--output-format", "stream-json", "--verbose"])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()

// NDJSON event types
enum ClaudeStreamEvent {
    System { session_id, tools },
    Assistant { message: ContentBlock },    // Text, ToolUse, ToolResult
    User { message: ContentBlock },
    Result { result, cost_usd, input_tokens, output_tokens, duration_ms, session_id },
}

// Normalizer
fn stream_event_to_payloads(event: ClaudeStreamEvent) -> Vec<JobEventPayload> {
    // Assistant.Text → Message
    // Assistant.ToolUse → ToolUse { id, name, input }
    // Assistant.ToolResult → ToolResult { tool_use_id, content }
    // Result → CostUpdate { cost_usd, input_tokens, output_tokens }
}
```

### What to change for multi-agent

- Port Rust → Python directly. This is our `ClaudeCodeAdapter`.
- Add session resumption support (`--session-id` flag for continuing sessions).
- Add team mode flags when the agent is part of a team.

**Files:** IronClaw — search for `ClaudeStreamEvent`, `stream_event_to_payloads`, `ClaudeBridgeRuntime` in `src/`

---

## 14. Capability Model

**Steal from: IronClaw**

### What to take

```rust
struct Capabilities {
    workspace_read: WorkspaceAccess {
        allowed_prefixes: Vec<PathBuf>,
    },
    http: HttpAccess {
        allowlist: Vec<EndpointRule>,       // URL pattern matching
        credentials: Vec<CredentialRef>,
        rate_limit: RateLimit { max_per_minute },
        max_response_bytes: usize,
        timeout_ms: u64,
    },
    tool_invoke: ToolAccess {
        aliases: HashMap<String, ToolConfig>,
        rate_limit: RateLimit,
    },
    secrets: SecretAccess {
        allowed_names: Vec<GlobPattern>,   // ["GITHUB_*", "NPM_TOKEN"]
    },
}
```

### What to change for multi-agent

- Port to Python dataclass / JSON schema. Store in `Session.capabilities`.
- Validate on `secret_request` — check `secrets.allowed_names` glob against requested secret name.
- The glob matching for secret names is particularly valuable — grant `GITHUB_*` instead of enumerating.

**Files:** IronClaw — search for `Capabilities`, `WorkspaceAccess`, `HttpAccess`, `SecretAccess` in `src/`

---

## 15. Cost Tracking

**Steal from: IronClaw (per-model lookup) + ClawWork (provider wrapper pattern) + OpenClaw (model registry)**

### What to take

**Per-model cost lookup (from IronClaw):**
```rust
fn model_cost(model: &str) -> (Decimal, Decimal) {
    let normalized = strip_provider_prefix(model);  // "anthropic/claude-..." → "claude-..."
    match normalized {
        "claude-sonnet-4-6" => (dec!(3.0), dec!(15.0)),   // input, output $/M tokens
        ...
    }
}
```

**Cost from event stream (from IronClaw — ClaudeStreamEvent.Result):**
```rust
ClaudeStreamEvent::Result { cost_usd, input_tokens, output_tokens, duration_ms, .. }
// → JobEventPayload::CostUpdate
```

**Persistent cost tracking (from IronClaw DB):**
```sql
-- agent_jobs table
total_input_tokens, total_output_tokens, total_cost REAL
-- llm_calls table (per-call granularity)
model, provider, input_tokens, output_tokens, cost, latency_ms
```

### What to change for multi-agent

- Replace hardcoded cost table with OpenClaw's `ModelDefinitionConfig` registry (stored in DB).
- Cost extracted from CC's stream events (`Result` type). For non-CC agents, estimate from adapter output.
- Aggregate per-agent, per-session, per-project. Our `SessionResult` model already has this structure.
- **Per-project budget enforcement (no project has this).** LiteLLM Proxy handles fleet-level rate limiting but not project-level spending caps. Without this, one rogue team test can burn $5k before anyone notices. Add: (1) `budget_usd` field on Project model (nullable = unlimited), (2) before-session check: if `project.total_cost >= project.budget_usd`, reject new sessions with a clear error, (3) dashboard warning banner at 80% budget, (4) optional per-agent session cost cap (kill session if cost exceeds threshold). The check is a simple DB query against the cost aggregation we already track — not a new system, just a guard on existing data.

**Files:** IronClaw `src/llm/cost.rs`, DB schema in `migrations/`; ClawWork `src/providers/tracked.py`

---

## 16. Design Tokens & Theming — Complete Reference

**Steal from: OpenClaw (CSS token structure) + Crush (complete charmtone palette + centralized style system) + CC CLI (thinking indicators + status tokens)**

This is the exhaustive token inventory. Every visual property in both CLIs is mapped here. The web dashboard builds on these tokens — nothing is invented, everything traces back to a CLI source.

### CSS Token Hierarchy (from OpenClaw — the structure)

```css
/* Backgrounds — 5 levels */
--bg, --bg-accent, --bg-elevated, --bg-hover, --bg-muted
/* Text — 3 levels */
--text, --text-strong, --muted
/* Status */
--ok, --warn, --danger, --info
/* Shadows — 4 levels + glow */
--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl, --shadow-glow
/* Radii — 5 levels */
--radius-sm through --radius-full
/* Motion — 3 durations x 3 easings */
--duration-fast/normal/slow, --ease-out/in-out/spring
/* Typography */
--mono, --font-body, --font-display
```

### Complete Charmtone Palette (from Crush — the values)

Every named color Crush uses internally. ALL of these need CSS custom property equivalents.

**Backgrounds (4 levels):**
```css
--bg-base:      #201f26;  /* Pepper — deepest background */
--bg-surface:   #2d2c35;  /* BBQ — card/panel backgrounds */
--bg-elevated:  #38374a;  /* Charcoal — hover states, elevated surfaces */
--bg-overlay:   #4d4c57;  /* Iron — modals, overlays, tooltips */
```

**Foregrounds (5 levels):**
```css
--fg-base:      /* Ash — primary text (light) */
--fg-muted:     #858392;  /* Squid — secondary text, inactive labels */
--fg-subtle:    /* Smoke — tertiary text, timestamps */
--fg-faint:     /* Oyster — ghost text, watermarks */
--fg-selected:  /* Salt — highlighted/selected text */
--fg-white:     #fffaf1;  /* Butter — maximum contrast text */
```

**Primary & Secondary Accents:**
```css
--accent:           /* Charple — primary brand, focused borders, links */
--accent-secondary: /* Dolly — cursor color, secondary actions */
--accent-tertiary:  /* Bok — tertiary accent, tags */
```

**Status (4 semantic colors):**
```css
--status-error:   #ff577d;  /* Sriracha — errors, destructive actions */
--status-warning: /* Zest — warnings, attention needed */
--status-info:    #00a4ff;  /* Malibu — informational, links, types */
--status-success: #00ffb2;  /* Julep — success, completions */
```

**Extended Blue Palette (for code/types):**
```css
--blue-light:  /* Sardine — light blue accents */
--blue-base:   #00a4ff;  /* Malibu — standard blue (= info) */
--blue-dark:   /* Damson — dark blue backgrounds */
```

**Extended Green Palette (for diffs/success):**
```css
--green-light:  /* Bok — light green */
--green-base:   #00ffb2;  /* Julep — standard green (= success) */
--green-dark:   /* Guac — dark green, focused editor prompt */
```

**Extended Red Palette (for errors/diffs):**
```css
--red-light:  /* Coral — standard red */
--red-base:   #ff577d;  /* Sriracha — dark red (= error) */
--red-dark:   /* Cherry — deepest red */
```

**Yellow/Gold:**
```css
--yellow:  /* Mustard — gold accents, YOLO indicators */
```

**Syntax Highlighting (from Crush's Chroma theme — 10 dedicated tokens):**
```css
--syntax-comment:     /* Bengal — comments, preprocessor */
--syntax-builtin:     /* Cheeky — builtin names, functions */
--syntax-decorator:   /* Citron — decorators, annotations */
--syntax-string:      /* Cumin — string literals */
--syntax-type:        /* Guppy — type names, classes */
--syntax-attribute:   /* Hazy — attributes, properties */
--syntax-tag:         /* Mauve — HTML/XML tags */
--syntax-keyword:     /* Pony — keywords, reserved words */
--syntax-operator:    /* Salmon — operators (+, -, =, etc.) */
--syntax-link:        /* Zinc — URLs, links in code */
```

**Diff-specific Colors (exact hex from Crush):**
```css
/* Added/insert lines */
--diff-add-line-num-fg:  #629657;
--diff-add-line-num-bg:  #2b322a;
--diff-add-code-bg:      #323931;
/* Deleted/remove lines */
--diff-del-line-num-fg:  #a45c59;
--diff-del-line-num-bg:  #312929;
--diff-del-code-bg:      #383030;
/* Dark variant (for alternate row or nested diffs) */
--diff-add-dark-bg:      #293229;
--diff-del-dark-bg:      #332929;
/* Special backgrounds */
--diff-anchovy:          /* Anchovy — very dark background */
--diff-sapphire:         /* Sapphire — blue highlight bg */
--diff-ox:               /* Ox — dark code background */
--diff-turtle:           /* Turtle — green insert highlight */
```

### Spacing Tokens (from Crush)

```css
/* Base spacing unit = 1 character cell in terminal. Web: 8px (half-character at 16px mono) */
--space-0: 0;
--space-1: 8px;   /* Crush: Padding(0,1), MarginRight(1) — most common */
--space-2: 16px;  /* Crush: defaultMargin=2, defaultListIndent=2, PaddingLeft(2), MarginLeft(2) */
--space-3: 24px;  /* Crush: Padding(1) symmetric on larger elements */
--space-4: 32px;  /* Crush: Padding(1,2) — dialog content panels */

/* Gap between feed items: 1 blank line = 1 unit */
--feed-gap: 8px;  /* Crush: gap=1 between list items */
```

### Border Tokens

**Characters (from Crush):**
```css
/* Thin vertical border (blurred/default state) */
--border-char-thin: "│";    /* U+2502 */
/* Thick vertical border (focused state) */
--border-char-thick: "▌";   /* U+258C */
/* Horizontal separator */
--border-char-horizontal: "─";  /* U+2500 */
/* Diagonal (decorative) */
--border-char-diagonal: "╱";    /* U+2571 */
```

**Border styles (from Ink — available for tool cards, dialogs):**
```
single:       ┌ ─ ┐ │ │ └ ─ ┘
round:        ╭ ─ ╮ │ │ ╰ ─ ╯   (preferred for tool cards)
bold:         ┏ ━ ┓ ┃ ┃ ┗ ━ ┛
double:       ╔ ═ ╗ ║ ║ ╚ ═ ╝
```

**Focus/blur states (from Crush):**
```css
/* Focused item */
--border-focused-color: var(--accent);       /* Charple */
--border-focused-char: "▌";                  /* Thick left border */
--border-focused-text: var(--fg-base);       /* Full brightness text */

/* Blurred item */
--border-blurred-color: var(--bg-elevated);  /* Charcoal — subtle */
--border-blurred-char: "│";                  /* Thin left border */
--border-blurred-text: var(--fg-muted);      /* Dimmed text */

/* Cursor (text input) */
--cursor-color: var(--accent-secondary);     /* Dolly */
--cursor-style: block;
--cursor-blink: true;

/* YOLO mode indicator (from Crush) */
--yolo-fg-focused: var(--fg-faint);          /* Oyster */
--yolo-bg-focused: var(--syntax-decorator);  /* Citron */
--yolo-fg-blurred: var(--bg-base);           /* Pepper */
--yolo-bg-blurred: var(--fg-muted);          /* Squid */
--yolo-dots-focused: var(--status-warning);  /* Zest */
--yolo-dots-blurred: var(--fg-muted);        /* Squid */
```

### Animation Tokens

**From Crush (20fps terminal rendering):**
```css
--anim-fps: 20;                    /* 50ms per frame */
--anim-ellipsis-speed: 400ms;      /* 8 frames × 50ms per dot change */
--anim-ellipsis-frames: ".", "..", "...", " ";  /* 4-phase cycle */
--anim-birth-offset-max: 1000ms;   /* Staggered entrance: random 0-1s per char */
--anim-cycling-chars: 10;          /* Number of animated chars in spinner */
--anim-prerendered-frames: 10;     /* Cached gradient frames */
--anim-gradient-ramp-multiplier: 3; /* When CycleColors=true, ramp = width × 3 */
```

**From CC CLI (thinking indicator):**
```css
--thinking-phase-interval: 120ms;  /* CC's default: ~8.3 phases/sec */
--thinking-phases: "·", "✢", "✳", "✶", "✻", "✽";  /* 6 Unicode phases */
--thinking-reverse-mirror: true;   /* Plays backwards after reaching end */
/* Web: CSS animation with 12 keyframe steps (6 forward + 6 reverse) */
```

**Web animation rules (convergent from both CLIs):**
```css
--transition-expand: max-height 200ms ease-out;  /* Expand/collapse */
--transition-fade: opacity 150ms ease-in-out;    /* Item entrance */
--transition-none: 0ms;                          /* Status changes: instant */
/* No bouncing, no sliding, no elastic — terminal restraint */
/* Transforms: opacity + max-height ONLY. No translate/scale. */
```

### Status Indicator Tokens

**Shared vocabulary (both CLIs converge):**
```css
--indicator-running:   "●";  /* Filled dot — blue/cyan */
--indicator-success:   "✓";  /* Checkmark — green */
--indicator-error:     "×";  /* X-mark — red */
--indicator-canceled:  "⊘";  /* Circle-slash — yellow */
--indicator-pending:   "◌";  /* Hollow dot — gray */
--indicator-info:      "◇";  /* Diamond — muted */
```

**Model tier indicators (from CC CLI statusline):**
```css
--model-opus:   "◆";  /* Filled diamond — highest tier */
--model-sonnet: "◇";  /* Hollow diamond — mid tier */
--model-haiku:  "○";  /* Circle — fast tier */
```

**Context usage (from CC CLI — color thresholds):**
```css
--context-ok:       var(--status-success);  /* < 50% used → green */
--context-warning:  var(--status-warning);  /* 50-75% used → yellow */
--context-critical: var(--status-error);    /* > 75% used → red */
/* Progress bar chars: ▓ (filled) ░ (empty) */
```

**Git/change indicators (from CC CLI statusline):**
```css
--change-positive: "▲";  /* Green — net lines added */
--change-negative: "▼";  /* Red — net lines removed */
--change-neutral:  "=";  /* Gray — no net change */
```

### Typography Tokens

```css
/* Font families */
--font-mono: 'Ubuntu Mono', 'IBM Plex Mono', 'SF Mono', monospace;
--font-body: var(--font-mono);    /* Everything is monospace — terminal aesthetic */
--font-display: var(--font-mono); /* No display font needed */

/* Sizes (relative, not absolute — scales with user preference) */
--text-sm: 0.875rem;   /* 14px — timestamps, secondary info */
--text-base: 1rem;     /* 16px — body text, code */
--text-lg: 1.125rem;   /* 18px — headings in feed */

/* Line height */
--leading-tight: 1.25;  /* Code blocks, dense content */
--leading-normal: 1.5;  /* Body text, messages */

/* Max content width */
--content-max-width: 960px;  /* 120 chars × 8px per char at 16px mono */

/* Hierarchy through weight and color, NOT size (from both CLIs) */
/* H1: --fg-white + bold */
/* H2: --fg-base + bold */
/* Body: --fg-base + normal */
/* Muted: --fg-muted + normal */
/* Code: --fg-base + normal + syntax colors */
```

### What to change for multi-agent

- **Centralized token system:** all tokens defined in one CSS file (`:root` custom properties). Components NEVER use raw colors — always `var(--token-name)`. This is Crush's "Styles struct" pattern translated to CSS.
- Keep our theme palettes (cyberpunk, retro, rose-pine, hyper) as alternate `:root` token sets. Each theme overrides the same property names with different values.
- Our augmented-ui integration stays (no other project has this).
- **Color downgrade:** unlike terminal apps, web doesn't need ANSI fallbacks. But dark/light mode support needs consideration — Crush is dark-only, CC adapts to terminal theme. We default to dark (matching both CLIs) with light as future option.

**Files:** OpenClaw `ui/src/styles/base.css`; Crush — `Styles`, `Charmtone`, `StyleFocused`, `StyleBlurred` in Go source; CC CLI — thinking animation in `tweakcc` config schema

---

## 17. Feed Component Map — CLI → Web 1:1

**Reference implementations: CC CLI (Ink/React) + Crush (Bubble Tea/Lip Gloss)**

The feed must feel exactly like the CLI. Same visual vocabulary, same interaction model, same information density, same animation quality. Both CC and Crush solve the same problems with convergent patterns — when two independent teams arrive at the same answer, that's the answer.

**What V2 got wrong:** static feed items (no expand/collapse, no streaming feel), jitter from bad scroll handling, no thinking indicators, no keyboard shortcuts, no progressive disclosure on tool results. The feed felt like a log viewer, not a terminal. This section fixes that.

### Component Tree

```
<Dashboard>
├── <StatusBar />                    (L0, fixed top — fleet stats)
│   ├── Agent count + error count
│   ├── Active model
│   └── Session cost / context %
│
├── <Sidebar />                      (L1, agent list)
│   └── <AgentCard />                (status dot + name + current action)
│
├── <Feed />                         (L2, main scrollable area)
│   ├── <UserMessage />              (user/lead input, bordered)
│   ├── <AssistantMessage />         (agent response, streaming)
│   │   ├── <ThinkingIndicator />    (animated, shows elapsed time)
│   │   ├── <StreamingText />        (markdown, chunk-by-chunk)
│   │   └── <ToolCallCard />         (expandable, polymorphic)
│   │       ├── <ToolCallHeader />   (collapsed: icon + name + summary)
│   │       ├── <ToolCallBody />     (expanded: full args + output)
│   │       │   ├── <CodeBlock />    (syntax highlighted, line numbers)
│   │       │   ├── <DiffView />     (unified diff, red/green)
│   │       │   └── <BashOutput />   (ANSI-rendered terminal output)
│   │       └── <ToolCallStatus />   (● running, ✓ done, × error)
│   ├── <TeamMessage />              (inter-agent message)
│   ├── <TaskEvent />                (task created/completed/assigned)
│   └── <SessionInfo />              (model, cost, duration — after completion)
│
└── <Composer />                     (fixed bottom — message input)
    ├── Text input (monospace, multiline via Shift+Enter)
    └── Agent selector (who to message)
```

### Feed Items — State Machines

Every feed item has states. V2 treated items as static renders. The CLI doesn't — items are live objects with transitions.

**AssistantMessage states:**
```
idle → thinking → streaming → complete
                → error
```
- `thinking`: show ThinkingIndicator (spinner + elapsed time + token count)
- `streaming`: text appears chunk-by-chunk, auto-scroll follows
- `complete`: full text rendered, tool calls finalized
- `error`: red indicator, error message inline

**ToolCallCard states:**
```
pending → running → success
                  → error
                  → canceled

Each state also has: collapsed | expanded
```
- `pending`: `◌` gray, name + args preview
- `running`: `●` blue with spinner, name + args, output streaming
- `success`: `✓` green, collapsed one-line summary (e.g., "Read 3 files")
- `error`: `×` red, error message visible even when collapsed
- `canceled`: `⊘` yellow, "Canceled"
- **collapsed** (default): one-line header only — icon + name + summary
- **expanded**: full args, full output, diffs, code blocks

**ThinkingIndicator:**
```
hidden → visible (animating) → hidden
```
- Gradient-cycling spinner (from Crush: HCL colorspace, 20fps → CSS 50ms steps)
- Label: "Thinking..." with animated ellipsis (`.` → `..` → `...` → ` `)
- Elapsed time: `(5s)`, updated every second
- Token count (optional): `(5s · ↓ 279 tokens)`
- Appears ONLY when thinking with no content yet. Disappears when first text chunk arrives.

### Expand / Collapse (the thing V2 was missing)

**Both CC and Crush converge on the same pattern:**
- Default: collapsed (one-line summary)
- Click/tap or keyboard → expanded (full content)
- Tool results, thinking blocks, long outputs — all expandable
- Truncation hint when collapsed: `"… (N lines hidden)"`

**CC's Ctrl+O → transcript mode:** expands everything at once. Web equivalent: a toggle in the feed header or keyboard shortcut that sets all items to expanded.

**Crush's space key:** toggles expand on focused item. Web equivalent: click on the item, or arrow-key navigate + Enter/Space.

**Implementation:**
- Each FeedItem has `expanded: boolean` **in the Zustand store** (not local state — "expand all" is a single store action, keyboard navigation needs to know what's expanded, and virtualized lists may unmount/remount items)
- Collapsed: render `<ToolCallHeader />` only (one line)
- Expanded: render header + `<ToolCallBody />` (full content)
- Transition: CSS `max-height` animation or `display` toggle (no layout thrash)
- "Expand all" toggle: single store action flips all items

### Streaming Text

**CC approach:** Ink renders at ~30fps, debounces chunk updates, differential ANSI output.
**Crush approach:** 20fps tick, markdown re-rendered per chunk, width-capped at 120 chars.

**Web equivalent:**
- Text arrives via WS as `AgentEvent` chunks with `stream: "assistant"`
- Append to a buffer string. Re-render markdown on each chunk (or debounce at ~50ms).
- Use `react-markdown` or similar with streaming-friendly rendering
- **Max width: 960px** (120 chars × 8px monospace). Matches both CLIs.
- Auto-scroll follows streaming text (see Scroll section below)

### Scroll Behavior (fixing V2's jitter)

**Both CLIs converge:**
- **Auto-follow ON by default** — new content scrolls into view
- **Manual scroll breaks auto-follow** — user scrolls up, auto-follow stops
- **Jump to bottom re-enables auto-follow** — click "jump to bottom" or press `G`/`End`

**V2's jitter came from fighting this pattern.** The fix is simple: track a `follow: boolean`. When `follow === true`, `scrollToBottom()` on every new content. When the user scrolls up (scroll event where `scrollTop < scrollHeight - clientHeight - threshold`), set `follow = false`. A "jump to bottom" button appears when `follow === false`.

**From Crush — viewport-aware optimization:**
- Only render items in the viewport (virtualized list)
- Pause animations on items scrolled out of view
- Resume on scroll back into view
- This prevents CPU waste on invisible spinners/gradients

### Keyboard Shortcuts

Mapped from both CLIs to web equivalents:

| CLI shortcut | Web shortcut | Action |
|-------------|-------------|--------|
| CC `Ctrl+O` | `Ctrl+O` or feed toggle | Expand all / transcript mode |
| Crush `space` | `Space` or `Enter` (on focused item) | Toggle expand/collapse |
| Crush `j/k` | `↓/↑` (when feed focused) | Navigate between feed items |
| Crush `g/G` | `Home/End` | Jump to top/bottom of feed |
| Crush `u/d` | `PageUp/PageDown` | Half-page scroll |
| Crush `c/y` | `Ctrl+C` (on focused item) | Copy content to clipboard |
| CC `Tab` | Toggle in composer | Switch thinking mode |
| CC `Escape Escape` | `Escape` twice | Cancel/rewind |
| Crush `Ctrl+D` | `Ctrl+D` | Toggle details panel |

**Important:** these are accelerators, not the primary path. Click/tap works for everything. Keyboard makes power users fast.

### Status Indicators

**Both CLIs use the same vocabulary:**
```
● (filled dot)    — running/active     — blue/cyan
✓ (checkmark)     — success/complete   — green
× (x-mark)        — error/failed       — red
⊘ (circle-slash)  — canceled           — yellow
◌ (hollow dot)    — pending/idle       — gray
◇ (diamond)       — info/model marker  — muted
```

**No text labels.** Icon + color only. This is what both CC and Crush do. V2 probably had text labels taking up space — cut them.

### Tool Call Rendering — Per-Type

Crush has polymorphic tool renderers (each tool type gets a custom component). CC does the same with collapsed summaries. Our web feed should match:

| Tool Type | Collapsed (default) | Expanded |
|-----------|-------------------|----------|
| **Read** | `✓ Read 3 files` | File paths + syntax-highlighted content with line numbers |
| **Edit** | `✓ Edited backend/schema.py` | Unified diff (red/green, `+`/`-` prefixes) |
| **Bash** | `✓ Ran: git status` | Full terminal output (ANSI-rendered) |
| **Write** | `✓ Created new-file.py` | File content with syntax highlighting |
| **Grep** | `✓ Searched for "pattern"` | Match results with file:line format |
| **Glob** | `✓ Found 12 files` | File list |
| **WebFetch** | `✓ Fetched example.com` | Response content (markdown rendered) |
| **Task/Agent** | `✓ Spawned frontend agent` | Agent creation details |
| **SendMessage** | `✓ → backend: "deploy the fix"` | Full message content |
| **Generic** | `● {tool_name} {first_arg}` | Raw JSON args + output |

**Truncation (from CC):**
- Tool output > 10 lines when expanded → show 10 + `"… (N lines hidden)"` + click to show all
- Output > 120K chars → hard truncate with `"(output truncated)"`
- Collapsed summary always fits one line

### Diff Display

**Both CLIs use unified diff:**
```
  import { useQuery } from 'urql';

- const [data, setData] = useState([]);
+ const [data, setData] = useState<Data[]>([]);

  return data;
```
- Removed lines: red text or red background, `-` prefix
- Added lines: green text or green background, `+` prefix
- Context lines: muted/gray, no prefix
- Line numbers shown on expanded view
- **No side-by-side** — unified diff only (both CLIs agree)

### Thinking Box (from Crush)

Crush's thinking box pattern is more detailed than CC's:
- **Collapsed**: last 10 lines visible + `"… (N lines hidden)"` + "Thought for {duration}" footer
- **Expanded**: full thinking content, plain markdown (no syntax highlighting — intentionally muted)
- **Style**: visible border, slightly different background than normal messages, muted text
- **Toggle**: click or space to expand/collapse

### Colors, Animation & Focus States

**See section 16 for the complete token reference** — all 40+ charmtone colors, 10 syntax highlighting tokens, diff hex values, animation timing, focus/blur states, border characters, spacing constants, and CC CLI thinking indicators. Section 16 is the exhaustive source; this section references the tokens by name.

**Key tokens used in feed components:**
- Backgrounds: `--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-overlay`
- Text: `--fg-base`, `--fg-muted`, `--fg-white` (Butter)
- Accent: `--accent` (Charple), `--accent-secondary` (Dolly)
- Status: `--status-error` (Sriracha), `--status-warning` (Zest), `--status-info` (Malibu), `--status-success` (Julep)
- Animation: 50ms frame interval (20fps), 400ms ellipsis cycle, 120ms thinking phase, opacity+max-height transitions only
- Focus: `--border-focused-color` + `▌` thick border + full brightness text
- Blur: `--border-blurred-color` + `│` thin border + muted text

### Dense Information Packing

**Both CLIs agree:**
- Monospace body text (code and prose in same typeface)
- Max content width: 120 characters → `max-width: 960px` in web
- Hierarchy through color and weight, NOT font size
- 8px base grid (from Crush's 2-character terminal spacing)
- 1 blank line between feed items (from Crush's `gap: 1` between list items)
- No unnecessary padding, no card shadows, no rounded corners on feed items

### Layout

```
┌─ StatusBar (fixed top, L0) ─────────────────┐
│  3 agents  ● 2 running  × 1 error  $1.42    │
├─ Sidebar (L1) ──────┬─ Feed (L2) ───────────┤
│  ● backend  running  │  [user message]       │
│  ✓ frontend idle     │  [assistant streaming] │
│  × qa       error    │  [tool call cards]    │
│                      │  [team messages]      │
│                      │                       │
├──────────────────────┴───────────────────────┤
│  Composer (fixed bottom)                     │
│  ❯ message to: backend                      │
└──────────────────────────────────────────────┘
```

### What This Means for Implementation

Every web component traces back to a CLI source:

| Web Component | CLI Source | Style Source |
|--------------|-----------|-------------|
| `<ThinkingIndicator />` | Crush `anim.go` + CC thinking shimmer | Crush gradient cycling |
| `<ToolCallCard />` | Crush `tools.go` + CC tool call cards | Crush focused/blurred states |
| `<ToolCallHeader />` | Both: icon + name + summary one-liner | Crush status icons + colors |
| `<DiffView />` | Both: unified diff with red/green | CC diff coloring |
| `<CodeBlock />` | Both: syntax highlighted + line numbers | Crush Chroma theme |
| `<StreamingText />` | Both: chunk-by-chunk markdown render | Crush markdown via Glamour |
| `<StatusDot />` | Both: `●✓×⊘◌` icon set | Crush charmtone palette |
| `<Feed />` (scroll) | Crush `list.go` auto-follow | Crush viewport-aware rendering |
| `<Composer />` | Both: monospace input, multiline | Crush textarea styles |

**No component is invented.** Every one has a direct CLI antecedent we can point to for "what does this look like?" and "how does this behave?"

### Ink Architecture — The Direct Translation Path

**Source: [github.com/vadimdemedes/ink](https://github.com/vadimdemedes/ink) (CC CLI is built on this)**

CC CLI is React. Not "like React" — actual React, with JSX, hooks, and the same component lifecycle. Ink is a custom React renderer that targets terminal ANSI output instead of DOM. Our web dashboard is also React targeting DOM. This is the most direct translation path possible: React → React, swap the render target.

**Key Ink patterns that translate 1:1:**

**1. `<Static>` — Immutable history (the jitter fix)**

Ink splits the output into two regions:
```tsx
// Ink's pattern:
<Box flexDirection="column">
  <Static items={completedItems}>     {/* ← NEVER re-renders */}
    {item => <FeedItem key={item.id} {...item} />}
  </Static>
  <Box>                                 {/* ← live, re-renders on updates */}
    <StreamingText text={currentOutput} />
    <ThinkingIndicator />
  </Box>
</Box>
```

`<Static>` renders each item once, then removes it from the React tree. It's permanent output — finished tool calls, completed messages, closed thinking blocks. The live region below it is the only thing that re-renders during streaming.

**This is why CC CLI doesn't jitter.** Finished items are frozen. Only the active streaming region updates at 30fps. V2 likely re-rendered the entire feed on every update — every completed item re-ran its render function on every streaming chunk. That's the jitter.

**Web equivalent:**
```tsx
<div className="feed">
  <div className="feed-history">        {/* React.memo'd or virtualized, stable keys */}
    {completedItems.map(item => (
      <MemoizedFeedItem key={item.id} item={item} />
    ))}
  </div>
  <div className="feed-live">           {/* Only this re-renders during streaming */}
    <StreamingText text={currentChunks} />
    <ThinkingIndicator active={isThinking} />
  </div>
</div>
```

The critical insight: `React.memo` on completed FeedItems + stable keys = the web equivalent of Ink's `<Static>`. Completed items never re-render. Only the live section updates.

**2. Focus management hooks (from Ink's `useFocus` + `useFocusManager`)**

Ink provides a context-based focus system. Components register as focusable, a manager handles Tab/arrow navigation:

```tsx
// Ink:
const { isFocused } = useFocus({ id: itemId, autoFocus: isFirst });
const { focusNext, focusPrevious } = useFocusManager();

// Web equivalent (same pattern):
const FeedItem = ({ id }) => {
  const { isFocused } = useFeedFocus({ id });
  return (
    <div className={isFocused ? 'feed-item focused' : 'feed-item'}>
      {/* focused: bright border, normal text */}
      {/* blurred: subtle border, muted text */}
    </div>
  );
};

const Feed = () => {
  const { focusNext, focusPrev } = useFeedFocusManager();
  useKeyPress((key) => {
    if (key === 'ArrowDown' || key === 'j') focusNext();
    if (key === 'ArrowUp' || key === 'k') focusPrev();
    if (key === ' ' || key === 'Enter') toggleExpand(focusedId);
  });
};
```

**3. 30fps render throttling**

Ink caps renders at 30fps (33ms interval) using `es-toolkit/throttle` with `{leading: true, trailing: true}`. During streaming, this prevents the React tree from updating faster than the terminal can display.

Web equivalent: debounce markdown re-rendering at ~50ms during streaming. `requestAnimationFrame` for scroll updates. React's batching handles most of this, but streaming text chunks arriving every 10-20ms can overwhelm the renderer without explicit throttling.

**4. Text measurement caching**

Ink measures text dimensions (width in characters, height in lines) and caches by `(text, width, wrapMode)`. Re-measurement only happens if the input changes.

Web equivalent: cache rendered markdown output by content hash. If the same markdown string renders again (common during streaming where only the tail grows), reuse the previous DOM and append the delta.

**5. Component primitives mapping**

| Ink Primitive | Purpose | Web Equivalent |
|--------------|---------|---------------|
| `<Box>` | Flex container | `<div style={{display: 'flex'}}>` |
| `<Text>` | Styled text | `<span>` with monospace styles |
| `<Static>` | Immutable history | `React.memo`'d list + stable keys |
| `<Transform>` | Text transformer | CSS classes or styled-components |
| `<Spacer>` | Flex-grow fill | `<div style={{flexGrow: 1}}>` |

**Files to reference:** `/tmp/ink/src/components/Static.tsx`, `/tmp/ink/src/components/App.tsx` (focus management, 400+ lines), `/tmp/ink/src/ink.tsx` (render throttling lines 207-226), `/tmp/ink/src/hooks/use-focus.ts`

### Web-Specific Styling Patterns

**Source: [github.com/Vauth/vauth-terminal](https://github.com/Vauth/vauth-terminal) + [github.com/satnaing/terminal-portfolio](https://github.com/satnaing/terminal-portfolio)**

These aren't architecturally deep, but they solve the "make a web page feel like a terminal" CSS problem:

**Glass morphism for overlays/panels (from vauth-terminal):**
```css
.glass-panel {
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(120%);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9),
              inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
/* Top highlight line for depth */
.glass-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
}
```
Useful for: modal dialogs, VNC overlay panel, agent detail panel. Not for feed items (too heavy).

**Custom scrollbar (from terminal-portfolio):**
```css
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: var(--bg-base); }
::-webkit-scrollbar-thumb { background: var(--fg-muted); border-radius: 4px; }
```
Essential. Default browser scrollbar breaks the terminal aesthetic.

**Click-anywhere-to-focus (from both):**
```tsx
useEffect(() => {
  const focus = () => composerRef.current?.focus();
  document.addEventListener('click', focus);
  return () => document.removeEventListener('click', focus);
}, []);
```
The terminal always has focus. Clicking anywhere in the dashboard should focus the composer.

**Monospace font choice:** Ubuntu Mono or IBM Plex Mono, not system monospace. Both repos found that system monospace varies too much across platforms.

**Line entry animation (from vauth-terminal, uses Framer Motion):**
```tsx
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3 }}
>
  {feedItem}
</motion.div>
```
Subtle fade-in on new items. Web equivalent of Crush's staggered birth animation. Use sparingly — only on items entering the feed for the first time, not on re-renders.

---

## 18. Secret Management

**Steal from: IronClaw (encryption at rest) — but fix the injection**

### What to take

**Encryption at rest (from IronClaw):**
```rust
// AES-256-GCM with HKDF-derived keys
// Per-secret salt
// Proper authenticated encryption
```

### What NOT to take

IronClaw injects secrets via env vars. Broken for rotation and leaky to prompt injection.

### Our approach: tmpfs (RAM disk) injection

Originally designed as WS-based JIT delivery (agent requests secret over WS, relay returns it). But that requires patching CC's tool execution loop to pause and wait for a network call — tight coupling to the relay protocol.

**Simpler: tmpfs mount.**
- Mount a small RAM-backed volume (`/dev/shm/secrets` or a tmpfs mount) to the container
- When the backend approves a task that needs secrets, the relay writes the secret to a file in this RAM disk milliseconds before the tool is invoked
- The tool reads it like a normal file or env var
- The relay deletes the file once the tool process exits
- Secret never touches physical disk, and CC doesn't need to know about the relay protocol

**Flow:**
```
Agent calls tool that needs GITHUB_TOKEN
  → Relay: before_tool_call hook fires
    → Relay: checks SecretGrant for this agent
      → Relay: writes /dev/shm/secrets/GITHUB_TOKEN (plaintext, RAM only)
        → Tool executes, reads the file
          → Relay: after_tool_call hook fires
            → Relay: deletes /dev/shm/secrets/GITHUB_TOKEN
```

This is pragmatic — no protocol changes, CC works normally, secrets never persist.

**Crash recovery — zombie secret cleanup:**
If the container OOMs or the relay segfaults during tool execution, the `after_tool_call` hook never fires and the plaintext secret is left in `/dev/shm/`. Fix: the s6-overlay init script (`s6-rc` oneshot) must aggressively wipe `/dev/shm/secrets/*` on every boot. A restarted relay never inherits leaked credentials from a crashed run. Additionally, the relay's startup routine should wipe the directory before spawning CC, as a defense-in-depth measure.

---

## 19. Relay Architecture

**No single project has this. Assembled from: IronClaw (CC bridge) + OpenClaw (WS protocol) + our design (hook interception).**

The relay is the most critical piece that has no dedicated section anywhere else in this doc — yet it's referenced in sections 1, 2, 5, 10, 13, and 18. It's the process running inside every agent container, bridging Claude Code ↔ backend.

### What the relay does

```
┌─ Agent Container ───────────────────────────────┐
│                                                   │
│  ┌─ Relay Process ─────────────────────────────┐ │
│  │                                               │ │
│  │  CC Process (stdin/stdout) ←→ NDJSON Parser  │ │
│  │       ↕                           ↕           │ │
│  │  Command Injector            Event Normalizer │ │
│  │       ↕                           ↕           │ │
│  │  Hook Interceptor ←──────→ Event Buffer      │ │
│  │       ↕                           ↕           │ │
│  │  ┌─ WS Client ──────────────────────────┐   │ │
│  │  │  Authenticated connection to backend  │   │ │
│  │  │  Exponential backoff reconnection     │   │ │
│  │  │  Buffer flush on reconnect            │   │ │
│  │  └──────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### Components

**NDJSON Parser (from IronClaw section 13):**
- Spawns CC with `--output-format stream-json --verbose`
- Reads stdout line-by-line, parses `ClaudeStreamEvent` types
- Normalizes to `AgentEvent` (our glossary term)

**Event Normalizer:**
- `Assistant.Text` → `AgentEvent { stream: "assistant", data: { text } }`
- `Assistant.ToolUse` → `AgentEvent { stream: "tool", data: { name, args, status: "running" } }`
- `Assistant.ToolResult` → `AgentEvent { stream: "tool", data: { tool_use_id, content, status: "success"|"error" } }`
- `Result` → `AgentEvent { stream: "lifecycle", data: { cost_usd, input_tokens, output_tokens } }`
- Every event gets `agentId`, `seq` (per-agent), `ts`

**Command Injector:**
- Receives Messages from backend via WS
- Writes to CC's stdin as user turns
- Serializes: one message at a time, wait for CC to acknowledge before sending next (from OpenClaw's command lane pattern — Main lane = 1 concurrent)

**Hook Interceptor (from EdgeClaw section 10):**
- Watches CC's `ToolUse` events before they execute
- `Task(team_name=...)` → intercept, callback to backend, backend spawns container, return result to CC
- `SendMessage(...)` → intercept, route through backend, deliver to target agent's relay
- Other tool calls → pass through

**Event Persistence (via Redis Streams — section 5):**
- Every AgentEvent is pushed to Redis Stream `agent_events:{agentId}` (TTL 1 hour)
- Gateway is stateless — no in-memory buffers to lose on restart/scale
- On dashboard reconnect: gateway queries `XREAD` with client's `lastSeq` → perfect replay
- Relay doesn't need local buffering either — Redis is the buffer between relay and gateway

**WS Client (from OpenClaw section 1):**
- Connects to backend with `SessionToken` (from IronClaw section 2)
- Exponential backoff: 800ms → 15s (from OpenClaw)
- Heartbeat: responds to server ticks
- On auth failure: log error, stop retrying (token was revoked = agent should stop)

### Lifecycle

```
container starts
  → relay starts
    → spawns CC process
    → connects WS to backend (authenticate with SessionToken)
    → begins streaming AgentEvents
    → receives commands (Messages, task assignments)
    → ... runs until ...
  → CC exits (natural completion or crash)
    → relay reports exit status via lifecycle event
    → relay stays alive briefly for final event flush
    → container stops
```

**Crash recovery:**
- CC crashes → relay detects (stdout EOF), sends `AgentEvent { stream: "lifecycle", data: { status: "error", reason } }`
- WS drops → relay buffers events, reconnects with backoff
- Backend restarts → relay reconnects, re-authenticates, flushes buffer
- Relay itself crashes → container's s6-overlay restarts it, CC process is orphaned and killed

### Failure modes

| Failure | Relay behavior | Dashboard sees |
|---------|---------------|----------------|
| CC hangs (no output) | Heartbeat timeout → report `unresponsive` | Agent status: `unresponsive` |
| CC crashes | Report error event, flush, stop | Agent status: `error` + error in feed |
| WS disconnect (brief) | Buffer events, reconnect, flush | Brief gap, then catches up |
| WS disconnect (long) | Buffer overflows, drop oldest, set gap flag | Status: `disconnected`, gap warning in feed |
| Backend rejects token | Stop retrying, log error | Agent disappears from dashboard |
| Relay OOM | s6 restarts relay, CC is killed | Agent restarts from scratch |

---

## 20. Integration Spine — End-to-End Data Flow

This is the missing piece. Every section above describes a concern in isolation. This section traces the data flow that connects them — the spine of the system.

### Outbound: agent activity → dashboard

```
CC stdout (NDJSON)
  → Relay: NDJSON Parser (section 13)
    → Relay: Event Normalizer → AgentEvent
      → Relay: Hook Interceptor (pass-through for non-intercepted events)
        → Relay: WS Client → sends Frame { type: "event", event: "agent.event", payload: AgentEvent }
          → Backend: WS handler receives Frame
            → Backend: persists AgentEvent to DB (section 6)
            → Backend: fans out to project subscribers (section 1 broadcaster)
              → Dashboard: WS client receives Frame
                → Zustand store: dispatch(agentEventReceived(event)) (section 21)
                  → Feed transform: AgentEvent[] → FeedItem[] (section 21)
                    → React render: component tree (section 17)
                      → User sees: streaming text, tool call cards, status updates
```

**Latency budget:** CC output → user sees it. Target: <100ms. The critical path is: NDJSON parse (~1ms) + WS send (~5ms) + backend fan-out (~5ms) + WS receive (~5ms) + store dispatch (~1ms) + React render (~16ms) = ~33ms. Leaves headroom for debouncing (50ms throttle on streaming text).

### Inbound: user message → agent

```
Composer input → user types message, selects agent
  → Zustand store: dispatch(sendMessage({ agentId, text }))
    → Store middleware: optimistic update (Message appears in feed immediately)
      → GraphQL mutation: sendMessage(agentId, text)
        → Backend: persists Message to DB
          → Backend: routes to agent's relay WS connection
            → Relay: Command Injector
              → CC stdin: inject as user turn
                → CC processes, streams response (→ outbound flow above)
```

**If mutation fails:** store middleware rolls back the optimistic update. Message disappears from feed. Error toast shown.

### Team coordination: agent spawns agent

```
Lead agent calls Task(team_name="my-project", name="frontend", prompt="build the UI")
  → CC emits ToolUse event
    → Relay: Hook Interceptor catches Task with team_name
      → Relay: sends hook callback to backend (HTTP POST or WS RPC)
        → Backend: createAgent mutation (provisions container, generates SessionToken)
          → New container boots (~30-60s)
            → New relay connects, authenticates
              → Backend: sends "agent.joined" event to project subscribers
                → Dashboard: new agent appears in sidebar
          → Backend: returns tool result to original relay
            → Relay: injects result into CC as ToolResult
              → Lead agent sees: "frontend agent created"
                → Lead calls SendMessage(recipient="frontend", text="start with the header")
                  → (inbound flow, routed to frontend agent's relay)
```

### Agent-to-agent messaging

```
Agent A calls SendMessage(recipient="backend", text="I need the API schema")
  → Relay A: Hook Interceptor catches SendMessage
    → Backend: routes Message to Agent B
      → Relay B: Command Injector → CC stdin (as user turn from "frontend")
        → Agent B processes, responds
          → Agent B calls SendMessage(recipient="frontend", text="here's the schema: ...")
            → (reverse flow back to Agent A)
```

### Reconnection: dashboard drops and reconnects

```
Dashboard WS disconnects (network blip, page refresh)
  → Dashboard: WS client detects disconnect
    → Zustand store: dispatch(connectionStateChanged("reconnecting"))
      → UI shows reconnecting indicator
    → WS client: exponential backoff reconnection (800ms → 15s)
      → Reconnects, sends handshake with auth + lastSeq per agent
        → Backend: sends HelloOk with full state snapshot (agent statuses, team roster)
          → Backend: queries Redis Streams (XREAD per agent since lastSeq)
            → Backend: replays missed events over WS
              → Zustand store: applySnapshot() then process replayed events
                → Feed transform: rebuild FeedItems from snapshot + replay
                  → UI: seamless catch-up, no duplicate items (Redis stream IDs handle dedup)
```

**Gateway is stateless.** No in-memory buffers. Redis Streams is the replay source. Gateway can restart, scale horizontally, or load-balance freely — any gateway instance can serve the replay by querying Redis.

### Event replay reconciliation (the tricky part)

When a dashboard reconnects, it receives: (1) a snapshot and (2) replayed events from Redis Streams. These can overlap — an event might be reflected in the snapshot AND in the stream.

**Rules:**
- Snapshot is the source of truth for current state (agent statuses, team roster, session metadata)
- Redis Stream events are the source of truth for feed content (what happened during disconnect)
- Dedup by Redis stream ID — `XREAD` with the client's last-seen ID naturally skips already-seen events
- If the stream has been trimmed (events older than TTL), show a "some events may be missing" divider in the feed
- Tool calls that started before disconnect and finished during disconnect: the snapshot shows the final state (success/error), the stream has the intermediate events. Apply stream events first, then reconcile final state from snapshot.

**Middleware and request pipeline:** Django's built-in middleware handles auth, CORS, and request routing. Strawberry GraphQL middleware handles permission checks. No custom middleware chain needed — use the framework. OpenClaw's flat RPC dispatcher pattern (section 19 in original) applies to the WS protocol's method dispatch inside the backend, not as a separate middleware layer.

---

## 21. Frontend Patterns (from V2) — Ideas to Carry, Implementation Suspect

**Source: `docs/V2-REDESIGN.md`**

**Honest assessment:** V2-REDESIGN describes ideal patterns, but the actual v2 implementation felt clunky and disconnected. The UI lacked the immediacy and tactile quality of CC CLI and Crush. These are ideas worth carrying forward, but the implementation must be rebuilt against the CLI as the reference — not v2's code.

### Zustand as THE single source of truth (idea: yes, implementation: redo from scratch)

The principle is right — dashboard state in Zustand, not urql cache. But V2 likely didn't fully commit to this. If ANY state lived outside the store (component local state, urql cache, derived-on-render), that's where the clunky/disconnected feel came from. Two sources that can disagree = jitter, stale renders, coordination bugs.

**Why the CLIs don't have this problem:** Crush has ONE `Chat` model struct that owns everything — feed items, scroll position, animation state, focus, selection. CC has ONE React tree re-rendering from a single state root. There is no second source to disagree with.

**The V3 rule: the store owns STRUCTURAL state:**
- Feed item list (IDs, types, statuses: streaming/complete/error)
- Agent statuses (every agent's AgentStatus)
- Scroll state (`follow: boolean`, so the scroll component reads from store, not local)
- Expanded/collapsed state per feed item (so "expand all" is a store action, not N local toggles)
- Active agent selection (which agent's feed is showing)
- WS connection state (connected/reconnecting/disconnected)
- Session metadata (cost, tokens, duration)
- Sequence numbers (per-agent `lastSeq` for dedup)

**What must NOT be in the store (the streaming exception):**
- **Streaming text buffers** — high-frequency token chunks (arriving every ~50ms per agent) must NOT go through Zustand → React reconciliation. Pushing 50ms chunks for N active agents into a global store will thrash the React tree and kill the 30fps feel. Instead: streaming text lives in a **mutable ref** (`useRef`) local to the `<StreamingText />` component. Chunks append directly to the ref and update only that component's text DOM node, bypassing the global React render cycle. When the stream completes, the final text is written to the store as a completed FeedItem (one render, not hundreds).
- Ephemeral hover states, CSS transitions — view-only
- Animation frame counters (spinner ticks, etc.) — local to the animated component

**Why the exception matters:** Crush gets away with everything-in-one-model because Bubble Tea's render loop is 20fps with differential output — it only updates changed terminal cells. React's reconciliation is fundamentally different — a global store update triggers the entire subscriber tree to check for changes. For structural state (item added, status changed, expand toggled) this is fine — those are infrequent. For streaming text at 50ms intervals × N agents, it's a performance cliff.

**The pattern:**
```
Structural events (infrequent):
  WS frame → store.dispatch(action) → React re-renders from store

Streaming text (high-frequency):
  WS frame → ref.current += chunk → DOM text node update (no React render)
  Stream complete → store.dispatch(streamComplete(finalText)) → one React render
```

**The pattern (from both CLIs):**
```
WS frame arrives → store.dispatch(action) → React re-renders from store
```
One direction. No callbacks, no side-channel updates, no "sync after the fact."

- See `V2-REDESIGN.md` lines 115–246 for the intended architecture (which V2 didn't fully realize)
- **The bar:** Crush's single-model architecture. Every state change propagates in one tick.

### GraphQL schema (carry forward)

Queries, mutations, and 2 subscriptions (agent events, agent status). The schema contract is sound. Carry the schema shape forward, regenerate types.

- See `V2-REDESIGN.md` lines 650–708

### One-transform-one-shape feed pipeline (idea: yes, but must support CLI dynamics)

Raw AgentEvents → single transform → FeedItem[] is correct. But the transform must produce items that support CLI-level dynamics: expand/collapse state, streaming text, thinking indicators, truncation with expand. V2's transform may have been too simple — flattening events into static items instead of preserving the interaction states.

- See `V2-REDESIGN.md` lines 405–429
- **What was missing:** FeedItems need state (collapsed/expanded, streaming/complete, truncated/full). The transform must preserve these states, not strip them.

### Disconnect scenario matrix (carry forward)

Explicit handling for: clean close, network drop, server restart, token expiry, stale tab. The scenario design is solid.

- See `V2-REDESIGN.md` lines 736–790

### Optimistic updates (discussion item)

Store snapshots before mutations, rollback on failure.

- See `V2-REDESIGN.md` lines 924–945
- **Status:** needs discussion — v2's clunky feel may partly come from optimistic updates not landing correctly, or from their absence where they were needed

**NOT carried forward:** cursor-based feed pagination (didn't work in practice).

**The real bar:** CC CLI + Crush. See section 17 for the 1:1 component map.

---

## What We Actually Build (The Delta)

Everything above is stolen. Here's what doesn't exist anywhere — plus an honest accounting of what "carry forward" actually means.

### Net-New (no project has this)

**1. Multi-agent teaming coordination (~3,000 lines)**

This is our core IP.

- **Team primitives** — create team, spawn teammate, send message, broadcast, task assign, shutdown
- **`before_tool_call` hook** intercepting `Task(team_name=...)` → backend spawns container
- **Native + simulated teaming** — CC uses TeamCreate/SendMessage natively; non-CC agents get injected `/message`, `/task`, `/tasks` commands parsed by their adapter
- **Task model** synced from agent stream observation (TaskCreate, TaskUpdate, TaskList events)
- **Team-aware CLAUDE.md generation** — roster, roles, communication instructions, spawning syntax (lead only)
- **Dashboard team visualization** — roster panel, task board, inter-agent message flow in feed

Source of interaction patterns: Claude Code's own teaming (TeamCreate, SendMessage, TaskList, TaskUpdate). We abstract these to work platform-side.

**Turn budgeting (anti-deadlock):** Every spawned task has a `max_turns` limit enforced in the `before_tool_call` hook. Inter-agent messages cost a synthetic "team token." If an agent exhausts its budget without emitting `TaskUpdate(status='completed')`, the gateway forcibly pauses the agent and flags it for human intervention. This prevents agreement loops, chatter explosion, and runaway agent-to-agent conversations.

**2. Relay process (~800 lines)**

See section 19. No single project has the full relay. Assembled from IronClaw (CC bridge), OpenClaw (WS client), and our design (hook interception, event buffering).

**3. Event replay via Redis Streams (~100 lines of integration)**

No project has replay. OpenClaw loses events during disconnects. IronClaw has no reconnection. We use Redis Streams (proven primitive) — the integration code is small, the heavy lifting is Redis.

**4. tmpfs secret injection (~50 lines)**

No project does this correctly. IronClaw uses env vars (broken for rotation), OpenClaw has no secret management. Our approach: tmpfs RAM disk write/delete around tool calls (section 18).

**5. Per-agent event throughput limiting (~100 lines)**

No project rate-limits per-agent event output.

**6. Structured error propagation from containers (~100 lines)**

IronClaw serializes worker errors to strings. We send typed error payloads.

**7. Metrics (~100 lines)**

No project has Prometheus/OTEL metrics.

**8. Lazy WS subscriptions — fleet-level dashboard multiplexing (~200 lines)**

No project has this (they all manage single agents). When monitoring 100+ agents, the dashboard must NOT subscribe to all agents' full text streams simultaneously — the browser's JS thread will lock up processing 50ms frames × 100 agents. Pattern: subscribe to `agent.status` events for all project agents (lightweight, structural — status changes, error flags). Subscribe to `agent.event` (full stream) only for the currently focused agent. On focus switch: unsubscribe from old, subscribe to new, backfill from Redis Streams. This maps directly to the L0/L1/L2 information density ladder — L1 sidebar needs structural state only, L2 feed needs the full stream.

**9. LiteLLM Proxy integration (~50 lines of config, see section 11)**

Fleet-level LLM rate limiting via LiteLLM Proxy. No project has this because no project runs N agents sharing one API key. Configuration, not code — but it's a deployment dependency that must exist before scaling past ~5 agents.

### Actually Ports (code transfers with adaptation)

**8. Container image spec** — `agent/` directory: Dockerfile, s6-overlay, rootfs convention. Exists, carries forward.

**9. VNC / noVNC observation layer (~200 lines)** — L3 deep-dive embed. Exists in v2, ports directly.

**10. CLAUDE.md generation (~150 lines)** — `_build_claude_md()` exists, being formalized.

**11. GraphQL schema shape** — queries, mutations, subscriptions contract. Carries forward, regenerate types.

**12. Disconnect scenario matrix** — the scenario design is solid. Carries forward.

### Rewrite Informed by V2 (ideas carry, code doesn't)

This is where previous estimates were dishonest. V2's feed, store, and transform need to be rebuilt from scratch — informed by the CLI patterns in section 17 and the store discipline in section 21. The ideas are right but the implementation didn't achieve CLI-level quality.

**13. Feed components (~3,000 lines, rewrite)** — V2 had static feed items. V3 needs stateful items with expand/collapse, streaming, thinking indicators, per-tool-type renderers, keyboard navigation. This is a rewrite using section 17 as the spec and Crush/CC as the reference.

**14. Zustand store + WS transport (~1,500 lines, rewrite)** — V2 didn't fully commit to the store as single source of truth. V3 rebuilds with everything in the store (section 21), one-direction data flow, no split state.

**15. Feed transform (~500 lines, rewrite)** — V2 flattened events into static items. V3 transform must preserve interaction state (streaming/complete, collapsed/expanded, truncated/full).

**16. Design tokens + theme migration (~800 lines, rewrite)** — V2 had ~25 color values. V3 expands to full token schema from Crush's charmtone palette (section 16). augmented-ui integration carries forward.

### Glue Code (the hidden tax)

Stitching together patterns from Rust, Go, and TypeScript into Python and React is not free. The paradigms fight you:

- Rust's `enum` error hierarchy → Python dataclasses (different ergonomics, no exhaustive matching)
- Go's 20fps Bubble Tea render loop → React DOM updates (different batching model, need careful debounce)
- OpenClaw's Node.js WS server → Django Channels (different async model, different connection lifecycle)
- IronClaw's `subtle::ConstantTimeEq` → Python's `secrets.compare_digest()` (1:1, but most aren't this clean)

Estimate **~2,000 lines of glue code** that doesn't map to any single section but is needed to make the stolen patterns work together in our stack.

---

## Total (honest)

```
Net-new code:         ~4,450 lines (teaming w/ turn budget + relay + Redis integration + tmpfs secrets + throttle + errors + metrics + lazy WS subs + LiteLLM config)
Rewrite from V2:      ~5,800 lines (feed components + store + transform + design tokens)
Glue code:            ~2,000 lines (polyglot translation + integration wiring)
Actually ports:       ~1,500 lines (container image, VNC, CLAUDE.md, GraphQL schema, disconnect matrix)
Stolen patterns:      ~1,200 lines of adapted code from 5 projects

Total:                ~14,950 lines
Actually new/rewrite: ~12,250 lines (82%)
Clean carry-forward:  ~2,700 lines (18%)
```

**The previous estimate was backwards.** We said 82% carry-forward, 18% new. The honest number is closer to 82% new/rewrite, 18% clean carry-forward. Redis Streams and tmpfs injection reduced custom code vs. the original design, but the overall ratio stays the same.

The patterns we steal reduce **design time** enormously — we're not inventing solutions, we know exactly what each piece should look like and how it should behave. But the code still needs to be written. The value of the LIFT-MAP is knowing WHAT to build and HOW it should behave, not having the code already written.

---

## Execution Risks

Honest assessment of where this will bite us, incorporating feedback from multiple reviewers.

### 1. The polyglot translation tax

We're mapping paradigms from Rust (IronClaw) and Go (Crush) into Python and TypeScript/React. This isn't a 1:1 port:

- Rust's robust `enum` error handling and trait-based capabilities → Python dataclasses (no exhaustive matching, different testing patterns)
- Go's 20fps terminal rendering loop → React DOM updates (browser main thread has different constraints, need careful debounce to avoid melting it)
- The paradigms will fight. Budget extra time for the adaptation layer, not just the logic.

**The Rust safety evaporation problem:** IronClaw gets compile-time exhaustive matching, channel capacity limits, and type-checked state transitions for free. Python gives you none of this. The safety properties we're stealing only survive the port if we enforce them manually: (1) strict Pydantic schemas for every wire object (Frame, AgentEvent, HookResult — no `dict[str, Any]`), (2) explicit state transition validation (the `can_transition_to()` guard must raise, not silently pass), (3) central error class hierarchy (not scattered `except Exception`), (4) structured logging enforced everywhere (no bare `print()`). Without this discipline, the safety we're stealing from Rust evaporates silently into Python's permissiveness.

### 2. Multi-agent emergent behavior

We allocated ~3,000 lines for teaming coordination. The code volume isn't the primary risk — it's the emergent behavior:

- **Agreement loops** — agents saying "Sounds good!" back and forth forever
- **Hallucinated tool results** — one agent tells another "I deployed the fix" when it didn't
- **Race conditions** — two agents assigning themselves the same task simultaneously
- **Chatter explosion** — N agents × M messages = O(N²) message volume

Mitigation (now built into the design):
- **Turn budgeting** — `max_turns` per task, synthetic "team tokens" per inter-agent message, forced pause on budget exhaustion (see Delta section)
- **Task locking** — optimistic lock on the task row prevents double-assignment
- **Message rate limits** — per agent pair, enforced in the `before_tool_call` hook
- **Human escalation** — budget-exhausted agents are paused and flagged, not killed

### 3. Event replay reconciliation

Redis Streams (section 5) solves the buffer persistence problem but still creates a state reconciliation challenge. If an agent starts a tool call, the dashboard disconnects, the tool finishes, and the dashboard reconnects — we need to merge the snapshot (which shows the final state) with the streamed events (which have the intermediate steps) without duplicating the tool output. See section 20 for the reconciliation rules. Redis Streams' built-in sequence IDs (`XREAD` with last-seen ID) handle dedup at the transport layer.

### 4. The "carry forward" trap

V2 code that "works" may carry forward bugs, wrong assumptions, or patterns that don't compose with V3's architecture. Every piece of V2 code that enters V3 should be audited against:

- Does it read from the Zustand store or from some other source?
- Does it handle streaming state or only complete state?
- Does it support expand/collapse or is it static?

If it fails any of these, it's a rewrite, not a port. The honest total above reflects this.

### 5. Feed rendering performance

Both CLIs render at 20-30fps with differential updates. The web equivalent (React + virtualized list + markdown rendering + syntax highlighting) has a fundamentally different performance profile. The critical path:

- Streaming text re-renders markdown on every chunk. If chunks arrive at 50ms intervals and markdown rendering takes >50ms, we get backpressure in the UI thread.
- Mitigation: debounce markdown rendering at 100ms, show raw text in between. Or use a streaming-friendly markdown renderer that appends rather than re-renders.
- Virtualized list (Virtuoso or similar) must handle dynamic item heights as tool calls expand/collapse. This is a known pain point — test with 500+ items early.

**The virtualized list + async content trap:** Worse than dynamic heights from expand/collapse — when an agent streams a markdown image tag (`![chart](url)`), the text renders, the virtualizer calculates height, and then the image loads asynchronously, expanding the height again. This causes violent scroll jumping. Fix: enforce strict dimensions on media elements (placeholder boxes with fixed aspect ratios) before they load, or trigger a manual `ResizeObserver` callback to the virtualizer every time a chunk renders. Same issue with syntax-highlighted code blocks that reflow on highlight.

### 6. Browser main-thread death at fleet scale

The `useRef` streaming optimization (section 21) solves single-agent jitter. But if the dashboard processes 50ms WS frames for 100 agents simultaneously, the JS thread locks up regardless of React optimizations — the WS message parsing and routing itself is the bottleneck.

Mitigation: lazy WS subscriptions (see Delta item 8). The dashboard subscribes to structural events (status changes) for all agents, but full text streams only for the focused agent. Background agents show L1 state (status dot + last action summary), not live streaming text. On focus switch, backfill from Redis Streams.

### 7. Thundering herd on deploy

When the backend restarts (deploy, crash, scaling), all connected dashboards and relays disconnect simultaneously. When the gateway comes back up, they all reconnect and hit Redis with `XREAD` queries at the same millisecond.

Fix: randomized jitter on reconnection backoff (already added to section 1: `jitter = Math.random() * 1000`). Same principle applies to DB batch flushes (section 6: `5s + random(0, 2000)ms`). The jitter must be applied at EVERY reconnection and periodic flush point — not just the initial backoff.

### 8. Provider API rate limit wall at scale

100 agents sharing one Anthropic API key will hit TPM limits instantly. Individual circuit breakers (from IronClaw) make this worse — each agent retries independently, amplifying the stampede.

Fix: LiteLLM Proxy (see section 11). Fleet-level TPM tracking, global queuing, provider failover. This is a deployment dependency, not code — but it must exist before scaling past ~5 agents. Without it, scaling is fundamentally blocked regardless of how good the rest of the architecture is.

### 9. What we deliberately defer

These are real needs that we're not building in V3. Acknowledging them prevents scope creep:

- **Channel adapters** (section 12) — WhatsApp, Slack, etc. Deferred to V4. The interface is defined, implementations come later.
- **Model failover** — OpenClaw's automatic provider switching on error. Nice to have, not launch-blocking.
- **Per-tool rate limiting** — from IronClaw. Only needed if we expose tool-level controls to users.
- **Audit log** — who did what when. Important for multi-tenant, not needed for dogfooding.
- **WASM-based rate limiter** — IronClaw's approach. Python's `time.monotonic()` + a dict is fine for now.
- **Container orchestrator (K8s/Nomad)** — raw `docker run` works for dogfooding (3-5 agents). At 50+ agents, need a real orchestrator for scheduling across worker nodes, resource limits, and auto-scaling. Modal handles this for serverless runtime; Docker runtime needs K8s. Deferred until self-hosted fleet demand materializes.
