# Runtime Failure Audit

Date: 2026-03-18
Scope: `backend/`, `agent/`, and desktop-runtime debugging for live agents

## Purpose

This document defines the standard audit process for runtime failures.

The goal is:
- stop debugging from anecdotes
- collect the same evidence every time
- classify failures by layer and contract
- turn root causes into invariants and regression tests

This is the standard process for issues such as:
- runtime disappears after boot
- Firefox/Textfox reopens on the wrong profile
- theme update is missed during browser startup
- VNC preview flickers or reconnects repeatedly
- backend state says an agent is healthy when the runtime is gone

## Core Principles

1. Start from runtime truth, not UI symptoms.
2. Split failures by layer before proposing fixes.
3. Compare actual generated files and process state against the intended contract.
4. Preserve evidence durably on the agent volume.
5. Convert every resolved failure class into a regression test.

## Failure Classification

Every runtime issue should be classified into one primary failure class.

### Desktop / Browser

- `desktop.browser_wrong_profile`
  - Reopened Firefox uses a stock ESR profile instead of `agentobox.default`
- `desktop.browser_exited`
  - Firefox is closed or exits while the desktop remains valid
- `desktop.theme_reload_missed`
  - Theme files changed, but a consumer did not visually converge
- `desktop.consumer_unavailable`
  - A desktop consumer is not running when a theme update is applied

### VNC / Preview

- `vnc.client_reconnect_loop`
  - Viewer reconnects repeatedly while desktop services stay healthy
- `vnc.upstream_unready`
  - VNC proxy reached the runtime before websockify was ready
- `vnc.runtime_missing`
  - Backend attempted VNC against a stale or missing runtime

### Runtime / Lifecycle

- `runtime.stuck_deploy`
  - Agent remains `deploying` beyond the allowed window
- `runtime.dead_runtime`
  - Runtime exists but exits or dies unexpectedly
- `runtime.runtime_missing`
  - Backend state points at a runtime that no longer exists
- `runtime.reload_unsupported`
  - Backend asked runtime to reload a canonical file the runtime does not support

### CI / Contract

- `ci.bind_mount_uid_mismatch`
  - Host-side test reads a runtime-owned artifact directly from a bind mount
- `ci.runtime_contract_drift`
  - Test assumes old runtime shape or stale file/process ownership

## Layer Model

Every audit must identify the layer where the failure originates.

- `frontend`
  - React state, VNC component lifecycle, optimistic UI behavior
- `backend`
  - lifecycle, relay, reconciler, VNC proxy, dashboard projections
- `agent-runtime`
  - managed session, executor, theme projection, desktop service supervision
- `platform`
  - Docker, Modal, process/container lifecycle, network resolution
- `environment`
  - CI runner permissions, Docker Desktop differences, local machine behavior

Do not fix a failure in the wrong layer.

## Standard Capture Bundle

For every runtime failure, collect the same bundle before guessing.

### Required

- agent status snapshot
  - `_abox/status.json`
- runtime log tail
  - `_abox/logs/runtime.jsonl`
- runtime diagnostics bundle
  - `_abox/runtime-diagnostics.json` when present
- backend log tail for the same timestamps
- relevant generated contract files
- service/process snapshot

### Generated Files To Check

- `_abox/state.json`
- `_abox/status.json`
- `tmp/abox-theme/tokens.json`
- `tmp/abox-theme/theme.css`
- `tmp/abox-theme/awesome.lua`

### Process Snapshot

For desktop/runtime issues, capture:
- `ps aux`
- service states from runtime status
- if Docker-backed: last Docker event tail for the sandbox/container

## Standard Audit Procedure

Use this exact order.

1. Reproduce the symptom as precisely as possible.
2. Record the visible symptom in user terms.
3. Identify the expected contract.
4. Inspect durable runtime truth on the agent volume.
5. Inspect process and service state.
6. Compare generated files against the expected contract.
7. Check backend relay/reconciler/lifecycle logs for the same timestamps.
8. Assign a failure class and owning layer.
9. Only then propose a fix.
10. Add or update a regression test for the class.

## Expected Contracts

### Browser Contract

If the managed desktop launches the browser:
- the `browser` service must remain `up`
- the launcher command must point at the configured baseline browser
- the profile dir and startup URL must be deterministic

### Theme Convergence Contract

When canonical theme tokens change:
- `tokens.json` must update
- `theme.css` must update
- every active theme consumer must converge within a bounded delay
- a missing or closed consumer must degrade gracefully without poisoning runtime state

### Runtime State Contract

If backend treats an agent as live:
- runtime must exist
- runtime status must be internally consistent
- stale runtime endpoints must be cleared when runtime is missing

