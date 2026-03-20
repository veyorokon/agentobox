# Machine Migration Plan

This document turns the [Machine Contract](./machine.md) into an execution
program.

It is intentionally organized by contract layer, not by runtime. Docker and
Modal must remain implementations of the same contract, not separate
architectures.

## Goal

Refactor Agentobox so that:

- mutable agent runtime truth lives on the agent machine filesystem
- backend owns desired state and projections, not live runtime truth
- Docker and Modal share one machine-state contract
- transport is acceleration, not authority

## Program Structure

The work should be executed as a small coordinated program, not as a pile of
unrelated tickets.

## Critical Path

### 1. Contract and Filesystem Canon

Owner:

- systems architect

Deliverables:

- final machine contract
- canonical directory layout
- explicit ownership table for:
  - `_abox/*`
  - `run/*`
  - `mnt/*`
  - `home/*`
- explicit `ProjectVolumeStore` interface

Write scope:

- `docs/contracts/*`
- shared schemas/interfaces if needed

Why first:

- this defines the source of truth and blocks all downstream implementation

### 2. Volume Abstraction

Owner:

- platform/runtime engineer

Deliverables:

- `ProjectVolumeStore`
- `LocalProjectVolumeStore`
- `ModalProjectVolumeStore`
- typed agent-machine path helpers

Write scope:

- backend volume services
- runtime adapter seams

Why second:

- this is the storage contract every other layer must sit on top of

### 3. Runtime Desired/Status/Facts Protocol

Owner:

- distributed systems engineer

Deliverables:

- backend-owned `desired`
- agent-owned `status`
- optional agent-owned `facts`
- one explicit projection/update path

Write scope:

- agent managed session / transport protocol
- backend relay consumer
- backend read-model ingestion path

Why third:

- this replaces the current ambiguous multi-truth state model

## Parallel Lanes

### 4. Preview and UI Read Model Cleanup

Owner:

- product-minded backend/frontend engineer

Deliverables:

- preview derives only from canonical machine status
- no frontend guessing
- no stale fallback logic based on unrelated state

Write scope:

- serializers
- GraphQL types/resolvers
- dashboard hooks/components/tests

### 5. Secrets and MCP Remap

Owner:

- platform engineer

Deliverables:

- canonical secret paths under the machine surface
- MCP gateway/config aligned to the new volume contract
- explicit ownership and permission model preserved

Write scope:

- provisioning
- secret materialization
- MCP config writers

### 6. Runtime Mount Model

Owner:

- runtime engineer

Deliverables:

- Docker mount/symlink model matches the new machine layout
- Modal mount model matches the same layout
- bootstrap/init behavior is runtime-agnostic above the adapter seam

Write scope:

- agent bootstrap/init-volume
- Docker runtime
- Modal runtime

### 7. Migration and Cutover

Owner:

- DevOps / release engineer

Deliverables:

- staged migration sequence
- compatibility bridge
- rollout guardrails
- fallback strategy

Write scope:

- deploy/runtime migration code
- operational docs
- CI/CD rollout steps

### 8. Test Taxonomy and Regression Expansion

Owner:

- reliability engineer

Deliverables:

- contract tests for the volume store
- local integration tests for desired/status flow
- Modal smoke for runtime parity
- migration safety tests

Write scope:

- backend tests
- agent tests
- smoke tests
- CI workflows

## Recommended Subagent Split

Start with four workers max, with disjoint write scopes.

### Worker A: Contracts

Owns:

- docs
- ownership tables
- implementation checklist

Does not own:

- runtime or backend code

### Worker B: Volume Store

Owns:

- `ProjectVolumeStore`
- path APIs
- backend volume access layer

### Worker C: Runtime Protocol

Owns:

- `desired/status/facts` flow
- relay protocol changes
- backend ingestion of runtime status

### Worker D: UI and Projection

Owns:

- serializer and GraphQL read models
- dashboard preview/read-model consumers

After that first wave:

- Worker E: Secrets and MCP
- Worker F: Migration and Tests

## Why This Split

This split follows ownership boundaries:

- A defines truth
- B defines storage access
- C defines control-plane/runtime state flow
- D consumes the resulting model

That avoids merge conflicts and prevents reproducing the old architecture by
accident.

## Anti-Pattern to Avoid

Do not split the work by runtime:

- one worker for Docker
- one worker for Modal

That would recreate the same architectural drift we are trying to remove.

Split by contract layer, then implement Docker and Modal under the same
abstraction.

## Definition of Done Per Lane

Each lane must ship:

- code
- contract doc updates
- focused tests
- migration notes if persisted behavior changes

No lane is complete if it only changes code without updating the corresponding
contract and regression coverage.

## Cleanup Audit

Cleanup is part of the migration program, not a follow-up chore.

Every lane that replaces an old path must also:

- remove the superseded code path in the same wave or in the immediately
  following wave
- document the removal in the migration notes
- add or update an invariant/regression test that prevents the old path from
  silently returning

The program-level cleanup audit should explicitly track:

- obsolete Modal-specific volume sync helpers
- any remaining backend reads that assume local host-path visibility of agent
  machine state
- duplicate runtime truth sources between:
  - machine filesystem
  - relay transport messages
  - DB projections
- UI fallback logic that re-invents preview/runtime truth instead of consuming
  the canonical backend projection

The migration is not complete until:

- the new source of truth is live
- old compatibility code is removed
- a repo-wide grep audit shows no residual references to the deprecated path
- focused tests cover the replacement seam

## Recommended Execution Order

1. finalize machine contract
2. implement volume abstraction
3. implement desired/status/facts flow
4. switch preview/backend reads to the new model
5. migrate secrets/MCP
6. cut over Docker and Modal
7. remove old sync paths
8. expand smoke and regression coverage

## Initial Delegation Package

If parallel work starts immediately, begin with:

### Subagent 1

- finalize machine contract into an implementation checklist

### Subagent 2

- design `ProjectVolumeStore` API and file/path types

### Subagent 3

- trace the current `desired/status` flows and propose exact replacement seams

### Subagent 4

- trace all preview/read-model dependencies on old volume/runtime assumptions

This gives the main implementation wave a concrete map before heavy edits begin.

## Practical Principle

When choices are ambiguous, prefer the option that:

- minimizes competing sources of truth
- preserves boring operations
- makes Docker and Modal variants of one contract
- keeps migration incremental
- avoids runtime-specific hacks leaking upward
