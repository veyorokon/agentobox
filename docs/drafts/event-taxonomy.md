# Event Taxonomy: Structured Logging Convention

> Status: DRAFT — pending convention approval + architecture test enforcement (task #20)

## Purpose

Design a structured event naming convention for all backend structlog events,
optimized for **LLM-assisted debugging**. When filtered by `agent_id` and read
chronologically, events should tell a coherent story of what happened and why.

---

## Naming Grammar

```
{domain}.{action}          — 2 levels (default)
{domain}.{sub}.{action}    — 3 levels (when domain has distinct sub-resources)
```

**Rules:**

1. Dot (`.`) separates hierarchy levels
2. Snake_case (`_`) within each segment
3. Lowercase throughout
4. 2-3 levels only (never 1, never 4+)
5. Final segment is past-tense verb or state description
6. Regex: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,2}$`

**Rationale:** Dots for hierarchy (grep `relay.*` for all relay events),
underscores for multi-word segments (industry consensus: OTel, Stripe, Datadog).
2-3 levels is the sweet spot — fewer loses structure, more adds noise.

---

## Domain Registry

Every log event belongs to exactly one domain. Domains map to backend
subsystems — each has a clear owner and boundary.

| Domain | Subsystem | Files |
|--------|-----------|-------|
| `lifecycle` | Agent CRUD + provisioning | lifecycle.py, provision.py |
| `relay` | WebSocket relay connection | consumers.py (RelayConsumer) |
| `stream` | Stream event processing | stream.py |
| `mcp` | MCP coordination (messaging, tasks, spawning) | mcp_coord.py |
| `callback` | Permission/plan callbacks | callbacks.py |
| `feed` | Team feed item management | feed.py |
| `broadcast` | Django Channels pub/sub | broadcast.py |
| `reconciler` | Background reconciliation loop | reconcile.py |
| `runtime` | Container/sandbox operations | runtimes/docker.py, runtimes/modal.py |
| `graphql` | GraphQL operations | mutations.py, subscriptions.py |
| `comms` | Message delivery + agent control | comms.py |
| `vnc` | VNC proxy WebSocket | consumers.py (VncProxyConsumer) |
| `auth` | Authentication | auth_relay.py, auth.py |

---

## Full Event Taxonomy

### lifecycle — Agent creation, provisioning, teardown

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `lifecycle.agent_created` | info | agent_id, runtime, workspace_path | `creating_agent` + `agent_created` |
| `lifecycle.container_created` | info | agent_id, sandbox_id, vnc_url, elapsed_s | `container_created` |
| `lifecycle.workspace_provisioned` | info | agent_id, sandbox_id, context_path | `workspace_provisioned` |
| `lifecycle.secrets_resolved` | info | agent_id, count | `secrets_resolved` |
| `lifecycle.relay_launched` | info | agent_id, team_name, parent_session_id | `relay_launched` |
| `lifecycle.agent_provisioned` | info | agent_id, elapsed_s | `agent_provisioned` |
| `lifecycle.provision_failed` | exception | agent_id, error | `agent_provision_failed` |
| `lifecycle.agent_killed` | info | agent_id | `agent_killed` |
| `lifecycle.agent_removed` | info | agent_id | `agent_removed` |
| `lifecycle.agent_restarted` | info | agent_id | `agent_reset_complete` |
| `lifecycle.restart_skipped` | info | agent_id, reason | `restart_skipped_already_deploying` |
| `lifecycle.orphan_cleaned` | info | agent_id, sandbox_id | `orphan_sandbox_terminated` |
| `lifecycle.skills_provisioned` | info | agent_id, count | `skills_provisioned` |
| `lifecycle.agent_not_found` | warning | agent_id | `agent_not_found` (×5 locations) |

**NEW (gap fills):**

| Event | Level | Context Fields | Why |
|-------|-------|---------------|-----|
| `lifecycle.provision_started` | info | agent_id, runtime | Mark start so elapsed_s can be computed |
| `lifecycle.status_changed` | info | agent_id, from, to, trigger | Centralized status transition log — catches race conditions |

### relay — WebSocket relay connection lifecycle

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `relay.connected` | info | agent_id, backfill_ran, backfill_count | `relay_ws_connected` |
| `relay.disconnected` | info | agent_id, code, source | `relay_ws_disconnected` |
| `relay.rejected` | warning | agent_id, reason | `relay_ws_reject` |
| `relay.update_failed` | warning | agent_id | `relay_connected_update_failed` |

**NEW (gap fills):**

| Event | Level | Context Fields | Why |
|-------|-------|---------------|-----|
| `relay.backfill_sent` | info | agent_id, count, source(deploy\|reconnect) | Know how many messages were backfilled and why |

### stream — Stream event processing from relay

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `stream.process_exit` | info | agent_id, exit_code, stderr_len | `stream_process_exit` |
| `stream.plan_auto_approved` | info | agent_id, tool_use_id | `plan_auto_approved` |
| `stream.plan_pending` | info | agent_id, tool_use_id | `plan_pending_approval` |
| `stream.plans_superseded` | info | agent_id, count | `plans_superseded` |

**NEW (gap fills):**

| Event | Level | Context Fields | Why |
|-------|-------|---------------|-----|
| `stream.event_received` | debug | agent_id, event_type | Detect agent silence — gap between last event and now = unresponsive (story 6) |
| `stream.session_started` | info | agent_id, session_id, resumed | Know if session resume succeeded or fell back to fresh (story 9) |
| `stream.session_result` | info | agent_id, session_id, cost_usd, turns, input_tokens, output_tokens | Per-session cost visibility, anomaly detection (story 10) |

### mcp — MCP coordination (team messaging, tasks, spawning)

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `mcp.message_sent` | info | sender, recipient | `mcp_send_message` |
| `mcp.broadcast_sent` | info | sender | `mcp_send_broadcast` |
| `mcp.shutdown_requested` | info | sender, target | `mcp_shutdown_request` |
| `mcp.teammate_spawned` | info | spawner, new_agent | `mcp_teammate_spawn` |
| `mcp.task_created` | info | agent_name, subject | `mcp_task_create` |
| `mcp.task_updated` | info | agent_name, task_id, fields | `mcp_task_update` |
| `mcp.task_deleted` | info | agent_name, task_id | `mcp_task_delete` |

### callback — Permission and plan callbacks

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `callback.permission_requested` | info | agent_id, tool, request_id | `permission_request` |
| `callback.malformed` | warning | agent_id | `malformed_callback` |
| `callback.unknown_type` | warning | agent_id, type | `unknown_callback_type` |

**NEW (gap fills):**

| Event | Level | Context Fields | Why |
|-------|-------|---------------|-----|
| `callback.permission_resolved` | info | agent_id, request_id, verdict | Know when + how permission was resolved |
| `callback.plan_resolved` | info | agent_id, tool_use_id, verdict | Know when + how plan was resolved |
| `callback.response_pushed` | info | agent_id, request_id | Confirm response reached relay group |

### feed — Team feed item management

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `feed.broadcast_failed` | exception | item_id | `broadcast_feed_item_failed` |

**NEW (gap fills):**

| Event | Level | Context Fields | Why |
|-------|-------|---------------|-----|
| `feed.item_created` | info | item_id, type, agent_id | Track every feed item creation for debugging |

### broadcast — Django Channels pub/sub

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `broadcast.agent_updated` | info | agent_id, from_status, to_status | `agent.status_changed` |
| `broadcast.agent_failed` | warning | group | `broadcast_agent_update_failed` |
| `broadcast.event_failed` | warning | group | `broadcast_event_failed` |

### reconciler — Background reconciliation loop

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `reconciler.started` | info | — | `reconciler_started` |
| `reconciler.orphan_reaped` | info | container_id | `orphan_reaped` |
| `reconciler.dead_container` | info | agent_id, exit_code, oom_killed | `dead_container_detected` |
| `reconciler.stuck_deploy` | info | agent_id | `stuck_deploy_detected` |
| `reconciler.error_reaped` | info | agent_id | `error_agent_reaped` |
| `reconciler.failed` | warning | — | `reconciliation_failed` |

**NEW (gap fills):**

| Event | Level | Context Fields | Why |
|-------|-------|---------------|-----|
| `reconciler.pass_completed` | info | agents_checked, issues_found, elapsed_s | Per-pass timing and health |

### runtime — Container/sandbox operations

Uses 3 levels because runtime has two distinct backends (docker, modal):

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `runtime.docker.container_created` | info | container_id, vnc_url, elapsed_s | `container_created` |
| `runtime.docker.exec_done` | info | container_id, cmd, elapsed_s | `exec_done` |
| `runtime.docker.exec_failed` | warning | container_id, exit_code, output | `exec_failed` |
| `runtime.docker.terminate_done` | info | container_id, elapsed_s | `terminate_done` |
| `runtime.docker.terminate_failed` | exception | container_id | `terminate_failed` |
| `runtime.docker.stale_removed` | info | container_name | `removed_stale_container` |
| `runtime.modal.sandbox_created` | info | sandbox_id, vnc_url, elapsed_s | `sandbox_created` |
| `runtime.modal.exec_done` | info | sandbox_id, cmd, elapsed_s | `exec_done` |
| `runtime.modal.terminate_done` | info | sandbox_id, elapsed_s | `terminate_done` |

### comms — Message delivery and agent control

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `comms.message_sent` | info | agent_id, delivery(push\|backfill) | `message_sent` |
| `comms.broadcast_sent` | info | targets | `broadcast_sent` |
| `comms.question_answered` | info | agent_id, delivery | `question_answered` |
| `comms.mode_changed` | info | agent_id | `mode_change_sent` |
| `comms.session_cleared` | info | agent_id | `session_cleared` |
| `comms.push_failed` | warning | agent_id, command_type | `push_to_disconnected_relay` |
| `comms.agent_not_found` | warning | agent_id | `agent_not_found` |
| `comms.auto_restarting` | info | agent_id, current_status | `auto_restarting_agent` |

### vnc — VNC proxy WebSocket

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `vnc.connected` | info | agent_id, token_hash | `vnc_proxy_connected` |
| `vnc.disconnected` | info | agent_id, code, source | `vnc_proxy_disconnected` |
| `vnc.upstream_ok` | info | agent_id, subprotocol | `vnc_proxy_upstream_ok` |
| `vnc.upstream_failed` | exception | agent_id, url | `vnc_proxy_upstream_failed` |
| `vnc.rejected` | warning | agent_id, reason | `vnc_proxy_reject` |

### graphql — GraphQL operations

| Event | Level | Context Fields | Current Name |
|-------|-------|---------------|--------------|
| `graphql.subscription_connected` | info | type, group | `subscription_connected` |
| `graphql.vnc_token_created` | info | agent_id, token_hash | `vnc_token_created` |
| `graphql.recipient_not_found` | warning | type, value | `recipient_not_found` |
| `graphql.claude_md_failed` | exception | agent_name | `claude_md_write_failed` |

---

## Context Field Requirements

Every event MUST include identifying context. The minimum depends on the domain:

| Domain | Required Fields |
|--------|----------------|
| lifecycle, relay, stream, callback, comms, vnc | `agent_id` |
| mcp | `agent_name` (sender/spawner) |
| reconciler | — (operates on fleet, individual agent_id when available) |
| broadcast | `agent_id` or `group` |
| feed | `item_id`, `agent_id` when available |
| graphql | operation-specific context |
| runtime | `sandbox_id` or `container_id` |

**Timing:** Any operation that takes >100ms SHOULD include `elapsed_s`.
Currently only runtime operations track elapsed time. Add to:
- `lifecycle.agent_provisioned` (30-120s typically)
- `reconciler.pass_completed` (varies with fleet size)

---

## Log Level Convention

Levels indicate severity and operational response:

| Level | When to Use | Example |
|-------|-------------|---------|
| `debug` | High-frequency events useful only during active debugging. Not shown in production by default. | `stream.event_received` (every stream event) |
| `info` | Normal operations worth recording. The default for all state transitions and completed actions. | `lifecycle.agent_created`, `relay.connected` |
| `warning` | Degraded but recoverable situations. Best-effort operations that failed but didn't break the caller. Always include `exc_info=True` when wrapping an exception. | `broadcast.agent_failed`, `comms.push_failed` |
| `exception` | Unexpected failures that indicate a bug or infrastructure problem. Use only when the error is NOT expected/handled. | `lifecycle.provision_failed`, `vnc.upstream_failed` |

**Rule:** If the code catches an exception and continues (best-effort), use
`warning` with `exc_info=True`. If the exception propagates or indicates a
real problem, use `exception`. Currently 3 calls in reconcile.py use
`exception` for best-effort operations — these should be demoted to `warning`.

---

## Logger Name Convention

Each module creates a logger with a name matching its domain:

```python
# Current (inconsistent):
log = structlog.get_logger("agents.relay_ws")
log = structlog.get_logger("agents.lifecycle")
log = structlog.get_logger("agents.reconcile")

