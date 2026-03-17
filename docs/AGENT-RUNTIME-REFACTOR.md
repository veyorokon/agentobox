# Agent Runtime Refactor

First-principles target architecture for the Agentobox agent runtime.

This document defines the desired shape of the system independent of the
current implementation. It is not a patch plan for today's code. It is the
architectural target that current code should be compared against.

The core rule is simple:

`agentobox-agent` is a self-sufficient agent runtime.
`agentobox-backend` is an optional control plane that provisions, coordinates,
and observes that runtime.

Everything that does not fit that shape should be removed, split, or moved.

## Implementation Status

The greenfield runtime now already enforces several target-shape rules:

- explicit `standalone` vs `managed` mode
- canonical lifecycle and status vocabulary
- provisioning manifest plus validation boundary
- managed transport as a plugin seam
- canonical downstream command parsing via `commands.py` and `codec.py`
- an explicit execution seam separate from transport
- canonical structured task input using ACP/MCP-style content blocks
- executor-owned result and process-exit normalization
- structured JSON logging as a shared contract
- a dedicated lifecycle coordinator owning transition policy
- a canonical managed-process wrapper for future service supervision
- a real package entrypoint for direct runtime execution
- a minimal standalone Docker image wrapping the new runtime package
- an explicit managed bootstrap module and managed Docker image entrypoint
- explicit runtime profiles for `core` vs `desktop` runtime shapes
- runtime-owned projection of `_abox/status.json` from in-memory live state
- canonical theme tokens plus derived runtime-owned theme artifacts
- managed live theme reload via explicit `reload { path }`
- a black-box local HTTP contract test covering `livez`, `readyz`, `status`, and `/tasks`
- an opt-in black-box Docker-managed contract test for the real image boundary
- an opt-in black-box Docker-managed desktop contract covering desktop services and noVNC

That means the runtime is no longer being rebuilt as a collection of shell
scripts with implicit conventions. The composition root, lifecycle policy,
process wrapper, transport seam, and execution seam are now explicit
code-level contracts.

## Purpose

This refactor exists to make three things true:

1. The agent runtime is valid in isolation.
2. Managed mode is an extension of standalone mode, not a separate creature.
3. Tests map to architecture contracts instead of historical bug clusters.

## First Principles

1. The agent is the product; the backend is a control plane.
2. The agent must boot and operate without the backend.
3. Backend integration is optional capability, not a precondition for validity.
4. Startup behavior must be explicit, deterministic, and mode-aware.
5. Health must describe readiness for the selected mode, not internal trivia.
6. Provisioning must end in one explicit release invariant.
7. Every behavior belongs to exactly one layer.
8. Test layers should mirror architecture layers.

## Desired Properties

The ideal runtime has these properties:

- A standalone agent image can boot, expose health, and do local work.
- The same image can attach to Agentobox when managed-mode config is provided.
- Missing backend config in standalone mode is normal.
- Missing backend config in managed mode is a startup error.
- Local health/status work even when the control plane is absent.
- Backend provisioning never races service startup.
- Runtime portability holds across Docker, Modal, and future runtimes.

## System Shape

There are four layers and only four layers.

### 1. Core Agent Runtime

Owns:

- model/session runtime
- execution adapters and execution-event normalization
- local execution loop
- local state files
- local health/status
- service supervision
- local input/output surfaces

Does not own:

- GraphQL
- project/team semantics
- backend authentication
- dashboard/feed/history

### 2. Provisioning Layer

Owns:

- how config arrives
- how workspace files arrive
- how secrets arrive
- readiness validation
- file layout and convergence rules

Provisioning is a plug-in layer, not the runtime itself.

Expected providers:

- standalone bootstrap provider
- managed/backend provisioning provider

### 3. Control-Plane Transport

Owns:

- backend auth
- relay/WebSocket transport
- remote ingress/egress
- reconnect policy
- remote state publication

This layer is optional in standalone mode.

### 4. Agentobox Backend

Owns:

- orchestration
- persistence
- permissions/approvals
- projects/teams
- dashboard projections
- feed/history
- fleet lifecycle and observation

The backend coordinates agents. It does not define whether an agent is a valid
runtime artifact.

## Operating Modes

The runtime should have explicit operating modes.

Use a mode variable, not inference alone:

`AGENTOBOX_MODE=standalone|managed`

Inference may exist as a temporary migration aid, but explicit mode is the
long-term contract.

### Standalone Mode

Required behavior:

- boot without backend
- local services become healthy
- local runtime becomes ready
- local health/status remain meaningful
- local work can be submitted through a local API, CLI, or queue

Not required:

- relay auth token
- backend callback URL
- control-plane transport connection

### Managed Mode

Required behavior:

- all standalone guarantees still hold
- managed transport starts
- execution continues to be runtime-owned, not transport-owned
- backend auth/config are validated at startup
- runtime connects to control plane
- remote coordination and observation work

Required config:

