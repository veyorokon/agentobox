# Backend + Agent Failure Mode Review

Date: 2026-03-08
Scope: `backend/` and `agent/` runtime paths (provisioning, relay transport, event processing, inter-agent messaging, observability, testability)

## Executive Summary

The architecture is close. The strongest parts are clear boundaries (adapters, services, runtime abstractions), event-centric modeling, and unusually good architecture guardrails in tests.  
The main gap is not "feature architecture"; it is "failure architecture": several critical flows degrade in ways that are hard to diagnose or only partially durable.

The biggest improvements now are:
1. Unify delivery semantics (all agent-targeted inputs should be durable + replayable).
2. Make lifecycle orchestration persistent/supervised instead of detached in-memory tasks.
3. Turn debugability into contracts (error taxonomy, correlation IDs, drop counters, deterministic failure tests).

## Strengths

1. Architecture discipline is real, not aspirational.
- Fast AST checks enforce boundaries and naming (`backend/agents/tests/check_architecture.py:269`).
- Event taxonomy is explicitly enforced (`backend/agents/tests/test_architecture.py:643`, `:710`).

2. Strong volume/state design for replayability.
- Inbox cursor model (`inbox.pos`) is a good durability primitive (`backend/agents/services/volume.py`).
- Path parity checks between Python and init scripts are tested (`backend/agents/tests/test_volume_architecture.py:370`).

3. Good runtime abstraction separation.
- Docker/Modal runtime interfaces are clean and swappable (`backend/agents/runtimes/base.py`, `docker.py`, `modal.py`).

4. Security posture is intentional.
- Secret redaction, scoped sudo, API proxy isolation, and scoped secret writes are present and tested.

## Weakness Patterns (Failure-Oriented)

## P0: Mixed durable vs ephemeral message paths create hidden loss modes

Pattern:
- User messaging uses durable volume inbox + poke (`backend/agents/services/comms.py:81-89`, `:124-132`).
- Inter-agent messaging bypasses inbox and pushes direct WS `input` (`backend/agents/services/interagent.py:88`).
- Inter-agent code comments claim backfill durability (`backend/agents/services/interagent.py:63`), but that path is not inbox-backed.

Risk:
- If relay is disconnected, message may be logged but not delivered to agent runtime.
- Creates "looks delivered in feed, not actually processed" debugging scenarios.

What to change:
- Route **all** input payloads (including inter-agent) through one durable path: append inbox + poke.
- Reserve direct WS for strictly ephemeral signals only (`SIGINT`, restart, clear).

How tests should detect this mechanically:
- Add an architecture check: forbid `push_to_relay(...{"type":"input"...})` outside the inbox helper.
- Add integration test: relay disconnected during inter-agent send; upon reconnect, message is consumed exactly once.

## P0: Detached lifecycle tasks are operationally fragile under process restarts

Pattern:
- Provisioning/restart work launched via `asyncio.create_task` (`backend/agents/services/lifecycle.py:161-162`, `:727-728`).

Risk:
- Backend process crash/redeploy can orphan in-flight orchestration.
- Reconciler eventually catches some states, but causal chain is weak and delayed.

What to change:
- Move lifecycle orchestration to a durable job model (DB-backed queue / task table) with attempt IDs and explicit state transitions.
- Keep `create_task` for short local fan-out only; not for long-lived critical work.

How tests should detect this mechanically:
- Crash-injection integration test: kill backend during provisioning, restart backend, assert eventual terminal state with explicit failure cause and no orphan resources.
- State-machine tests for allowed lifecycle transitions.

## P1: Debug signal quality is reduced by broad exception swallowing and aggressive truncation

Pattern:
- Broad `except Exception` is frequent (59 occurrences across backend+agent sampled).
- Log truncation caps values at 200 chars (`backend/config/telemetry.py:108`, `:123-124`).

Risk:
- Root causes collapse into generic warnings.
- High-value stderr/payload context is clipped in exactly the situations where debugging is needed.

What to change:
- Keep fail-open behavior where needed, but require structured failure metadata: `error.class`, `error.code`, `cause`, `scope`.
- Increase truncation policy intelligence (preserve full payload in side channel/blob store with pointer ID in log).

How tests should detect this mechanically:
- Lint rule: any broad `except Exception` must log structured error fields.
- Log contract tests: emitted error events must include `error.code` and correlation keys.

## P1: Relay buffering semantics can silently drop context

