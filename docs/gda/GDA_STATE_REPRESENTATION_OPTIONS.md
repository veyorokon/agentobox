# GDA State Representation Options

This document captures the current state-representation options considered for
Agentobox's goal-driven autonomy layer, the current recommended direction, and
the proof still missing.

It is not meant to be the final design spec.
It is meant to record the option space clearly enough that the next steps do
not drift back into implicit debate.

## Problem

We need a generalized project world model that can:

- preserve canonical history
- support deterministic authority-bearing computation
- allow fuzzy discovery of new meaningful dimensions
- avoid premature overformalization
- remain useful across many project types

## Option 1: Flat Canonical Facts Plus Rule Reducers

Shape:

- append-only observations and executions
- one canonical reduced `facts` map
- deterministic reducers update the map directly
- progress and status are computed from those facts

Strengths:

- simplest implementation
- easy to test and ship
- good for narrow domains

Weaknesses:

- tends to become ad hoc key sprawl
- weak support for uncertainty
- weak support for emergent new dimensions
- easy to overfit to early domains

Best use:

- narrow v0 slices
- temporary proving ground for one domain

## Option 2: Logic-First / Symbolic System

Shape:

- observations become predicates
- rules derive new predicates or facts
- authorization and evaluation run over a symbolic rule layer

Strengths:

- explicit
- inspectable
- deterministic
- elegant for the mechanical subset

Weaknesses:

- too rigid for messy dynamic domains if used as the whole system
- naming new dimensions becomes awkward
- easy to overformalize before the ontology is stable
- fuzzy interpretation still has to live somewhere outside the logic layer

Best use:

- as a lens for the mechanical subset
- for rule evaluation, authorization, and deterministic status computation

## Option 3: Append-Only History Plus Assessments / Beliefs Plus Reduced Authority State

Shape:

- canonical append-only history:
  - observations
  - executions
  - commitments
  - artifacts
- fuzzy side proposes:
  - derived observations
  - assessments
  - belief-like dimensions
- mechanical side:
  - admits history
  - reduces a small authority-bearing subset into current state
  - computes status and progress from that subset
- new meaning starts as a derived observation or assessment
- recurring useful meaning gets promoted into stable typed reduced state

Strengths:

- preserves provenance and history
- supports dynamic emergent abstractions
- supports uncertainty without overclaiming
- keeps authority-bearing state small and computable
- works well with casebase learning
- supports both discrete facts and continuous belief-like dimensions

Weaknesses:

- more moving parts than a flat fact map
- requires disciplined promotion from assessment to stable state dimension
- reducer design still needs care

Best use:

- generalized project world models
- domains where important abstractions emerge over time
- systems that need both fuzzy discovery and deterministic authority

## Current Recommended Direction

The recommended direction is **Option 3**.

More specifically:

- append-only canonical history
- typed derived assessments or belief-like dimensions
- a small reduced authority-bearing state
- explicit desired / observed / status split where useful
- deterministic admission, authorization, reconciliation, and closure
- a promotion pipeline from fuzzy meaning into stable typed dimensions only when
  justified

This is currently the best balance of:

- flexibility
- mechanical rigor
- extensibility
- casebase compatibility

## Revised General State Envelope

The first candidate envelope was too thin and too domain-shaped:

- `key`
- `value`
- `value_type`
- `epistemic_status`
- `effective_at`
- `expires_at`
- `provenance_refs`

It does not survive stress testing cleanly because:

- `value_type` is too coarse for intervals, distributions, structured estimates,
  sets, references, and other non-scalar values
- `epistemic_status` mixes multiple concerns:
  - how the dimension was produced
  - how trustworthy or settled it is
  - whether it is stale, conflicted, or expired
- `key` is too implementation-ish for a long-lived GDA seam

The better general envelope is:

- `dimension_ref`
- `content`
- `schema_ref`
- `origin`
- `valid_from`
- `valid_until`
- `provenance_refs`

Meaning:

- `dimension_ref`
  - opaque identifier for the state dimension
  - domain/world packages own the meaning
  - the generic layer must not interpret it
