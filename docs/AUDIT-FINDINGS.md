# Agentobox Codebase Audit — Verified Findings

Generated 2026-03-01. Seven audit agents + four verification agents.
Verdicts: REAL (confirmed), EXAGGERATED (overstated), FALSE (refuted).

---

## HIGH Severity — Fix First

### B1: `set_agent_mode` broken for auto/supervised modes
- **Verdict**: REAL
- **File**: `backend/agents/services/comms.py:239`, `backend/agents/graphql/mutations.py:196-201`
- **Issue**: Frontend sends `auto`/`plan`/`supervised`. Service validates against CC wire vocabulary `{"default", "plan", "acceptEdits", "bypassPermissions", "dontAsk"}`. Mutation docstring says "map to Claude Code mode" but NO mapping code exists. Only `plan` works (exists in both vocabularies). `auto` and `supervised` raise ValueError → 500.
- **Fix**: Add mode translation map in `set_agent_mode()` using the adapter's `_MODE_TO_PERMISSION` mapping (already exists in `claude_code/__init__.py:59-63`), or validate against frontend vocabulary and translate before storing.

### B6: Stuck deploy detection uses `created_at` — hard-restarted agents immediately reaped
- **Verdict**: REAL
- **File**: `backend/agents/services/reconcile.py:169`
- **Issue**: `_detect_stuck_deploys` filters by `created_at__lt=deploy_cutoff`. On `hard_restart_agent`, `created_at` never changes (set once at creation). Any agent older than 120s that gets hard-restarted will be flagged as "stuck" on the next reconciliation pass (within 30s), marked ERROR, and terminated — before provisioning can complete.
- **Fix**: Change `created_at__lt` to `updated_at__lt`. The `updated_at` field is refreshed when status changes to DEPLOYING.

### E1: `answer_question` silently loses answers to dead agents
- **Verdict**: REAL
- **File**: `backend/agents/services/comms.py:139-168`
- **Issue**: Unlike `send_message` which checks `_needs_restart()` and auto-restarts dead agents, `answer_question` pushes to relay regardless of agent status. If the agent crashed after asking a question but before the user answered, the answer goes to an empty Channels group and is silently lost. The permission prompt shows "pending" forever in the dashboard.
- **Fix**: Add `_needs_restart` check to `answer_question`. Or: when resolving a permission on a dead agent, mark the feed item as stale and inform the user.

### A2: Task create/update has two divergent code paths
- **Verdict**: REAL
- **File**: `backend/agents/graphql/mutations.py:462-525` vs `backend/agents/services/mcp_coord.py:171-327`
- **Issue**: GraphQL mutations have their own inline task logic with different behavior:
  - Different ID prefixes (`dash_` vs `mcp_`)
  - GraphQL create_task does NOT create feed items; MCP version does
  - GraphQL update_task only handles status; MCP version handles 8+ fields + deletion + feed items
  - Dashboard task operations are invisible in the team feed
- **Fix**: GraphQL mutations should delegate to `mcp_coord.create_task` and `mcp_coord.update_task` (the richer implementations).

---

## MEDIUM Severity

### B2: hook_bridge splats `**params` from untrusted agent input
- **Verdict**: REAL
- **File**: `backend/agents/views.py:148,155`
- **Issue**: `params = _cc_to_snake(tool_input)` then `await handler(agent, **params)`. The `_cc_to_snake` passes ALL keys through. Untrusted data from agent containers flows directly into handler function signatures.
- **Fix**: Whitelist expected parameters per handler rather than splatting arbitrary input.

### D1: Relay token auth reimplemented 3x with different security properties
- **Verdict**: REAL
- **Files**: `consumers.py:56-62`, `views.py:134`, `mcp_coord.py:38-47`
- **Issue**: Three distinct implementations with different extraction methods, error types, and security properties. consumers.py uses `hmac.compare_digest` (timing-safe); views.py and mcp_coord.py do direct DB lookup (not timing-safe for the comparison, though DB lookup timing varies anyway).
- **Fix**: Extract `authenticate_relay(token) -> Agent` shared helper.

### E3: Reconciler only handles Docker, not Modal
- **Verdict**: REAL
- **File**: `backend/agents/services/reconcile.py:137-155`
- **Issue**: `_detect_dead_containers()` filters for `runtime="docker"` only. Modal agents that die remain in IDLE/RUNNING status forever. `_reap_orphans_sync()` also Docker-only.
- **Fix**: Add Modal sandbox status checking to dead container detection.

