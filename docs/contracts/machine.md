# Machine Contract

This document resets the state model for Agentobox around one principle:

- mutable agent runtime state lives on the agent machine filesystem

The goal is to eliminate ambiguous ownership and make Docker and Modal
implementations of one contract instead of two partially different systems.

Execution planning for this refactor lives in
[Machine Migration Plan](./machine-migration-plan.md).

## Why This Exists

The current system has a real abstraction leak:

- the agent runtime writes canonical machine state into `_abox/status.json`
- Docker-local paths make that state easy for the backend to read
- Modal does not provide the same direct host-path visibility
- backend serializers then fall back to stale or empty state and the UI lies

The fix is not more special-casing. The fix is to define a proper machine
state contract and a runtime-agnostic volume abstraction.

## Core Objects

### `ProjectVolume`

One durable machine-state boundary per project.

This is the persistent writable state for everything the project's agents own.
It is the backing store for agent machine surfaces, secrets, desired config,
status projections, and durable inbox/outbox files.

### `AgentMachine`

One agent-specific subtree inside the project volume.

This is the runtime-owned mutable machine surface for a single agent. It is
what the runtime sees as its writable environment.

### `ImmutableRuntimeImage`

The base operating environment.

This image provides:

- Python runtime
- system packages
- Chromium binary
- desktop tooling
- s6/process supervision
- Agentobox runtime code

It is not treated as mutable durable state.

### `ControlPlane`

The backend orchestration layer.

It owns:

- identity
- auth
- desired lifecycle
- feed/events
- billing/accounting
- projections and caches

It does not own live runtime truth.

## State Ownership

### Backend-owned

Backend owns desired state and policy:

- desired runtime configuration
- lifecycle intent
- secrets materialization
- MCP gateway configuration
- user-facing feed/events
- projected read models

### Agent-owned

Agent runtime owns live machine truth:

- current runtime status
- service/process state
- task/runtime activity
- discovered machine facts
- local generated desktop/browser state

### Projection-only

Anything stored in the DB for UI/query speed is a projection.

If there is ever disagreement between:

- machine filesystem truth
- DB projection

the machine wins.

## Filesystem Shape

The project volume contains one subtree per agent:

```text
project-volume/
  agents/
    {agent_id}/
      machine/
        home/agent/
        tmp/
        run/
          secrets/
          mcp-gateway/
        mnt/abox-state/
        _abox/
          desired.json
          status.json
          facts.json
          inbox.jsonl
          inbox.cursor.json
          outbox.jsonl
          outbox.cursor.json
```

Important rule:

- this is the entire mutable machine surface
- not just a handful of config files

The runtime should treat this as the writable machine state it owns.

## Canonical Files

### `_abox/desired.json`

Owner: backend

Purpose:

- runtime-desired configuration
- model/mode/tool policy
- desired launch/runtime settings
- other control-plane instructions that the runtime must reconcile

### `_abox/status.json`

Owner: agent runtime

Purpose:

- current live runtime truth
- startup stage
- runtime state
- transport state
- service health
- task/session activity

This is the canonical runtime status file.

### `_abox/facts.json`

Owner: agent runtime

Purpose:

- slower-changing machine facts
- installed tools and versions
- discovered capabilities
- browser/tool availability
- package manager presence
- machine-level inventory useful to backend/UI

This is not required for the first implementation, but it is the right place
for discovered machine capabilities once we need them.

### `_abox/inbox.jsonl`

Owner: backend appends, agent consumes

Purpose:

- durable commands/tasks for the runtime

### `_abox/outbox.jsonl`

Owner: agent appends, backend consumes

Purpose:

- durable runtime-side events when filesystem durability matters more than
  low-latency transport delivery

## Secrets and MCP

This contract still cleanly supports separate secrets and root-owned files.

Recommended paths:

- `run/secrets/...`
- `run/mcp-gateway/config.json`
- `mnt/abox-state/secrets/env`

