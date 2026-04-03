# GDA Axioms

This document captures the first principles that should constrain the design of
Agentobox's goal-driven autonomy surface.

These are not implementation guesses.
They are the grounding statements we expect the system to preserve even as the
implementation evolves.

## Purpose

Use these axioms to:

- evaluate design options
- detect abstraction drift
- decide what must be mechanical vs fuzzy
- decide what belongs in the generic GDA layer vs a world-specific extension

If an implementation convenience conflicts with an axiom, the convenience should
lose.

## Axioms

### 1. Fuzzy Compute May Propose; Mechanical Compute Must Decide

Agents and models are allowed to:

- interpret
- infer
- rank
- propose
- decompose

They are not allowed to directly author canonical truth.

Deterministic seams must:

- validate
- admit
- persist
- authorize
- reconcile
- close lifecycle transitions

Implication:
- raw model output must cross a deterministic contract boundary before it can
  affect canonical state

### 2. Canonical Truth Must Be Mechanically Writable

If something is part of canonical project truth, there must be a deterministic
writer responsible for it.

Implication:
- project state, observations, commitments, executions, evaluations, and later
  case records must be owned by backend authority-bearing services, not by agent
  convention

### 3. State Used For Authority Must Be Predicate-Testable

Any state used for:

- evaluation
- authorization
- lifecycle closure
- progress/satisfaction

must be representable in a mechanically testable form.

Implication:
- authoritative state cannot exist only as prose or agent narrative
- at least the authority-bearing subset of state must support predicates,
  comparisons, or typed checks

### 4. Progress Cannot Depend On Prose Alone

If the system claims progress, satisfaction, completion, or failure, there must
be a mechanical basis for that claim.

Implication:
- agents may summarize progress
- but canonical progress/satisfaction must be derivable from state, history,
  evaluation, or explicit deterministic rules

### 5. Uncertainty Must Be Representable

The state model must support:

- incomplete knowledge
- conflicting evidence
- stale evidence
- derived claims vs direct observations

Implication:
- the system must not force premature certainty just because storage or UI
  prefers a single clean value

### 6. Provenance Must Survive Reduction

When observations are reduced into canonical state, the system must retain a
traceable path back to the evidence that justified the reduced result.

Implication:
- state reduction cannot destroy causal traceability
- casebase and debugging depend on this

### 7. Capabilities Must Be Mechanically Bounded

No execution should occur without an explicitly bounded action surface.

A capability is not just a label. It implies:

- allowed action class
- scope
- expected arguments
- expected effects
- policy/boundary compatibility

Implication:
- agents may propose capabilities or commitments
- only mechanical authorization may activate them

### 8. Current State And History Are Different Objects

The observation journal and execution journal are not the same thing as reduced
current state.

Implication:
- raw history is evidence
- reduced state is current canonical truth
- the system needs both

### 9. The Generic GDA Layer Must Stay Small

The generic layer should only contain concepts that survive across many project
types.

Likely generic nouns:

- state
- observation
- goal
- objective
- boundary
- capability
- commitment

Implication:
- world-specific semantics should live in explicit extension points, reducers,
  evaluators, or project/world packages

### 10. Agents Need A Stable Canonical Context

The fuzzy side should reason over a stable, canonical policy context rather
than incidental backend implementation details.

Implication:
- agents should not depend on random ORM shapes, transport quirks, or ad hoc
  prompt formatting
- the policy context should be a deliberate seam

### 11. MCP Is A Projection, Not A Source Of Truth

The MCP layer is an agent-facing interface to canonical backend records and
services.

Implication:
- MCP must not become a second control plane
- backend services remain authority
- MCP tools/resources are just agent-facing access paths over those services

### 12. Casebase Must Be Derived From Canonical Records

The casebase should be built from canonical run history, not from hand-written
summaries or prompt memory.

Implication:
- problem, solution, and outcome records should derive from project state,
  observations, commitments, executions, artifacts, and evaluations

## Design Test

When evaluating a design decision, ask:

1. which axiom does this depend on?
2. which axiom could this violate?
3. does this move a fuzzy responsibility into a mechanical seam, or vice versa?
4. does this enlarge the generic layer without proving the abstraction survives?
5. if this became canonical truth, who would mechanically own writing it?

## Axiom Groups By Hard Problem

The axioms above are intentionally general.
This section regroups them around the hard design areas we already know we need
to solve.

The goal is to make each problem area answerable against explicit constraints.

### State Reduction

Relevant axioms:

- canonical truth must be mechanically writable
- state used for authority must be predicate-testable
- uncertainty must be representable
- provenance must survive reduction
- current state and history are different objects

Additional grounding statements:

- reduced state is not raw history
- reduction must preserve traceability from state back to evidence
- reduction must support coexistence of direct facts, derived facts, and
  unresolved conflicts
- the authority-bearing subset of state must be machine-testable even if other
  parts remain richer or more descriptive

### Goal And Objective Progress

Relevant axioms:

- state used for authority must be predicate-testable
- progress cannot depend on prose alone
- uncertainty must be representable
- the generic GDA layer must stay small

Additional grounding statements:

- goal satisfaction must be mechanically derivable from state, history, or
  explicit evaluation rules
- progress must distinguish `true`, `false`, and `unknown`
- objective completion is not the same thing as agent confidence
- a progress projection may summarize, but canonical progress must be grounded
  in deterministic evaluation

### Observation Taxonomy And Admission

Relevant axioms:

- fuzzy compute may propose; mechanical compute must decide
- canonical truth must be mechanically writable
- uncertainty must be representable
- the generic GDA layer must stay small

Additional grounding statements:

- agents may propose observations; admission decides whether they become
  canonical
- the system must preserve the distinction between direct and derived
  observations
- observation kinds must be extensible without turning into arbitrary string
  sprawl
- provenance and freshness may need kind-specific strictness

### Commitment Authorization

Relevant axioms:

- fuzzy compute may propose; mechanical compute must decide
- canonical truth must be mechanically writable
- capabilities must be mechanically bounded

Additional grounding statements:

- commitment proposals are not the same thing as active commitments
- authorization must check more than capability name membership as the system
  matures
- activation is a deterministic authority transition
- a malformed proposal, an unauthorized proposal, and a low-quality proposal
  are different cases and should not collapse into one vague failure

### Capability Surface

Relevant axioms:

- capabilities must be mechanically bounded
- the generic GDA layer must stay small
- fuzzy compute may propose; mechanical compute must decide

Additional grounding statements:

- a capability should mean more than a string label
- capability contracts should eventually constrain arguments, scope, expected
  effects, and policy compatibility
- agents may suggest capability extensions; only deterministic seams may admit
  them
- world-specific capabilities should not leak new core ontology into the
  generic layer

### Policy Context For Agents

Relevant axioms:

- agents need a stable canonical context
- current state and history are different objects
- uncertainty must be representable
- MCP is a projection, not a source of truth

Additional grounding statements:

- the agent should reason over a deliberate policy context, not incidental ORM
  or transport shapes
- policy context should expose canonical truth plus the minimum necessary recent
  evidence
- the context seam should remain stable even if storage or transport internals
  change

### Lifecycle Closure And Result Codes

Relevant axioms:

- fuzzy compute may propose; mechanical compute must decide
- canonical truth must be mechanically writable
- progress cannot depend on prose alone

Additional grounding statements:

- lifecycle closure must be machine-readable
- terminal status and terminal reason are separate concepts
- execution failure, policy failure, missing evidence, and satisfied completion
  should remain distinguishable
- closure reasons should support downstream UI, debugging, analytics, and
  casebase derivation

### MCP Agent Interface

Relevant axioms:

- MCP is a projection, not a source of truth
- fuzzy compute may propose; mechanical compute must decide
- canonical truth must be mechanically writable

Additional grounding statements:

- MCP should expose canonical services to agents, not invent a parallel control
  plane
- agent-facing resources should be read projections over canonical state
- agent-facing tools should map to proposal or reporting seams, not directly to
  arbitrary state mutation
- authenticated agent identity should mechanically determine canonical
  attribution where relevant

### Casebase Derivation

Relevant axioms:

- provenance must survive reduction
- current state and history are different objects
- casebase must be derived from canonical records

Additional grounding statements:

- case records should derive from canonical problem, solution, and outcome
  traces
- casebase value depends on preserving causal structure, not just storing logs
- retrieval should be grounded in authoritative records even if semantic search
  layers are added later

### Generic vs World-Specific Boundaries

Relevant axioms:

- the generic GDA layer must stay small
- capabilities must be mechanically bounded
- agents need a stable canonical context

Additional grounding statements:

- if a concept does not survive across project types, it should not become a
  core noun
- world-specific behavior should enter through explicit reducers, evaluators,
  taxonomies, and capability catalogs
- extension points should be explicit enough that adjacent growth does not bend
  the core contracts