Pattern:
- Critical events buffered with `deque(maxlen=20)` (`agent/rootfs/opt/abox/relay_common.py:327`).
- Non-critical events dropped on failure (`:368`).

Risk:
- Under burst disconnects, older critical events can be evicted silently by deque maxlen.
- Debug sessions lose exactly the high-frequency event context needed for timeline reconstruction.

What to change:
- Add monotonic sequence numbers + drop counters + explicit overflow events.
- Consider disk-backed spool for critical events instead of small in-memory deque.

How tests should detect this mechanically:
- Fault-injection test: simulate disconnect + >20 critical events; assert overflow metric/event emitted and no silent loss.

## P1: Unbounded in-memory normalization state

Pattern:
- Global per-agent normalize map has no cleanup (`backend/agents/services/stream.py:83`, `:139`).

Risk:
- Long-lived backend processes can accumulate stale per-agent state and grow memory.

What to change:
- TTL/LRU cleanup keyed by agent/session lifecycle events.

How tests should detect this mechanically:
- Long-run test that creates many agents/sessions and asserts bounded normalization-state cardinality.

## P1: Test harness friction hides regressions

Pattern:
- Backend tests require env like `SECRET_KEY` even for local focused runs (`backend/config/settings.py:25`).
- Root pytest addopts enforce `--timeout` globally (`pyproject.toml:27`) which breaks runs if plugin missing.
- Agent tests rely on container path/module assumptions (`Makefile:46-47`).

Risk:
- Engineers skip tests during iterative debugging.
- Reproducibility differs by machine/container context.

What to change:
- Split test entrypoints by layer (`unit`, `integration`, `e2e`) with isolated configs.
- Add `settings_test.py` defaults and bootstrap script for local deterministic runs.

How tests should detect this mechanically:
- CI smoke check: clean checkout + one command should run unit suite without secrets/network/container.

## P2: SDK monkey-patch is a strategic dependency risk

Pattern:
- Relay depends on private SDK internals/monkey-patch (`agent/claude/rootfs/opt/abox/relay.py:88`).

Risk:
- SDK internal refactor can break startup or silently change behavior.

What to change:
- Keep patch for now, but add explicit startup invariant checks and version compatibility tests.

How tests should detect this mechanically:
- Contract test pinned to SDK version matrix ensuring `_raw` extraction still works.

## Ad-Hoc Masking Pattern Catalog

These are the concrete "masking/silent-failure" patterns to remove:

1. Catch-and-continue on critical paths without typed failure contract.
- Examples: [lifecycle.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/agents/services/lifecycle.py), [comms.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/agents/services/comms.py), [consumers.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/agents/consumers.py), [relay.py](/Users/veyorokon/Projects/ai/mine/agentobox/agent/claude/rootfs/opt/abox/relay.py).
- Mechanical rule: any broad `except Exception` must emit `error.code`, `error.class`, `operation`, `agent_id`.

2. "Best effort" paths with no externally verifiable outcome.
- Examples: theme push failures and dashboard push failures in [comms.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/agents/services/comms.py).
- Mechanical rule: each best-effort action must produce success/failure counters and traceable event IDs.

3. Silent event loss behavior in relay buffering.
- Example: bounded critical buffer and non-critical drops in [relay_common.py](/Users/veyorokon/Projects/ai/mine/agentobox/agent/rootfs/opt/abox/relay_common.py).
- Mechanical rule: dropping/eviction must emit typed overflow/drop events and fail chaos invariants when unexpected.

4. Truncation that can hide root causes.
- Example: 200-char truncation policy in [telemetry.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/config/telemetry.py).
- Mechanical rule: keep full diagnostic payload in durable blob/attachment, log only pointer + preview.

5. Mixed delivery semantics that create ambiguous failure stories.
- Examples: durable inbox flow in [comms.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/agents/services/comms.py) vs direct WS input in [interagent.py](/Users/veyorokon/Projects/ai/mine/agentobox/backend/agents/services/interagent.py).
- Mechanical rule: forbid direct WS `input` commands outside canonical inbox helper.

## Mechanical Testing Strategy (What to Add)

1. Lifecycle state-machine tests
- Encode allowed state transitions for Agent (`deploying -> idle/running -> ...`).
- Fail test on illegal transition or missing transition event.

2. Transport chaos suite
- Deterministic fake WS server to inject: disconnects, malformed frames, delayed acks, partial outages.
- Assert delivery, retries, and explicit drop accounting.