Rules:

- backend writes desired secret material into the project volume
- runtime reads those files locally
- file permissions remain explicit
- root-owned vs agent-owned paths are still valid distinctions

Nothing about the machine-volume model conflicts with:

- scoped secrets
- MCP gateway config
- root-only secret files

It makes them more explicit by placing them inside the canonical machine
surface instead of scattering them across special cases.

## State Layer Mapping

Every canonical file belongs to one of four layers. This mapping is the
contract for incident diagnosis, bundle assembly, and future subsystem
design.

### Desired (backend-owned intent)

| Path | Purpose |
|------|---------|
| `_abox/state.json` | model, mode, allowed tools |
| `_abox/inbox.jsonl` | pending tasks/messages |
| `tmp/abox-theme/tokens.json` | canonical theme document |
| `home/agent/.relay_env` | relay configuration |
| `home/agent/.claude/settings.json` | CC settings |
| `home/agent/workspace/CLAUDE.md` | agent instructions |
| `run/secrets/*` | materialized secrets |
| `run/mcp-gateway/config.json` | MCP gateway configuration |

### Observed (runtime-reported truth)

| Path / Source | Purpose |
|------|---------|
| `_abox/status.json` | live runtime status (startup stage, services, transport) |
| `_abox/facts.json` | slower-changing machine facts (future) |
| `Agent.runtime_status_projection` (DB) | backend-visible cache of status.json |

### Applied (runtime-consumer truth)

| Path | Purpose |
|------|---------|
| `tmp/abox-theme/theme.json` | derived theme document |
| `tmp/abox-theme/theme.css` | derived CSS variables |
| `tmp/abox-theme/awesome.lua` | derived AwesomeWM theme table |
| `tmp/abox-theme/browser-home/index.html` | derived browser home surface |

These are produced by the runtime theme service from the desired
`tokens.json`. They are the durable applied state for theme.

Launcher, display, and process status do not yet have canonical applied
artifacts. They are currently event-only (runtime.jsonl). If they become
important enough to diagnose durably, add a canonical runtime artifact
(e.g. `_abox/desktop-status.json`) rather than growing log parsing.

### Events (supporting evidence)

| Path | Purpose |
|------|---------|
| `_abox/logs/runtime.jsonl` | structured runtime events (transitions, attempts, failures) |

Events are not a state layer. They are supporting evidence for
transitions and ephemeral outcomes. Incident bundles read canonical
artifacts first, events second.

### Rules for new subsystems

When adding a new runtime-managed subsystem:

1. If it has durable state, give it a canonical artifact under the
   machine surface.
2. Consumers must read from canonical/derived artifacts, not ad hoc
   local state.
3. Ephemeral transitions and attempt outcomes go through `emit_event()`
   to `runtime.jsonl`.
4. The incident bundle should read durable applied state from files,
   not from log parsing.

## Preview Contract

Preview must be derived from machine truth, not inferred from unrelated app
health.

Desktop preview readiness means:

- `xvfb` up
- `x11vnc` up
- `websockify` up
- `awesome` up
- transport/connectivity sufficient for desktop access

It does not mean:

- Chromium is healthy

Chromium is an app-level service, not a gate for whether the desktop exists.

## Docker and Modal

Docker and Modal must implement the same logical contract:

- same machine subtree shape
- same canonical file ownership
- same desired/status/facts semantics

They differ only in the `ProjectVolumeStore` implementation.

### Docker Local

Backend implementation:

- local filesystem-backed volume store

Runtime implementation:

- bind mount / direct local access to the same project volume subtree

### Modal

Backend implementation:

- Modal-backed volume store
- explicit read/write/list/stat API through Modal-aware volume access

Runtime implementation:

- sandbox mounts the same project volume
- runtime writes canonical files into that mounted machine subtree

Important rule:

- backend must never assume local host-path visibility for Modal
- backend must go through the volume abstraction