### E5: `_push_to_relay` silently loses messages to disconnected agents
- **Verdict**: REAL
- **File**: `backend/agents/services/comms.py:76-86`
- **Issue**: `channel_layer.group_send` to an empty group (relay disconnected) is a silent no-op. Affects `answer_question`, `interrupt_agent`, `restart_agent`, `set_agent_mode`. The `send_message` function mitigates with `_needs_restart` check, but other push functions don't.
- **Fix**: Track relay connection state on Agent model. Fail explicitly when pushing to disconnected relay.

### S2: Open user registration, no gate
- **Verdict**: REAL
- **File**: `backend/accounts/graphql/mutations.py:39-50`
- **Issue**: Anyone who can reach GraphQL endpoint can create an account. No invite code, email verification, or admin approval.
- **Fix**: Add invite-only or admin-approval gate before any public deployment.

### S3: No GraphQL query depth or complexity limiting
- **Verdict**: REAL
- **File**: `backend/schema.py:35-40`
- **Issue**: Strawberry schema has no MaxQueryDepth or cost estimator extension.
- **Fix**: Add `strawberry.extensions.MaxQueryDepth(max_depth=10)`.

### S4: relay_token stored as plaintext in DB
- **Verdict**: REAL
- **File**: `backend/agents/models.py:164`
- **Issue**: `CharField(max_length=64)`. If DB is compromised, all relay tokens are immediately usable.
- **Fix**: Hash with SHA-256 before storage. Compare with `hmac.compare_digest(hash(presented), stored_hash)`.

### S5: No rate limiting on any endpoint
- **Verdict**: REAL
- **Issue**: No rate limiting middleware, no DRF throttling, no custom implementation anywhere.
- **Fix**: Add `django-ratelimit` or middleware. Critical: login (5/min/IP), register (3/hr/IP), hook-bridge (100/min/agent).

### S6: No container resource limits
- **Verdict**: REAL
- **File**: `backend/agents/runtimes/docker.py:60-72`
- **Issue**: `containers.run()` has no `mem_limit`, `cpu_quota`, `pids_limit`. Fork bomb = all host resources consumed.
- **Fix**: Add `mem_limit="4g"`, `cpu_quota=200000`, `pids_limit=500`.

### A1: TeamFeedItem.type raw strings in 7+ files, no enum
- **Verdict**: REAL
- **File**: `backend/agents/models.py:311` + 7 service files
- **Issue**: String literals like `"permission"`, `"plan"`, `"system"`, `"user"` scattered across callbacks.py, stream.py, broadcast.py, mcp_coord.py, feed.py, mutations.py. A typo silently creates unrenderable feed items.
- **Fix**: Create `FeedItemType(models.TextChoices)` enum. Add pre-commit check.

### E2: resolve_plan auto-restarts dead agent just to say "rejected"
- **Verdict**: REAL
- **File**: `backend/agents/services/feed.py:169-195`
- **Issue**: `resolve_plan` calls `send_message` which triggers `_needs_restart` → `hard_restart_agent`. Agent restarts just to receive "Plan rejected. Stop and wait."
- **Fix**: Check agent status before sending plan verdict. Don't restart dead agents for rejections.

### G3: Relay logs lack agent_id per line
- **Verdict**: REAL
- **File**: `agent/rootfs/opt/abox/relay.py:110-122`
- **Issue**: JSONFormatter outputs `{timestamp, level, logger, event}`. agent_id only in startup + exit events, not per-line. Can't filter relay logs by agent.
- **Fix**: Add `AGENT_ID` env var to every log record in JSONFormatter.

### G4: Hook scripts have zero logging
- **Verdict**: REAL
- **File**: `agent/rootfs/opt/abox/hooks/team-bridge.py`
- **Issue**: No logging calls. Errors only surface as systemMessage to Claude. PostToolUse errors silently swallowed — native tool already ran locally but backend never got the data. Local and backend states silently diverge.
- **Fix**: Add stderr logging. Consider retry for PostToolUse failures.