3. Durability invariants suite
- Property tests over "message eventually delivered exactly once" for each ingress path:
  - user -> agent
  - inter-agent -> agent
  - broadcast -> many agents

4. Observability contract tests
- For every failure path, assert logs include:
  - `agent_id`, `project_id`, `session_id` (if known)
  - `error.code`, `error.class`
  - `operation` and `attempt`

5. Architecture lint extensions (cheap, high ROI)
- Forbid direct WS input pushes outside canonical inbox helper.
- Forbid unsupervised long-lived `asyncio.create_task` in lifecycle-critical paths.
- Require structured metadata when catching broad exceptions.

6. Replay tests from real traces
- Keep a corpus of anonymized real failure traces.
- Replay through parser/stream pipeline and assert canonical outputs + feed side effects.

## Make Failures "Pop Out" in Tests

1. Convert silent degradation into explicit assertions
- No silent drops: every dropped/evicted event must emit a typed diagnostic event and increment a counter.
- No swallowed exception without typed error code.
- No "best effort" path without an observable success/failure artifact.

2. Use invariants, not only example tests
- Invariant: if a message is accepted, it is either delivered exactly once or marked failed with cause.
- Invariant: every agent lifecycle attempt ends in a terminal state within SLA.
- Invariant: every terminal error has a root-cause artifact (error code + correlated logs/events).

3. Enforce architecture contracts in CI
- Treat architecture-lint failures as test failures.
- Treat missing observability fields as test failures.
- Treat non-deterministic retries (without bounded attempts + markers) as test failures.

4. Add chaos tests to the required PR lane for backend/agent changes
- WS disconnect mid-turn
- Backend restart mid-provision
- Container crash before relay flush
- Redis/channel transient failure

If any of those regress, CI should fail loudly with a specific invariant name.

## Confidence Model (How to Get Close to 100%)

Absolute 100% is unattainable, but you can get very close with layered confidence:

1. Deterministic unit + architecture tests (fast, always on)
- Pure logic, adapters, serializers, invariants, lint checks.

2. Deterministic integration tests (required PR gate)
- Real DB + channel layer + relay harness, but controlled failure injection.

3. Scenario E2E tests (required for release branches)
- Provision/send/restart/kill/recover flows on real stack.

4. Soak + chaos nightly
- Long-run and randomized failure injection to catch timing/resource issues.

5. Production canaries with SLO-backed assertions
- Promotion blocked if failure counters exceed thresholds.

Practical release rule:
- Merge blocked unless all invariant suites pass.
- Deploy blocked unless canary invariants pass for N minutes.
- Any unknown/untyped failure automatically fails confidence gate.

## Prioritized Cleanup Plan

1. Week 1 (P0)
- Unify message delivery path (inter-agent uses inbox).
- Add lifecycle supervisor/job model skeleton for provisioning/restart.
- Add transport chaos tests for disconnect/reconnect delivery invariants.

2. Week 2 (P1)
- Add structured error taxonomy + log contract tests.
- Add relay drop/overflow counters and alert thresholds.
- Add normalization-state cleanup + long-run memory guard test.

3. Week 3 (hardening)
- SDK patch compatibility tests.
- CI test-lane cleanup (unit/integration/e2e split with deterministic local bootstrap).

## Active Bugs Not Covered Above (as of 2026-03-08)

These are concrete bugs discovered during the current debugging session. They are instances of the systemic patterns described above but need explicit mention because they are actively blocking agent functionality.

### ACTIVE BLOCKER: SDK "Control request timeout: initialize"

**Symptom:** Every newly deployed agent fails with `Control request timeout: initialize` after 60 seconds. The relay spawns the claude binary via `claude-agent-sdk 0.1.47`, sends an `initialize` control request over stdin JSON-RPC, and waits 60s. The binary never responds.

**What we know so far:**
- `claude -p 'respond PONG'` works fine from CLI inside the container (both with and without MCP config).
- The MCP SSE endpoint (`http://backend:8000/mcp`) is reachable from inside the container — `curl` gets the SSE stream and can POST initialize to `/messages/`.
- The provisioning code correctly writes `"type": "sse"` (not `"http"`).
- The api-proxy health check passes. The api-key-helper.sh works correctly.
- The issue is specific to how the SDK spawns claude via subprocess with `--output-format stream-json --verbose`. Something in that startup path hangs.