## `ProjectVolumeStore`

The backend must use one runtime-agnostic interface for machine-state access.

Suggested operations:

- `read(project_id, path) -> bytes`
- `write(project_id, path, bytes) -> None`
- `append(project_id, path, bytes) -> None`
- `exists(project_id, path) -> bool`
- `list(project_id, prefix) -> list[str]`
- `stat(project_id, path) -> FileStat`

Implementations:

- `LocalProjectVolumeStore`
- `ModalProjectVolumeStore`

Business logic must not build runtime-specific path assumptions outside this
abstraction.

## Transport Contract

Transport is not the source of truth for machine state.

WebSocket/relay exists for:

- low-latency signaling
- callbacks/approvals
- live event streaming
- optional acceleration of projection updates

If the websocket dies:

- machine truth still exists on the volume
- backend can recover by reading canonical machine files

Transport may publish machine-state updates to accelerate projections, but that
transport payload is still a projection of machine truth, not a competing
authority.

## Projections

The backend may cache selected machine state for fast reads:

- current preview state
- current lifecycle summary
- machine facts summary
- current task/session summary

But these are read models only.

They must be:

- disposable
- rehydratable from machine truth
- clearly marked as projections

The backend must not invent runtime truth in DB fields that can diverge
silently from the machine.

## What This Simplifies

This model eliminates three major classes of ambiguity:

### 1. Ownership ambiguity

Instead of asking:

- is this in DB?
- on the volume?
- only in relay memory?
- only visible in one runtime?

the answer becomes explicit:

- backend owns desired state
- agent owns runtime state
- both use the same project volume abstraction

### 2. Runtime-specific filesystem assumptions

Today Docker and Modal differ in how visible runtime-written files are to the
backend.

With an explicit `ProjectVolumeStore`, Docker and Modal become:

- same contract
- different backend adapters

### 3. Transport-as-secret-state-system

Today transport is doing more than it should.

With this model:

- transport is only transport
- canonical machine state remains on the volume
- transport can accelerate projections, but never replace machine truth

## What This Affords

### Durable machine evolution

If users install tools or mutate their environment, those changes can persist
inside the agent machine surface instead of disappearing into ad hoc runtime
state.

### Clean recovery

If the backend restarts or the websocket drops:

- machine truth still exists
- the backend can re-read canonical files

### Better runtime parity

Docker and Modal no longer differ in architecture.

They become two implementations of one machine-state contract.

### Cleaner UI

GraphQL/UI read models become projections from one machine truth, not guesses
assembled from partial data.

## Non-Goals

This document does not require:

- storing the entire immutable OS root filesystem on the volume
- replacing all DB models with filesystem data
- removing websocket transport

The point is not “everything is a file.” The point is:

- mutable machine/runtime truth is explicit
- ownership is explicit
- backend access to that truth is explicit

## Migration Direction

This should be implemented in phases.

### Phase 1: Make machine state explicit

- define the canonical machine subtree layout
- define `desired`, `status`, and optional `facts`
- define `ProjectVolumeStore`

### Phase 2: Move backend reads behind the volume abstraction

- serializers
- reconcile
- preview derivation
- diagnostics capture

No backend code should assume local host-path semantics for Modal.

### Phase 3: Make transport projection-only

- use relay to accelerate updates if useful
- but keep canonical truth on the machine volume
- ensure projections can always be rebuilt from machine state

### Phase 4: Clean up old dual-truth seams

- remove ad hoc sync code
- remove runtime-specific filesystem assumptions
- reduce DB fields that pretend to be canonical runtime truth

## Architectural Standard

When evaluating future changes, prefer the option that:

- minimizes competing sources of truth
- keeps runtime truth owned by the runtime
- keeps backend truth limited to desired state and projections
- treats Docker and Modal as runtime adapters of one contract
- makes recovery possible from machine files alone

If a change makes runtime truth harder to locate, it is probably moving in the
wrong direction.