- backend URL/callback URL
- relay auth token
- any additional managed transport requirements

## Runtime Profiles

Mode answers whether the control plane is attached.
Profile answers what runtime shape the image provides.

Use an explicit profile variable:

`AGENTOBOX_RUNTIME_PROFILE=core|desktop`

Current meaning:

- `core`
  - no desktop/X11/VNC stack
  - valid for standalone and managed non-visual execution
- `desktop`
  - includes the desktop service graph
  - consumes derived theme artifacts
  - exposes the noVNC/browser surface

This keeps platform and runtime shape separate:

- platforms: `local`, `docker`, `modal`
- profiles: `core`, `desktop`

The runtime must not pretend a desktop stack exists when the image only ships a
core profile.

## Startup Flow

### Standalone Mode

1. Read mode and local config.
2. Validate standalone-required config.
3. Prepare local state directories/files.
4. Start local services.
5. Start local agent runtime.
6. Expose health and status endpoints.
7. Accept local work.
8. Report ready when local runtime is ready.

### Managed Mode

1. Read mode and managed config.
2. Validate managed-required config.
3. Wait for provisioning completion.
4. Validate provisioned runtime files.
5. Prepare local state directories/files.
6. Start local services.
7. Start managed transport.
8. Authenticate and connect to backend.
9. Report ready when both local runtime and transport are healthy.

## Health Model

Health endpoints must be mode-aware.

### `/livez`

Meaning:

- process is alive
- event loop is responsive

Mode dependence:

- none

### `/readyz`

Meaning:

- ready for the selected mode

Standalone mode:

- local runtime is healthy

Managed mode:

- local runtime is healthy
- managed transport is authenticated and connected

### `/status`

Returns structured state for humans and automation:

- mode
- startup stage
- runtime stage
- transport stage
- current session/task
- degraded components
- last error
- readiness facets

## Provisioning Contract

Provisioning must end in a single explicit invariant:

"By the time runtime startup is released, every required file for the selected
mode exists and is readable."

That means:

- one provisioning manifest
- one completion sentinel
- one validation point
- one release boundary

What does not count as readiness:

- a directory existing
- some files probably being present
- a service starting and hoping the rest arrives later

## File Parity Contract

The runtime should consume one canonical filesystem contract regardless of how
it is provisioned.

This is the core parity rule:

"Managed mode and standalone mode must populate the same runtime-visible file
layout."

That includes files such as:

- runtime env files
- workspace files
- MCP config
- theme tokens and derived files
- secret material and secret env exports
- runtime state/status files
- managed task inbox files

The backend is one provisioning provider. Standalone bootstrap is another.
Neither provider gets to define a separate runtime filesystem model.

### File Parity Rules

1. The runtime sees one canonical layout.
2. Providers may differ in how files arrive, not where they end up.
3. File meaning must not depend on runtime platform.
4. Release conditions must validate runtime-visible files, not provider-local
   intermediate paths.
5. Derived artifacts such as theme outputs should be generated from the same
   source files in both modes whenever possible.

### Practical Consequence

If a file is required by the runtime, the refactor should answer:

- what is its canonical path?
- which provider writes it in standalone mode?
- which provider writes it in managed mode?
- what validator proves it is present before release?

If those answers are different per mode in a way the runtime must know about,
the design is wrong.

## Runtime Portability Contract

The target architecture must work for both Docker and Modal.

This is not a deployment detail. It is a first-class design constraint.

The correct abstraction is:

- one runtime contract
- multiple platform adapters

Docker and Modal may differ in:

- process model
- entrypoint behavior
- volume implementation
- network exposure
- exec/write-file primitives

They must not differ in:

- operating modes
- runtime-visible file layout
- lifecycle vocabulary
- health/status schema
- provisioning release invariant
- managed transport semantics

### Platform Rule

Platform adapters may change how the contract is implemented.
They may not change what the contract means.

If Docker and Modal need different meanings for readiness, file paths, or
runtime state, the abstraction is wrong.

## Transport Contract

Managed transport is a plugin, not the runtime.

It should have:

- explicit config requirements
- explicit auth requirements
- explicit retry policy
- explicit fatal states

Standalone mode:

- transport is absent or disabled
- this is healthy, not degraded

Managed mode:

- transport is required
- missing config is a startup failure
- partial config is a startup failure

## State Ownership

### Runtime-Owned State

- local session state
- applied runtime config
- local readiness
- service status
- local execution state

### Control-Plane-Owned State

- projects and teams
- feed/history
- lifecycle attempts
- permission and approval state
- dashboard projections
- long-term persisted audit state

Mirroring should be minimized.

If something is runtime truth, the backend observes it.
If something is control-plane truth, the runtime consumes it.

## Testing Model

The test structure should mirror the architecture directly.

### 1. Runtime Contract

No backend.

Proves:

- image boots
- supervision works
- required local files are readable
- health/status endpoints work
- local services are healthy
- standalone/reduced-mode runtime is valid