**What we haven't tried:**
- Removing the coord MCP server from `.mcp.json` on a running agent to see if SDK init succeeds without it — this would isolate whether the MCP SSE client inside the CC binary is the bottleneck.
- Checking if CC 2.1.70's SSE MCP client implementation has a different connection flow than raw curl (e.g., different headers, different SSE parsing, different timeout behavior).
- Checking if there's a lifespan race — the MCP app might not be fully ready when the CC binary tries to connect despite `_ensure_mcp_ready()`.
- Running the SDK's subprocess command manually (`claude --output-format stream-json --verbose -p "test"`) as the agent user with the full relay environment to see what stdout/stderr looks like.

**Relevant files:**
- `backend/config/asgi.py` — ASGI router, MCP lifespan management
- `agent/claude/rootfs/opt/abox/relay.py:880-940` — SDK startup flow
- `backend/agents/services/provision.py:309-321` — coord server config builder

**Relay log pattern:**
```
relay.sdk_creating → relay.sdk_created → [60s silence] → relay.sdk_connect_failed "Control request timeout: initialize"
```

### FIXED: ASGI /messages/ routing gap

**Root cause:** FastMCP SSE transport serves the SSE stream at `/mcp` but expects message POSTs at `/messages/?session_id=xxx`. The ASGI `http_dispatch` only routed paths starting with `/mcp` to FastMCP — `/messages/` fell through to Django, which returned HTML error pages. The CC binary's MCP client hung waiting for a valid MCP response.

**Fix:** Added `/messages` prefix check to `http_dispatch` in `backend/config/asgi.py:80`:
```python
if scope["path"].startswith("/mcp") or scope["path"].startswith("/messages"):
```

**Status:** Fix applied and verified (FastMCP receives POSTs, returns "Invalid session ID" for test requests). But this alone did not resolve the SDK init timeout — agents deployed after this fix still fail.

### FIXED: MCP transport type "http" vs "sse"

**Root cause:** Older provisioning code wrote `"type": "http"` for the coord MCP server. CC SDK hangs indefinitely during initialize when MCP server type is "http" — it must be "sse" for SSE transport.

**Fix:** `_build_coord_server_config()` in `provision.py:315` now correctly returns `"type": "sse"`. Docstring explicitly warns against using "http".

**Status:** Fixed in provisioning code. Old containers provisioned before the fix still have `"type": "http"` and must be redeployed.

### Pattern: Cross-language path parity drift

**Category not in audit:** Hardcoded paths appear in three places that must stay in sync: (1) init-volume bash script (symlink creation), (2) SYMLINKED_PREFIXES Python constant (write validation), (3) provisioning code (file writes). Drift between any two creates invisible-file bugs — backend writes a file to the volume, but the container can't see it because init-volume didn't create the symlink.

**Mitigation added:** `Volume._validate_path()` rejects writes to paths not under SYMLINKED_PREFIXES. `TestPathParity` in `test_volume_architecture.py` parses the init-volume bash script and verifies every symlinked directory is represented in the Python constant.

**Relevant files:**
- `backend/agents/services/volume.py:92-100` — SYMLINKED_PREFIXES constant
- `backend/agents/services/volume.py:141-153` — _validate_path()
- `backend/agents/tests/test_volume_architecture.py` — TestPathParity class
- `agent/rootfs/etc/s6-overlay/scripts/init-volume` — bash symlink script

## Pain Points for Refactoring Agent

These are the recurring friction points encountered during development. They aren't all bugs — some are architectural debt that makes every debugging session harder than it needs to be.

### 1. Hardcoded paths everywhere, no single source of truth

Paths like `/home/agent/.claude/settings.json`, `/run/secrets/proxy_key`, `/home/agent/workspace/.mcp.json` appear as string literals in: provisioning code, init-volume bash, relay.py, e2e tests, adapter modules, and settings.json templates. When a path changes (like moving api-key-helper.sh from `/opt/abox/` to `/run/secrets/`), you have to grep and update 5+ files. We added SYMLINKED_PREFIXES validation but individual file paths are still scattered.

**What the refactoring agent should do:** Consider a path constants module or an adapter method that returns all provision paths. The `provision_paths()` method in `adapter_cc.py` is a start but not all code uses it. Every path reference should trace back to one definition.

### 2. Three languages defining the same contract