### G7: Relay drops events on double WS failure
- **Verdict**: REAL
- **File**: `agent/rootfs/opt/abox/relay.py:535-553`
- **Issue**: If both initial send and reconnect-retry fail, event is logged as lost but dropped. No buffering. Critical for `process_exit` events — backend never learns agent died.
- **Fix**: Add bounded buffer for critical events (process_exit, result).

### F9: Zero frontend tests
- **Verdict**: REAL
- **Issue**: No test framework, no test files, no test infrastructure in dashboard.
- **Fix**: Add vitest + React Testing Library. Start with hooks (useAgents, useFeed).

### F10: Manual frontend/backend type sync
- **Verdict**: REAL
- **Issue**: Hand-written TypeScript types in `lib/types.ts`. No codegen from GraphQL schema.
- **Fix**: Add graphql-codegen or at minimum a CI check that schema.graphql is up to date.

---

## LOW Severity

### B3: relay_token missing db_index
- **Verdict**: REAL
- **File**: `backend/agents/models.py:164`
- **Fix**: Add `db_index=True` to relay_token field. One-line migration.

### B4: hook_bridge json.loads unprotected
- **Verdict**: REAL
- **File**: `backend/agents/views.py:145`
- **Fix**: Wrap `json.loads(request.body)` in try/except, return 400 on parse failure.

### B5: Sync urlopen blocks event loop (dev only)
- **Verdict**: REAL
- **File**: `backend/agents/services/comms.py:61`
- **Issue**: `urlopen(fetch_url, timeout=10)` in async context. Only triggers for localhost/localstack URLs (dev).
- **Fix**: Wrap in `sync_to_async` or use `httpx`.

### B8: AgentFeedback missing updated_at
- **Verdict**: REAL
- **File**: `backend/agents/models.py:365-377`
- **Fix**: Add `updated_at = models.DateTimeField(auto_now=True)`.

### D2: Team roster building duplicated verbatim
- **Verdict**: REAL
- **Files**: `lifecycle.py:297-303`, `mutations.py:362-364`
- **Fix**: Extract `build_team_roster(project)` helper.

### A3: Private functions imported across module boundaries
- **Verdict**: REAL
- **Files**: `mcp_coord.py` imports `_handle_broadcast`, `_deliver_to_stdin` from `interagent.py`
- **Fix**: Make them public (drop underscore) or expose public wrappers.

### L1: get_crash_info exists but never called
- **Verdict**: REAL
- **File**: `backend/agents/runtimes/docker.py:189-206`
- **Issue**: Captures exit code, OOM status, last 50 log lines. Never called by reconciler.
- **Fix**: Call `get_crash_info()` in `_detect_dead_containers` before marking ERROR.

### G1: Blanket sudo with race window
- **Verdict**: REAL
- **File**: `agent/Dockerfile.debian:103`
- **Issue**: `NOPASSWD:ALL` at build time. `_provision_scoped_sudo` replaces at runtime but race window exists.
- **Fix**: Move scoped sudoers into image build. Remove blanket rule from Dockerfile.

### G2: Docker socket in backend container
- **Verdict**: REAL
- **File**: `docker-compose.yml:75`
- **Issue**: Backend compromise = full host container management. Standard for Docker-in-Docker control planes.
- **Fix**: Consider TCP with TLS or restricted sidecar for production.

### Dev config items (acceptable for local dev)
- S7: SECRET_KEY defaults to known value (`docker-compose.yml:44`) — REAL
- G8: ALLOWED_HOSTS = "*" (`docker-compose.yml:43`) — REAL
- G9: DEBUG = "true" (`docker-compose.yml:42`) — REAL
- G10: Postgres password is "agentobox" (`docker-compose.yml:7`) — REAL

---

## EXAGGERATED (real but overstated)

| # | Claim | Original framing | Actual |
|---|-------|-----------------|--------|
| B7 | summary param unused in deliver_message | "bug" | Dead param, not data loss. Feature gap. |
| S1 | volume_mounts host_path no validation | "critical container escape" | Mitigated by auth (only project owner can set). Real gap for multi-tenant future. |
| D3 | Sync event wrappers duplicated | "near-identical" | Different abstraction levels, different purposes. |
| L2 | VNC proxy bare except:pass | "silent failure" | Intentional cleanup tolerance during teardown. Disconnect IS logged. |

---

## FALSE (refuted)