### Contract Test Ownership Rule

If a file is runtime-owned:
- contract tests must read it from inside the runtime/container
- not from a host-side bind mount

## Event Naming Rules

Use the existing structured flat-event style. Do not invent ad hoc payload blobs.

### Common Envelope

Every runtime-facing event should prefer:
- `event`
- `agent_id`
- `project_id` when applicable
- `operation`
- `reason`
- `error_code`
- `error_class`
- `previous_status`
- `next_status`

### Event Families

- `lifecycle.*`
- `reconciler.*`
- `runtime.*`
- `relay.*`
- `vnc.*`
- `theme.*`
- `service.*`

### Reason Values

Keep `reason`, but make it specific.

Good:
- `reconciler.runtime_missing`
- `reconciler.dead_runtime`
- `relay.connected`
- `state_reloaded`

Bad:
- `reconciler`
- `error`
- `unknown`

## Current Failure Classes We Have Already Hit

### `desktop.browser_wrong_profile`

Manifestation:
- closing Firefox and reopening it shows stock Firefox onboarding instead of Textfox

Root Cause Pattern:
- managed startup used an explicit profile
- dock/manual reopen did not use the same launch contract
- `profiles.ini` drifted to auto-created stock ESR profiles

Correct Fix Pattern:
- deterministic profile launch on every managed reopen path
- `profiles.ini` points at `agentobox.default`

Regression Coverage:
- desktop config tests should assert launcher/profile materialization

### `desktop.theme_reload_missed`

Manifestation:
- theme files update but Firefox or Awesome does not visually converge

Root Cause Pattern:
- consumer startup race or unsupported color format in a downstream consumer

Correct Fix Pattern:
- canonical tokens remain unchanged
- consumer-specific projection handles format needs
- consumer apply retries briefly during startup
- closed consumer logs `theme.consumer_unavailable` instead of failing the runtime

Regression Coverage:
- theme tests for retry behavior and consumer-specific projection rules

### `vnc.client_reconnect_loop`

Manifestation:
- preview flickers and reconnects repeatedly while desktop services remain healthy

Root Cause Pattern:
- viewer lifecycle churn, not x11vnc/websockify failure

Correct Fix Pattern:
- preserve session state across frontend churn
- stop reconnect attempts when backend says runtime is unavailable
- avoid remounting the viewer on transient UI changes

Regression Coverage:
- dashboard VNC tests around reconnect and error state reset

### `runtime.reload_unsupported`

Manifestation:
- backend pushes reload for a canonical file and managed transport degrades

Root Cause Pattern:
- backend treated a canonical file as mutable/reloadable
- runtime did not yet support that reload path

Correct Fix Pattern:
- canonical mutable docs must be first-class reloadable in the runtime before backend emits reload commands for them

Regression Coverage:
- managed session reload tests for each supported canonical path

## Invariants To Enforce

These should become tests and code review checks.

1. If a runtime-owned file is part of a container contract test, read it from inside the container.
2. If backend emits a reload for a canonical file, the runtime must support that path.
3. Closing a desktop application must not corrupt the runtime; unavailable consumers degrade gracefully.
4. Reopening a managed desktop application must use the deterministic managed config/profile path.
5. Theme updates must converge for active consumers and degrade gracefully for inactive consumers.
6. `supervised` mode only surfaces true intervention states such as permission and plan.

## Regression Test Pattern

Every fix should land with:
- a named failure class
- one direct repro test
- an assertion on the durable contract, not just UI output

Good examples:
- close Firefox, relaunch, assert `profiles.ini` and launch command still point at `agentobox.default`
- apply a theme during Firefox startup, assert eventual consumer convergence
- change `_abox/state.json`, assert managed runtime reloads it without transport degradation
- read runtime-owned desktop files via container exec in Docker contract tests

## Operator Checklist

When debugging a fresh runtime issue:

1. Identify the failure class.
2. Pull `_abox/status.json`.
3. Pull `_abox/logs/runtime.jsonl`.
4. Pull `_abox/runtime-diagnostics.json` if present.
5. Check relevant generated files.
6. Check process and service state.
7. Check backend relay/reconciler logs for matching timestamps.
8. Decide the owning layer.
9. Propose the smallest fix that restores the contract.
10. Add a regression test before closing the issue.

## Follow-On Work

High-value next steps:
- add a typed `agent.logs` facade over `_abox/logs/runtime.jsonl`
- add a small backend diagnostics helper for per-agent runtime snapshots
- keep reducing low-signal repeated logs
- keep converting environment-sensitive tests into strict runtime contract tests