### 2. Bootstrap Contract

Real provisioning plus real runtime.

Proves:

- managed provisioning writes the correct files
- readiness release is correct
- managed transport can start
- agent reaches connected idle/ready state

### 3. Control-Plane Contract

Backend plus runtime integration.

Proves:

- auth/connect
- lifecycle transitions
- remote ingress/egress
- state reporting

### 4. Full Smoke

End-to-end user-visible work.

Proves:

- create agent
- wait for ready
- send deterministic work
- receive deterministic result

## Canonical Repo Shape

The target repository shape should reflect the layers above.

### Agent Side

`agent/runtime/`

- runtime loop
- execution adapters
- health/status
- local input/output
- service ownership

`agent/provisioning/`

- file layout
- provisioning manifest
- readiness validation
- mode-specific config loading

`agent/transports/agentobox/`

- relay transport
- backend auth
- managed-mode connection logic
- downstream command protocol
- upstream message protocol

### Backend Side

`backend/control_plane/`

- orchestration
- persistence
- UI/API projections
- policy and coordination

The exact directories may differ, but the ownership boundaries should not.

## Contracts and Surfaces

The runtime should expose a small number of explicit surfaces.

### Runtime Surface

This is the standalone-valid surface.

Expected entrypoints:

- container entrypoint
- package/process entrypoint
- local health API
- local status API
- local work ingress
- local logs/output surface

Current implementation:

- `agent/main.py`
- `python -m agent`
- `agentobox-agent`
- `agent/Dockerfile`

Concrete contracts:

- startup accepts explicit mode
- local runtime can start without control-plane config
- required local files are validated before runtime ready
- health describes local truth

### Provisioning Surface

This is how config enters the runtime.

Expected inputs:

- mode
- runtime manifest
- workspace files
- secrets
- completion sentinel

Concrete contracts:

- one manifest format
- one completion signal
- one validation step before release
- provisioning is allowed to be different per provider, but not per consumer

### Managed Transport Surface

This is the Agentobox-specific plugin surface.

Expected inputs:

- backend URL
- auth token
- agent identity
- reconnect policy

Concrete contracts:

- no transport startup in standalone mode
- strict startup validation in managed mode
- explicit connected/degraded/fatal states
- transport health reported separately from core runtime health
- downstream commands are explicit transport commands, not overloaded runtime
  events
- upstream messages are derived from runtime execution and task state, not from
  websocket mechanics

### Control-Plane Surface

This is the backend's view of the runtime.

Expected surfaces:

- create/provision
- observe health and status
- connect transport
- deliver remote input
- receive remote output
- terminate/restart

Concrete contracts:

- backend does not define core runtime validity
- backend provisions and coordinates a runtime that is already valid in itself

## Composition Rules

The runtime should enforce these composition boundaries:

### `AgentApplication`

Owns:

- component wiring
- process ownership
- boot/shutdown sequencing
- executor injection

Does not own:

- lifecycle transition policy
- transport semantics
- provisioning semantics
- SDK-specific execution details

`AgentApplication` is the composition root, not the state machine.

### `LifecycleCoordinator`

Owns:

- startup transitions
- managed transport transitions
- readiness/degraded/fatal policy
- canonical lifecycle event emission

The coordinator is the single place where runtime transitions become legal.

### Execution Adapters

Own:

- SDK-specific option building
- raw message preservation/normalization
- callback-request construction
- task-time execution events

Do not own:

- websocket lifecycle
- backend wire protocol policy
- runtime boot/shutdown sequencing

Execution adapters are runtime components. They are not transport clients.

### `ManagedProcess`

Owns:

- subprocess launch
- stdout/stderr capture
- structured output forwarding
- stop/wait semantics

This is the canonical base for service supervision. New services should not
invent their own ad hoc logging or process-wrapping model.

## File Ownership Model

The refactor should produce clear file ownership, even if exact filenames
change during implementation.

### Agent Runtime Files

These files should exist under an explicit runtime boundary:

- runtime entrypoint
- runtime state model
- health/status server
- local work ingress
- local execution loop
- service supervision wiring
- lifecycle coordination
- process supervision

Suggested target paths:

- `agent/runtime/entrypoint.py`
- `agent/runtime/state.py`
- `agent/runtime/lifecycle.py`
- `agent/runtime/health.py`
- `agent/runtime/ingress.py`
- `agent/runtime/runner.py`
- `agent/runtime/process.py`
- `agent/runtime/services.py`

### Provisioning Files

These files should own file layout and startup release rules:

- provisioning manifest schema
- file writer/provider interface
- readiness validator
- sentinel/release logic
- mode-specific config assembly

Suggested target paths:

- `agent/provisioning/manifest.py`
- `agent/provisioning/providers/standalone.py`
- `agent/provisioning/providers/managed.py`
- `agent/provisioning/validate.py`
- `agent/provisioning/release.py`

### Managed Transport Files

These files should own the Agentobox-specific connection:

- transport config
- auth
- relay lifecycle
- message ingress/egress
- reconnect/fatal state handling

Suggested target paths:

- `agent/transports/agentobox/config.py`
- `agent/transports/agentobox/commands.py`
- `agent/transports/agentobox/codec.py`
- `agent/transports/agentobox/session.py`
- `agent/transports/agentobox/client.py`
- `agent/transports/agentobox/state.py`

### Backend Control-Plane Files

These files should own orchestration only:

- provision orchestration
- runtime selection
- lifecycle persistence
- dashboard/feed projections
- remote command delivery

Suggested target paths:

- `backend/control_plane/lifecycle.py`
- `backend/control_plane/provisioning.py`
- `backend/control_plane/runtime/`
- `backend/control_plane/streams.py`
- `backend/control_plane/feed.py`

## Current-to-Target Mapping

This table is a rubric for comparing today's code to the target shape.
It is intentionally high-level.

| Current area | Target layer | Desired outcome |
|--------------|--------------|-----------------|
| `agent/rootfs/usr/local/bin/abox-init` | Core runtime | Pure startup/supervision entrypoint |
| `agent/rootfs/etc/s6-overlay/scripts/init-volume` | Provisioning | Release only after explicit provisioning validity |
| `agent/rootfs/opt/abox/relay.py` and `relay_common.py` | Managed transport | Optional plugin, not core startup requirement |
| `agent/rootfs/opt/abox/relay_http.py` | Core runtime | Mode-aware health/status surface |
| `backend/agents/services/lifecycle.py` | Control plane | Orchestration only, not mixed provisioning semantics |
| `backend/agents/services/volume.py` | Provisioning | Explicit manifest/layout contract |
| `backend/agents/runtimes/*` | Control plane runtime adapter | Platform-specific sandbox/container execution only |
| smoke/bootstrap tests | Contract tests | One canonical suite per architecture layer |

## Required Runtime Contracts

These contracts should be explicit and testable.

### Contract: Mode Selection

Input:

- `AGENTOBOX_MODE`

Rules:

- `standalone` and `managed` are the only valid values
- mode is decided before any optional service starts
- inference is transitional only

### Contract: Local Health

Input:

- current runtime state

Output:

- `livez`
- `readyz`
- `status`

Rules:

- `livez` never depends on backend connectivity
- `readyz` depends on selected mode
- `status` exposes enough detail to debug startup without backend logs

### Contract: Provisioning Release

Input:

- provisioning manifest
- completion sentinel

Output:

- runtime startup release

Rules:

- startup is blocked until provisioning validity is established
- directory existence alone is never a valid release signal
- validation happens before longrun services consume provisioned files
- validation is performed against runtime-visible canonical paths or an
  equivalent manifest, not only provider-local source paths

### Contract: Managed Transport

Input:

- backend config
- auth token

Output:

- connected/degraded/fatal state

Rules:

- standalone mode does not require this contract
- managed mode requires complete config
- auth failure is explicit
- fatal transport misconfiguration is not silently downgraded

### Contract: Runtime Exec

Input:

- platform exec request

Output:

- output or raised failure

Rules:

- non-zero exec is failure by default
- best-effort call sites must opt into catching that failure
- provisioning must not continue after failed platform operations

### Contract: Platform Adapter

Input:

- runtime create/exec/write/terminate/list/status requests

Output:

- platform-specific behavior implementing one runtime contract

Rules:

- adapters may differ operationally, not semantically
- platform-specific hacks must stay inside the adapter boundary
- platform adapters must not redefine lifecycle or readiness vocabulary

## Standardization Targets

The refactor should standardize these areas explicitly rather than letting
them emerge informally.

### 1. Lifecycle Vocabulary

Define one canonical set of runtime lifecycle states and startup stages.

Suggested startup stages:

- `config_loading`
- `config_validated`
- `provisioning_wait`
- `provisioning_validated`
- `services_starting`
- `runtime_ready`
- `transport_connecting`
- `managed_ready`
- `degraded`
- `fatal`

Suggested runtime states:

- `starting`
- `ready`
- `busy`
- `degraded`
- `stopped`
- `fatal`

This vocabulary should be shared across:

- logs
- `/status`
- contract tests
- backend lifecycle observation

### 2. Health and Status Schema

Define a canonical JSON schema for:

- `/livez`
- `/readyz`
- `/status`

Minimum `/status` surface:

- mode
- build identity
- startup stage
- runtime state
- transport state
- service health map
- current session/task identifiers
- degraded reasons
- fatal reason

Example shape:

```json
{
  "status_version": "2",
  "mode": "managed",
  "build": {
    "image_ref": "agentobox-agent-runtime-desktop-managed:latest",
    "image_digest": "sha256:...",
    "git_commit": "abc1234"
  },
  "startup_stage": "transport_connecting",
  "runtime_state": "ready",
  "transport": {
    "enabled": true,
    "state": "connecting",
    "connected": false
  },
  "services": {
    "relay_http": "up",
    "xvfb": "up",
    "websockify": "up"
  },
  "degraded": [],
  "fatal": null
}
```