The volume architecture requires agreement between: Python (backend provisioning + volume.py), Bash (init-volume symlink script), and the CC binary's expectations (settings paths, MCP config location). There's no shared schema — parity is enforced by architecture tests that parse bash with regex. This works but is fragile.

**Key files in the contract:**
- `backend/agents/services/volume.py` — SYMLINKED_PREFIXES, MANAGED_CONFIG_FILES
- `agent/rootfs/etc/s6-overlay/scripts/init-volume` — symlink definitions
- `backend/agents/services/adapters/adapter_cc.py` — provision_paths(), build methods
- `backend/agents/tests/test_volume_architecture.py` — parity tests

### 3. Relay startup is a black box during failures

When the SDK init times out, the relay logs show: `sdk_creating → sdk_created → [60s] → sdk_connect_failed`. No intermediate state. We don't know if the claude binary started, if it's hanging on MCP connection, if it crashed silently, or if the stdin JSON-RPC pipe broke. The SDK's `SubprocessCLITransport` captures stderr but the relay doesn't log it during the timeout window — only after failure.

**What would help:** Stream claude binary stderr to relay logs in real-time during init, not just on failure. Add intermediate logging: "binary spawned with PID X", "stdin pipe open", "waiting for initialize response".

### 4. MCP server connection failures are silent inside CC binary

The CC binary connects to all configured MCP servers during `initialize`. If any server connection hangs (wrong type, wrong URL, auth failure), the entire init times out with a generic "Control request timeout: initialize" — no indication of WHICH server failed or WHY. This cost us hours of debugging.

**What would help:** The relay should test MCP server reachability BEFORE spawning the SDK. A simple HTTP GET to each SSE endpoint would catch most failures in <1 second instead of waiting 60s for a generic timeout.

### 5. Container cleanup races with debugging

When an agent errors out, the reconciler reaps it (kills container) within seconds. By the time you notice the error in the dashboard, the container and its logs are gone. Every debugging session starts with "container already cleaned up." The volume persists but relay stdout/stderr doesn't.

**What would help:** Either persist relay logs to the volume (`_abox/relay.log`), or add a configurable reap delay for dev environments, or capture the last N lines of relay output before killing the container.

### 6. Backend restarts during provisioning leave zombies

`asyncio.create_task` for provisioning means if the backend restarts mid-provision, the task is gone. The container might be created but not fully provisioned. The reconciler catches some states but the causal chain is weak — you get agents stuck in "deploying" with no way to know what step failed.

### 7. The relay has two code paths for the same thing

Relay handles commands both in the running loop (`_handle_command`) and in the idle loop. The idle loop has duplicate handling for input, signal, mode changes. This means bugs fixed in one path don't get fixed in the other. The poke-based architecture (Phase 4 of volume plan) would collapse these into one path.

**Reference:** See the volume architecture plan at `~/.claude/plans/indexed-imagining-wren.md`, Phase 4 for the target relay architecture.

### 8. Exception handling is "fail silent" not "fail loud"

Per project principles (CLAUDE.md, principle #12: "Fail loud, never fail silent"), broad `except Exception` with logging but no re-raise is the dominant pattern. The audit found 59 occurrences. Many are intentional (best-effort push to dashboard, etc.) but the intent isn't always clear. The `# intentional:` annotation convention was started but not applied everywhere.

### 9. No way to test message delivery without a full stack

Testing that a message reaches an agent requires: backend + postgres + redis + docker + agent container + relay + claude binary. There's no unit-testable path for "message accepted → inbox written → relay consumed." The volume architecture enables this (write to inbox.jsonl, check inbox.pos) but there's no test harness for it yet.

## Architecture Reference for Refactoring

- **Volume plan:** `~/.claude/plans/indexed-imagining-wren.md` — full 8-phase plan for volume-based state architecture. Phases 1-2 are done. Phase 3 (init-volume) is done. Phases 4-8 are pending.
- **Project principles:** Root `CLAUDE.md` — especially "Mirror Don't Map", "Fail loud never fail silent", "One code path"
- **Architecture doc:** `docs/ARCHITECTURE.md` — system topology, data flow
- **Foundations:** `docs/FOUNDATIONS.md` — product axioms and design decisions

## Bottom Line

The current architecture has the right components and boundaries. The next step to reach "production-grade clarity" is to enforce **failure semantics** as strictly as feature semantics.
If the system can mechanically prove delivery guarantees, lifecycle convergence, and diagnosable failures under chaos, debugging difficulty drops dramatically.