# New (matches domain registry):
log = structlog.get_logger("abox.relay")
log = structlog.get_logger("abox.lifecycle")
log = structlog.get_logger("abox.reconciler")
```

Prefix `abox.` prevents collisions with Django/third-party loggers.
Logger name matches the first segment of event names in that file:
`abox.relay` logger emits `relay.connected`, `relay.disconnected`, etc.

This enables log filtering by domain: `structlog.configure(wrapper_class=...,
processors=[...], logger_factory=PrintLoggerFactory())` with logger name
filtering.

---

## Debugging Stories

These are the narratives the event taxonomy must support. Each story is a
sequence of events that, when read top-to-bottom filtered by agent_id,
tells you exactly what happened.

### Story 1: "Why did this agent crash?"

```
lifecycle.agent_created          agent_id=X runtime=docker
lifecycle.container_created      agent_id=X sandbox_id=abc elapsed_s=8.2
lifecycle.relay_launched         agent_id=X
relay.connected                  agent_id=X backfill_ran=true backfill_count=0
lifecycle.status_changed         agent_id=X from=deploying to=idle trigger=relay_connect
...time passes...
stream.process_exit              agent_id=X exit_code=137 stderr_len=450
broadcast.agent_updated          agent_id=X from_status=running to_status=error
reconciler.error_reaped          agent_id=X
```

**Diagnosis:** Exit code 137 = OOM killed. stderr has the details.

### Story 2: "Why didn't this message reach the agent?"

```
comms.message_sent               agent_id=X delivery=push
relay.disconnected               agent_id=X code=1006 source=client
comms.push_failed                agent_id=X command_type=input
relay.connected                  agent_id=X backfill_ran=true backfill_count=1
relay.backfill_sent              agent_id=X count=1 source=reconnect
```

**Diagnosis:** Relay dropped during send, message queued as StreamEvent,
backfilled on reconnect. Before the fix: `backfill_ran=false` and message lost.

### Story 3: "Why is this agent stuck waiting for permission?"

```
callback.permission_requested    agent_id=X tool=Bash request_id=abc123
feed.item_created                item_id=Y type=permission agent_id=X
...user clicks approve...
callback.permission_resolved     agent_id=X request_id=abc123 verdict=allowed
callback.response_pushed         agent_id=X request_id=abc123
```

**Diagnosis:** If `callback.response_pushed` is missing, the response never
reached the relay group. If `callback.permission_resolved` is missing, the
user never acted.

### Story 4: "Why did this deploy take so long / fail?"

```
lifecycle.provision_started      agent_id=X runtime=docker
lifecycle.container_created      agent_id=X sandbox_id=abc elapsed_s=45.3
lifecycle.workspace_provisioned  agent_id=X
lifecycle.secrets_resolved       agent_id=X count=3
lifecycle.relay_launched         agent_id=X
...60s passes, no relay.connected...
reconciler.stuck_deploy          agent_id=X
broadcast.agent_updated          agent_id=X from_status=deploying to_status=error
```

**Diagnosis:** Container created but relay never connected. s6 service
likely failed to start. Check container logs via `docker exec`.

### Story 5: "Why did the dashboard stop updating?"

```
broadcast.agent_updated          agent_id=X from_status=idle to_status=running
broadcast.agent_failed           group=project_abc_agents
broadcast.agent_failed           group=project_abc_agents
broadcast.agent_failed           group=project_abc_agents
```

**Diagnosis:** Redis/Channels layer is down. Broadcasts failing but mutations
succeeding. Dashboard is blind until Channels recovers.

### Story 6: "Why is this agent unresponsive?"

```
relay.connected                  agent_id=X backfill_ran=false
comms.message_sent               agent_id=X delivery=push
...60s passes, no stream events...
stream.event_received            agent_id=X event_type=assistant (last seen 90s ago)
```

**Diagnosis:** Relay is connected but no stream events flowing. SDK may be
stuck in thinking, rate limited, or hung. The gap between last
`stream.event_received` and now tells you how long silence has lasted.
Without this event, "unresponsive" and "working normally" are indistinguishable.

### Story 7: "Why didn't agent B get agent A's message?"

```
mcp.message_sent                 sender=agent-A recipient=agent-B
comms.push_failed                agent_id=agent-B command_type=input
relay.disconnected               agent_id=agent-B code=1006
```

**Diagnosis:** Agent B's relay was down when the message arrived. Currently
the message silently drops. With `comms.push_failed`, the failure is visible.
Future: queue and backfill inter-agent messages like user messages.

### Story 8: "Why did this agent auto-restart?"

```
comms.message_sent               agent_id=X delivery=backfill
comms.auto_restarting            agent_id=X current_status=stopped
lifecycle.agent_restarted        agent_id=X
lifecycle.provision_started      agent_id=X runtime=docker
lifecycle.container_created      agent_id=X sandbox_id=new-abc
relay.connected                  agent_id=X backfill_ran=true backfill_count=1
relay.backfill_sent              agent_id=X count=1 source=deploy
```

**Diagnosis:** User sent a message to a stopped agent. Auto-restart kicked in,
new container created, message backfilled on relay connect. The chain from
message → restart → provision → backfill is fully traceable.

### Story 9: "Why did session resume fail?"

```
lifecycle.agent_restarted        agent_id=X
lifecycle.provision_started      agent_id=X runtime=docker resume_session_id=sess-123
relay.connected                  agent_id=X backfill_ran=true
stream.session_started           agent_id=X resumed=false session_id=sess-456
```

**Diagnosis:** `resumed=false` despite `resume_session_id` being set means
Claude couldn't find the session checkpoint. New session created instead.
Without `stream.session_started`, resume failures are invisible.

### Story 10: "Why is this agent costing so much?"

```
stream.session_result            agent_id=X cost_usd=2.45 turns=3 input_tokens=180000
stream.session_result            agent_id=X cost_usd=8.12 turns=1 input_tokens=950000
```

**Diagnosis:** Second session used 950k input tokens in a single turn —
likely a huge file read or context explosion. Per-session cost events make
anomalies visible and attributable. Future: include runtime costs from
Modal/Docker billing APIs.

---

## Cost Attribution (Future)

Runtime and MCP costs are planned. The taxonomy doesn't change but these
context fields should be added when cost tracking lands:

| Event | Future Cost Fields |
|-------|--------------------|
| `runtime.docker.container_created` | image_size, instance_type |
| `runtime.modal.sandbox_created` | gpu_type, memory_mb, region |
| `stream.session_result` | cost_usd, input_tokens, output_tokens, cache_read_tokens |
| `mcp.message_sent` | token_count (if MCP server reports usage) |
| `reconciler.error_reaped` | runtime_cost_usd (total container uptime cost) |

These fields are optional today — the events exist, fields get added when
the billing pipeline is ready.

---

## Bug Patterns the Taxonomy Catches

Analysis of 15 recent bugs reveals 5 recurring patterns. The event taxonomy
is designed to make each pattern diagnosable from logs alone.

### Pattern 1: State Machine Race Conditions

**Bugs:** Backfill race, VNC startup race, zombie relay restarts.

**Root cause:** Multiple async processes assume synchronous ordering of state
transitions. Process A sets status before process B is ready.

**How the taxonomy catches it:** `lifecycle.status_changed` with `from`, `to`,
and `trigger` fields. When you see `from=deploying to=idle trigger=lifecycle`
instead of `trigger=relay_connect`, you know the transition happened in the
wrong code path.

### Pattern 2: Silent Data Discard

**Bugs:** Error context not surfacing, reconciler missing feed items,
observation loop gaps.

**Root cause:** Data enters the system but is silently dropped at a processing
boundary. No error, no crash — just missing downstream data.

**How the taxonomy catches it:** `feed.item_created` log on every feed item
creation. If `broadcast.agent_updated` fires with `to_status=error` but no
corresponding `feed.item_created type=error`, the discard is visible.

### Pattern 3: Frontend/WebSocket Lifecycle Mismatch

**Bugs:** VNC unmount crash, VNC disconnect crash, VNC on dead agents.

**Root cause:** React component lifecycle and WebSocket lifecycle are not
synchronized. Unmount fires but WebSocket callback still runs.

**How the taxonomy catches it:** `relay.connected` with `agent_id` + VNC
guard on `relayConnected`. The `vnc.rejected reason=no_vnc_url` event shows
VNC attempts for agents without active containers.

### Pattern 4: Log Quality as a Bug Class

**Bugs:** Anonymous GraphQL ops, over-redaction, credential leaking.

**Root cause:** The observability layer itself is broken — logs that should
help debugging instead obscure, destroy, or leak information.

**How the taxonomy catches it:** Architecture test (task #20) enforces the
naming grammar. Separate tests enforce: no sensitive field names without
redaction, every event has at least one identifying field.

### Pattern 5: Transient Disconnect Message Loss

**Bugs:** Relay disconnect backfill gap (fixed in 1ef5b57).

**Root cause:** Backfill logic only ran for one state (DEPLOYING), missing
the transient reconnect case entirely.

**How the taxonomy catches it:** `relay.connected backfill_ran=true|false
backfill_count=N` makes the backfill decision visible. If you see
`backfill_ran=false` after a `relay.disconnected`, you know messages in
that window were lost.

---

## Migration Plan

1. **Approve convention** — this document
2. **Architecture test** (task #20) — enforce naming regex on all structlog calls
3. **Rename pass** — batch rename all 94 existing events to new names
4. **Gap fill pass** — add the ~10 new events identified above
5. **Context field audit** — ensure every event has required fields per domain

Steps 3-5 can be done as a single PR. The arch test (step 2) prevents drift
after the rename.

---

## Current Event Inventory

94 unique events across 22 files. Full audit:

| Count | Domain | Current Naming Pattern |
|-------|--------|----------------------|
| 24 | lifecycle | `creating_agent`, `agent_created`, `agent_killed`, etc. |
| 18 | comms | `message_sent`, `push_to_disconnected_relay`, etc. |
| 15 | vnc | `vnc_proxy_*` prefix |
| 11 | mcp | `mcp_*` prefix |
| 7 | reconciler | `reconciler_started`, `orphan_reaped`, etc. |
| 6 | runtime (docker) | `container_created`, `exec_done`, etc. |
| 5 | runtime (modal) | `sandbox_created`, `exec_done`, etc. |
| 4 | stream | `stream_process_exit`, `plan_*` |
| 3 | callback | `permission_request`, `malformed_callback`, etc. |
| 3 | graphql | `subscription_connected`, `vnc_token_created`, etc. |
| 2 | broadcast | `agent.status_changed`, `broadcast_*_failed` |
| 1 | feed | `broadcast_feed_item_failed` |

---

## Discovered Issues (from analysis agents)

Captured as tasks where actionable:

- **CRITICAL (fixed):** Messages lost on transient relay disconnects — task #21, fixed in `1ef5b57`
- **BUG:** Stuck deploys and error reaps create no feed items — task #22
- **BUG:** `_detect_stuck_deploys` calls `_mark_error()` without error_message
- **MINOR:** 3 `log.exception()` calls in reconcile.py should be `log.warning(exc_info=True)` per established convention
- **MINOR:** `consumers.py` uses `.asave()` on connect but `.aupdate()` on DEPLOYING→IDLE — inconsistent broadcast tracking
- **MINOR:** Unused logger in `auth_relay.py`