### 3. Event Taxonomy

Define a canonical event vocabulary for the agent runtime itself.

Suggested domains:

- `startup.*`
- `provisioning.*`
- `runtime.*`
- `transport.*`
- `health.*`
- `service.*`
- `platform.*`

The event taxonomy should be emitted from explicit coordinator/process paths,
not from scattered call sites that happen to notice a state change.

Examples:

- `startup.mode_selected`
- `startup.config_validated`
- `provisioning.release_wait`
- `provisioning.release_complete`
- `runtime.ready`
- `transport.connecting`
- `transport.connected`
- `transport.auth_failed`
- `service.failed`
- `platform.exec_failed`

The key requirement is consistency, not the exact strings.

### 4. Command Taxonomy

Define a canonical downstream command vocabulary for Agentobox-managed mode.

Commands are not events:

- commands request that the runtime do something
- events report facts that already happened

Current canonical downstream commands:

- `reload`
- `signal`
- `callback_response`

Current canonical payload rules:

- `reload` uses a literal `path` field
- `signal` uses a literal `action` field
- `callback_response` uses explicit `request_id`, `behavior`, and optional
  `message`

Example command shapes:

```json
{ "type": "reload", "path": "_abox/inbox.jsonl" }
{ "type": "signal", "action": "interrupt" }
{ "type": "callback_response", "request_id": "req-1", "behavior": "allow" }
```

The backend should adapt to this transport vocabulary. The agent/runtime owns
the command surface.

### 5. Upstream Message Taxonomy

Define a canonical upstream message vocabulary for Agentobox-managed mode.

Upstream messages are facts emitted from runtime/task/execution state. They are
separate from downstream commands and should be shaped by the execution layer.

Current canonical upstream messages:

- `runtime_hello`
- `task_update`

Current message intent:

- `runtime_hello` identifies the runtime, mode, platform, and protocol/schema
  versions on managed transport connect
- `task_update` reports queued/running/completed/failed/cleared task state

The upstream message set should remain minimal until the real execution layer
reveals which richer events are actually worth publishing.

### 5a. Canonical Task Input Envelope

Managed inbox files should carry runtime-owned task envelopes, not transport-era
`input/payload/message` wrappers and not lossy text-only payloads.

Canonical managed task shape:

```json
{
  "type": "task",
  "task_id": "task-123",
  "input": {
    "role": "user",
    "content": [
      { "type": "text", "text": "hello" }
    ]
  }
}
```

Rules:

- `type` is always `task`
- `task_id` is durable and provider-assigned
- `input` uses ACP/MCP-style content blocks
- executors adapt this semantic input model to their native wire format
- local standalone text submission may still enter through a simple text API,
  but runtime internals should normalize it into the same structured task input

### 6. Naming Rules

Standardize naming across code, logs, tests, and status output.

Use one vocabulary for:

- modes
- stages
- states
- readiness facets
- provider names
- platform names

Recommended names:

- modes: `standalone`, `managed`
- platforms: `docker`, `modal`
- providers: `standalone`, `managed`
- health facets: `live`, `ready`, `degraded`, `fatal`

### 7. Provisioning Manifest

Define one canonical manifest describing what the runtime needs before release.

The manifest should describe:

- required files
- optional files
- derived files
- per-mode requirements
- per-file validator expectations
- durable managed inbox files reloaded through explicit commands

The manifest is the contract between providers and the runtime.

### 8. File Layout

Define one canonical runtime-visible path layout.

Every required runtime file should have:

- a canonical path
- one meaning
- one validator
- one owner

This should include:

- runtime env files
- workspace files
- theme source files
- theme derived files
- secrets
- runtime state/status files
- transport config files
- durable task inbox files carrying structured task input envelopes

### 9. Platform Adapter Semantics

Standardize the adapter behavior for:

- create
- exec
- write file
- health exposure
- termination
- status inspection

The adapters may differ in implementation, but not in failure behavior or
contract meaning.

## Required Test Surfaces

The refactor should leave one canonical test surface per contract.

### Runtime Contract Tests

Should cover:

- image boot
- mode selection
- local health/status
- local file visibility
- required services healthy in standalone mode

### Bootstrap Contract Tests

Should cover:

- backend creates runtime
- provisioning manifest arrives
- release condition works
- managed transport connects
- runtime reaches ready/idle

### Full Smoke Tests

Should cover:

- create managed agent
- wait for ready
- send deterministic work
- receive deterministic result

### Local Debug Surfaces

Should exist for developers:

- standalone local boot helper
- local backend to Modal bootstrap helper
- direct sandbox inspection helper

These are developer tools, not substitutes for contract tests.

## Cross-Runtime Acceptance

The refactor is not done unless the same contracts hold on both Docker and
Modal.