- `content`
  - the current value payload for that dimension
  - may be scalar or structured
- `schema_ref`
  - opaque reference to the value/schema contract for `content`
  - the generic layer validates shape through the schema contract, not through
    hardcoded domain fields
- `origin`
  - how this state entry was produced, for example:
    - `observed`
    - `derived`
    - `estimated`
    - `declared`
- `valid_from`
  - when this state entry became effective
- `valid_until`
  - when this state entry is no longer valid if time-bounded
- `provenance_refs`
  - links back to the observations, executions, artifacts, or evaluations that
    justify the entry

This keeps the seam opaque:

- the framework owns lifecycle, typing hooks, provenance, and deterministic
  application
- world/domain packages own dimension names, schemas, and reduction semantics

## Stress Test

The envelope needs to survive very different project types without pulling
domain meaning into the generic core.

### Software Delivery Project

Examples:

- `dimension_ref = "release.current_candidate"`
- `content = {"manifest_ref": "..."}`
- `schema_ref = "ref.manifest.v1"`
- `origin = "declared"`

- `dimension_ref = "runtime.health"`
- `content = {"status": "ready"}`
- `schema_ref = "status.readiness.v1"`
- `origin = "observed"`

Result:
- survives
- `schema_ref` is necessary because simple `value_type` would be too weak

### Trading Project

Examples:

- `dimension_ref = "market.factor.btc_beta"`
- `content = {"point_estimate": 1.8, "window": "30d"}`
- `schema_ref = "estimate.scalar_windowed.v1"`
- `origin = "estimated"`

- `dimension_ref = "trade.thesis.cluster_assignment"`
- `content = {"cluster_id": "miners_convert_ceiling"}`
- `schema_ref = "label.cluster_assignment.v1"`
- `origin = "derived"`

Result:
- survives
- structured `content` is necessary
- `origin` is more useful than overloaded `epistemic_status`

### Research / Investigation Project

Examples:

- `dimension_ref = "research.question.blocker_status"`
- `content = {"status": "needs_measurement"}`
- `schema_ref = "status.blocker.v1"`
- `origin = "derived"`

- `dimension_ref = "research.signal.replication_strength"`
- `content = {"score": 0.62, "sample_size": 4}`
- `schema_ref = "estimate.score_sample.v1"`
- `origin = "estimated"`

Result:
- survives
- time validity and provenance still matter

## Implications

The generic GDA layer should define only:

- the append-only history records
- the state-entry envelope
- the reducer interface
- the state-delta / mutation contract
- the deterministic application path

The generic GDA layer should not define:

- concrete dimension names
- concrete domain schemas
- concrete reducer rules
- concrete promotion rules

Those belong in explicit world/domain extensions.

## Why This Is Preferred

It lets the system do all of these at once:

- keep canonical history explicit
- avoid forcing every new abstraction into a premature core ontology
- support fuzzy proposal of new meaning
- support deterministic computation where authority matters
- avoid pretending that all useful state is discrete

It also matches the strongest analogues we found:

- event sourcing / CQRS
- git / content-addressed history
- Kubernetes desired / observed / status
- ledgers

## What This Does Not Mean

It does **not** mean:

- every possible world concept becomes canonical state
- every user message becomes a canonical observation
- every assessment becomes a durable reduced fact
- the whole system becomes Bayesian, symbolic, or theorem-prover driven

It means:

- new meaning begins in history and assessment
- only recurring authority-relevant meaning gets promoted into stable reduced
  state

## Missing Proof

This direction is favored, but not fully proven yet.

What still needs proof:

1. a small reducer over real project data
2. one narrow belief/assessment representation that feels useful in practice
3. one promotion path from derived assessment to stable typed state dimension
4. one mechanically computed status/progress slice over that reduced state
5. one casebase slice showing the history/state split is genuinely useful

## Next Practical Implementation Direction

The next move should be:

1. keep canonical history as-is
2. add one narrow reducer for one domain slice
3. support one typed assessment/belief dimension
4. compute one status/progress output mechanically
5. learn from real use before enlarging the ontology