| # | Claim | Why false |
|---|-------|-----------|
| E4 | remove_agent creates event then CASCADE deletes it | Broadcast happens BEFORE delete — subscribers receive it. By design. |
| G5 | `__pycache__` committed in git | gitignored, not tracked. `git ls-files` returns empty. |

---

## Logging Blindspots (from logging audit, not individually verified)

1. **No message delivery confirmation** — backend logs "sent" but relay may never receive it
2. **No end-to-end correlation** — can't trace dashboard → backend → relay → CC
3. **No task_id in any log line** — can't filter logs by task
4. **No turn_id concept** — relay generates nothing per CC turn
5. **Hook bridge is a black box** — no request logging, no timing
6. **Provisioning steps have no duration timing**
7. **Reconciler doesn't call get_crash_info** — agents go ERROR with no "why"
8. **Subscription disconnects not logged**
9. **Relay event loss is silent** — no buffering on WS failure

### Tracing hierarchy (design for OTEL-readiness)
```
project (trace root)
  └─ agent (child trace) ← agent_id
       ├─ turn (span) ← turn_id
       │    ├─ tool use (child span)
       │    ├─ permission request (child span)
       │    └─ hook bridge call (child span)
       ├─ task (span, sibling of turn) ← task_id
       │    └─ status transitions (events on span)
       └─ message (span) ← links sender + recipient agent traces
```

IDs needed in every log line: `project_id` (always), `agent_id` (when agent context exists), `task_id` (when processing task ops), `turn_id` (relay generates per CC turn). Currently only `agent_id` is bound, and only during lifecycle operations.

---

## Testing Gaps (from testing audit)

### Zero coverage on critical paths
- `lifecycle.py` (691 lines) — create/kill/restart agents
- `feed.py` — permission resolution, plan approval (safety-critical)
- `comms.py` — all user-facing agent control
- `callbacks.py` — SDK permission requests
- `provision.py` — writes CLAUDE.md, settings, MCP config
- `secrets.py` — crypto operations
- All REST views (hook_bridge, uploads)
- All WebSocket consumers (RelayConsumer, VncProxyConsumer)
- All 22 GraphQL mutations, 8 queries, 3 subscriptions
- Entire frontend (zero framework)
- Entire agent image (relay.py, hooks)

### What IS tested well
- Adapters (test_adapters.py — excellent, real CC event fixtures)
- Architecture enforcement (test_architecture.py + check_architecture.py)
- MCP coord tools (test_mcp_coord.py — schema parity tests)
- Auth helpers (test_auth.py)
- Stream handlers (partial — test_stream.py)
- SSRF prevention (test_comms.py)

### Proposed test priority
1. `test_secrets.py` — easiest win, crypto roundtrip (~30 min)
2. `test_hook_bridge.py` — AsyncClient, tool routing (~1 hr)
3. `test_callbacks.py` — permission request flow (~1 hr)
4. `test_feed.py` — resolve_permission, resolve_plan (~2 hrs)
5. `test_lifecycle_real.py` — create/kill/restart with mocked runtime (~3 hrs)

---

## Dead Code Removed (already done)

Committed in working tree (not yet pushed):
- 3 unused npm packages removed from package.json
- Unused `AnonymousUser` import removed from middleware.py
- Orphaned `team-lead-after-fix.png` deleted
- Stale `backend/schema.graphql` deleted
- Dead `mutations/auth.ts` deleted
- Dead `formatTime()` export removed from utils.ts

---

## Architecture Patterns (from architecture audit)

### Well-standardized
- Service function naming (verb_entity, enforced by pre-commit)
- Component naming (kebab-case files, PascalCase exports)
- GraphQL operation naming (GET_*, ON_*, verb_entity mutations)
- Store patterns (use*Store)
- Import style (absolute everywhere)
- Adapter protocol (pure functions, no DB/IO)
- s6 service naming (svc-*, init-*)

### Proposed pre-commit additions
1. GraphQL mutation naming enforcement
2. GraphQL type naming (*Type suffix)
3. No raw feed item type strings in services
4. Mutations must delegate to service layer (no inline ORM)
5. Frontend operation naming conventions
6. JSON body validation in views

### Proposed conventions to codify
- TextChoices enum for all closed-set string fields
- UUID PKs for client-referenced entities, auto-increment for append-only logs
- All mutable models must have updated_at
- Mutations delegate to service functions, no inline business logic