That means:

- standalone runtime contract passes on Docker
- standalone runtime contract passes on Modal
- managed bootstrap contract passes on Docker
- managed bootstrap contract passes on Modal
- full smoke passes on the production-target runtime

If one runtime needs bespoke semantics, the abstraction is incomplete.

## Refactor Heuristic

When choosing between preserving current behavior and enforcing the cleaner
contract, prefer the contract.

This refactor is the chance to standardize:

- one mode model
- one lifecycle model
- one status schema
- one file layout
- one provisioning release invariant
- one event taxonomy
- one runtime contract across Docker and Modal

Everything else should be treated as migration scaffolding and removed when it
no longer serves those standards.

## Greenfield Implementation Strategy

If the old agent implementation is moved aside and the new runtime is built
fresh, the preferred build order is:

1. scaffold the structure
2. define the contracts and signatures
3. implement the logic from the bottom up
4. reference the old implementation only when extracting something clearly
   worth keeping

This is preferred over porting old files forward.

### Build Order

#### Phase 1: Skeleton

Create the target module layout first.

Recommended areas:

- `agent/contracts/`
- `agent/runtime/`
- `agent/provisioning/`
- `agent/transports/agentobox/`
- `agent/platform/`
- `agent/tests/`

At this phase:

- no heavy logic
- no old code copied wholesale
- only boundaries and intended public surfaces

#### Phase 2: Contracts First

Define typed contracts before behavior.

These should be established first:

- mode enum
- lifecycle/startup-stage enums
- runtime state model
- health/status schema
- provisioning manifest schema
- provisioning provider interface
- transport interface
- platform adapter interface
- local ingress interface

If these signatures are wrong, implementation drift begins immediately.

#### Phase 3: Core Runtime

Implement the standalone-valid core first.

Suggested order:

1. mode/config loading
2. runtime state object
3. health/status server
4. local service supervision abstraction
5. local ingress
6. local runner loop
7. lifecycle coordinator

Goal:

- standalone boot works
- `/livez`, `/readyz`, `/status` work
- local work can run without backend attachment
- transition policy is owned by one coordinator, not spread across entrypoints

#### Phase 4: Provisioning

Implement provisioning after the core runtime exists.

Suggested order:

1. canonical file tree constants
2. provisioning manifest model
3. validator engine
4. standalone provider
5. managed provider interface

Goal:

- runtime startup depends on manifest validation
- providers are pluggable
- file parity is explicit

#### Phase 5: Managed Transport

Only after standalone runtime is solid.

Suggested order:

1. transport config model
2. auth requirements
3. transport state model
4. WebSocket client
5. managed attach lifecycle

Goal:

- managed mode is additive
- standalone remains clean and valid

#### Phase 6: Platform Adapters

Implement Docker and Modal adapters against the already-stable contracts.

Suggested order:

1. Docker adapter
2. Modal adapter
3. cross-runtime contract tests

This prevents current platform quirks from defining the architecture.

#### Phase 7: Backend Integration

Adapt the backend to the new runtime/provisioning/transport contracts last.

Goal:

- backend becomes a control-plane client of the runtime
- backend does not shape the runtime core

## Suggested Initial Module Set

If scaffolding from scratch, this is a reasonable initial file set.

### Contracts

- `agent/contracts/mode.py`
- `agent/contracts/lifecycle.py`
- `agent/contracts/status.py`
- `agent/contracts/provisioning.py`
- `agent/contracts/transport.py`
- `agent/contracts/platform.py`

### Runtime

- `agent/runtime/config.py`
- `agent/runtime/state.py`
- `agent/runtime/lifecycle.py`
- `agent/runtime/execution.py`
- `agent/runtime/executors/`
- `agent/runtime/health.py`
- `agent/runtime/runner.py`
- `agent/runtime/ingress.py`
- `agent/runtime/app.py`
- `agent/runtime/process.py`
- `agent/runtime/services.py`

### Provisioning

- `agent/provisioning/base.py`
- `agent/provisioning/manifest.py`
- `agent/provisioning/validate.py`
- `agent/provisioning/providers/standalone.py`
- `agent/provisioning/providers/managed.py`

### Managed Transport

- `agent/transports/agentobox/config.py`
- `agent/transports/agentobox/state.py`
- `agent/transports/agentobox/client.py`
- `agent/transports/agentobox/commands.py`
- `agent/transports/agentobox/codec.py`
- `agent/transports/agentobox/upstream.py`

### Platform

- `agent/platform/base.py`
- `agent/platform/docker.py`
- `agent/platform/modal.py`
- `agent/main.py`
- `agent/Dockerfile`

### Tests

- `agent/tests/test_contracts.py`
- `agent/tests/test_status_schema.py`
- `agent/tests/test_manifest.py`

This set is intentionally modest. It establishes the architecture without
creating unnecessary file sprawl on day one.

## Greenfield Rules

When rebuilding from scratch, apply these rules strictly.

1. Do not copy whole modules from the old agent tree.
2. Do not let Docker or Modal quirks define the contracts.
3. Do not make backend connectivity a prerequisite for runtime validity.
4. Do not implement transport before standalone runtime works.
5. Do not rebuild old startup conventions just because they existed.
6. Do not introduce implicit mode inference as the primary contract.
7. Do not allow required startup paths to degrade silently.

## What Not To Build First

The following are explicitly bad starting points for the new runtime:

- recreating legacy s6 wiring first
- porting relay event handling first
- porting old run scripts first
- trying to make Modal pass before the standalone runtime contract exists

These are downstream concerns. The core contracts should come first.

## Acceptance Criteria

The refactor should be considered complete only when all of the following are
true.

### Runtime Validity

- the agent image boots in standalone mode without backend config
- local health/status endpoints are meaningful in standalone mode
- local services needed for standalone operation report healthy

### Managed Validity

- the same image boots in managed mode with explicit managed config
- provisioning release is deterministic
- managed transport connects and authenticates
- the runtime reaches ready/idle without manual intervention

### Parity

- standalone and managed providers populate the same canonical runtime file
  layout
- themes, secrets, workspace files, and runtime state obey the same path
  contract across modes

### Test Structure

- one canonical runtime contract suite exists
- one black-box local HTTP runtime contract test exists
- one canonical bootstrap contract suite exists
- one opt-in black-box Docker-managed contract test exists for the real image
  boundary
- one canonical full smoke suite exists
- local developer helpers exist for reproducing managed-mode failures before CI

### Ownership

- core runtime does not depend on backend code paths for validity
- managed transport is optional in standalone mode and required in managed mode
- control-plane orchestration is not mixed into core runtime boot logic

## Migration Rules

The refactor should not be performed as a compatibility swamp.

Rules:

1. Introduce explicit mode first.
2. Keep inference only as a temporary migration layer.
3. Move one concern at a time to its correct owner.
4. Delete alternate paths once the new owner is in place.
5. Prefer one canonical test per contract, not parallel overlapping suites.
6. Prefer deletion over shims once callers are migrated.

## Non-Goals

These are explicitly not the goal of this refactor:

- replacing the backend control plane
- replacing WebSocket transport with HTTP everywhere
- introducing a large plugin framework
- redesigning team/project semantics
- preserving every current startup convention for compatibility forever

## Anti-Patterns

During the refactor, treat these as smells:

- mode inferred from half-present env
- readiness based on weak filesystem hints
- backend transport required for standalone health
- multiple suites proving the same contract differently
- file paths whose meaning changes by provider
- provider-specific hacks leaking into core runtime logic
- best-effort startup for required managed-mode config
- platform exec failures that only log and continue

## Decision Heuristics

When a design choice is unclear, use these heuristics:

1. Prefer explicit mode over implicit inference.
2. Prefer canonical runtime paths over provider-specific shortcuts.
3. Prefer startup failure over degraded undefined behavior.
4. Prefer one strong contract test over multiple weak overlapping tests.
5. Prefer making the runtime portable over making the backend convenient.
6. Prefer provider adapters over conditionals scattered through runtime code.

## Open Design Questions

These questions are acceptable to leave open temporarily, but they should be
resolved explicitly during the refactor.

1. What is the local work-ingress surface in standalone mode: CLI, local HTTP,
   file queue, or a combination?
2. Which services are required for standalone readiness vs merely optional?
3. Which runtime state should be persisted locally vs only observed remotely?
4. How much startup inference should be tolerated during migration, and when is
   it deleted?
5. What is the minimum canonical manifest that every provisioning provider must
   satisfy?

## Service Supervision Rules

Before rebuilding the image service graph, lock in these supervision rules:

1. Every long-running service has one canonical spec.
2. Every service declares its dependencies explicitly.
3. Service startup order is derived from the dependency graph, not shell order.
4. Service process output is always emitted through the shared structured log contract.
5. Required-for-readiness services are declared explicitly rather than inferred.
6. Platform adapters may decide how services are run, but not what the service graph means.

This is the point of adding `ServiceSpec`, `ManagedProcess`, and a runtime-owned
service graph before touching image/rootfs rebuild work.

## Appendix A: Canonical Status Schema

This is the target shape for `/status`. Field names may evolve slightly during
implementation, but the structure should stay stable.

```json
{
  "status_version": "2",
  "mode": "standalone",
  "platform": "docker",
  "profile": "core",
  "build": {
    "image_ref": "agentobox-agent-runtime:latest",
    "image_digest": "sha256:...",
    "git_commit": "abc1234"
  },
  "startup_stage": "runtime_ready",
  "runtime_state": "ready",
  "runtime": {
    "session_id": "",
    "client_active": false,
    "task_id": "",
    "task_state": "idle"
  },
  "transport": {
    "enabled": false,
    "state": "disabled",
    "connected": false,
    "last_error": ""
  },
  "services": {
    "relay_http": "up",
    "xvfb": "up",
    "x11vnc": "up",
    "websockify": "up"
  },
  "degraded": [],
  "fatal": null
}
```

Rules:

- `status_version` must exist
- `mode`, `platform`, and `profile` must always be present
- `build.image_ref`, `build.image_digest`, and `build.git_commit` expose runtime identity when known
- `transport.enabled=false` is valid and healthy in standalone mode
- `fatal` is `null` or a machine-readable object/string
- `degraded` is always a list

## Appendix B: Provisioning Manifest Shape

This is the target shape for the canonical provisioning manifest.

```json
{
  "manifest_version": "1",
  "mode": "managed",
  "required_files": [
    "home/agent/.relay_env",
    "_abox/state.json"
  ],
  "optional_files": [
    "tmp/abox-theme/tokens.json",
    "_abox/inbox.jsonl"
  ],
  "derived_files": [
    "tmp/abox-theme/theme.json",
    "tmp/abox-theme/theme.css",
    "tmp/abox-theme/userChrome.css",
    "tmp/abox-theme/awesome.lua"
  ],
  "validators": {
    "home/agent/.relay_env": "nonempty_file",
    "_abox/state.json": "valid_json"
  }
}
```

Rules:

- every provisioning provider must satisfy this manifest
- required/optional/derived is mode-aware
- validators operate on canonical runtime-visible paths
- provisioning release is blocked until required validators pass

## Appendix C: Canonical Runtime-Visible File Tree

This is the desired runtime-visible layout contract.

```text
/home/agent/
  .relay_env
  .claude/
    settings.json
  workspace/
    CLAUDE.md
    .mcp.json

/tmp/abox-theme/
  tokens.json
  theme.json
  theme.css
  userChrome.css
  awesome.lua

/mnt/abox-state/
  secrets/
    env

/_abox/
  state.json
  status.json
  inbox.jsonl
  provisioned.ready
```

Rules:

- this layout is the same in standalone and managed mode
- providers differ only in how these files are populated
- the runtime should not need provider-specific path knowledge

## Appendix D: Canonical Test Matrix

This is the target verification matrix.

| Contract | Docker | Modal | Backend required | CI level |
|----------|--------|-------|------------------|----------|
| Runtime contract | Yes | Yes | No | PR-safe / image |
| Bootstrap contract | Yes | Yes | Yes | preview/dev gate |
| Full smoke | Yes | Yes | Yes | deploy gate |

Interpretation:

- runtime contract proves image validity
- bootstrap contract proves provisioning + managed attach
- full smoke proves user-visible end-to-end work
- desktop-profile contracts prove the visual runtime surface without changing the
  file or transport contracts

## Appendix E: Naming Lock-In

These names should be treated as reserved unless there is a strong reason to
change them.

- modes: `standalone`, `managed`
- platforms: `docker`, `modal`
- profiles: `core`, `desktop`
- runtime states: `starting`, `ready`, `busy`, `degraded`, `stopped`, `fatal`
- startup stages:
  - `config_loading`
  - `config_validated`
  - `provisioning_wait`
  - `provisioning_validated`
  - `services_starting`
  - `runtime_ready`
  - `transport_connecting`
  - `managed_ready`
  - `degraded`
  - `fatal`

Changing these names later should require an intentional migration, not casual
drift.

## Delete Rules

Delete or refactor anything that violates the target shape.

Examples:

- startup behavior inferred from half-present env
- transport required for standalone validity
- readiness meaning "backend connected" in standalone mode
- release conditions based on weak filesystem hints
- duplicate bootstrap suites testing the same contract differently
- control-plane semantics embedded inside core runtime boot logic

## Build Rules

Only add code that clearly fits one layer.

Before adding a new behavior, answer:

1. Is this runtime, provisioning, transport, or control plane?
2. Is it required in standalone, managed, or both?
3. Is this the single owner of the concern?
4. Does its health/readiness meaning match the selected mode?

If the answer is unclear, the design is unclear.

## Comparison Rubric

When comparing current code to the target shape, use this rubric for every
component:

| Question | Expected answer |
|----------|-----------------|
| What layer owns this? | Exactly one layer |
| Is it standalone, managed, or both? | Explicit |
| What mode-specific config does it require? | Explicit |
| What makes it healthy? | Explicit and mode-aware |
| What releases startup? | One explicit invariant |
| Who is source of truth? | One owner |

Components that cannot answer these questions cleanly should be deleted,
split, or rewritten.

## Refactor End State

The refactor is done when the system can be described simply:

1. `agentobox-agent` is a reusable standalone agent runtime.
2. `agentobox-agent` can run in managed mode by attaching an Agentobox
   transport plugin.
3. `agentobox-backend` is a control plane that provisions and coordinates
   agents, not a prerequisite for their existence.
4. The tests map one-to-one to runtime, bootstrap, control-plane, and full
   smoke contracts.

That is the target shape.
