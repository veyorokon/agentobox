# AGENTS.md

This file describes how agents should reason, collaborate, and execute in this repo.

It is intentionally generic. The goal is not to encode local implementation trivia, but to preserve the working style that leads to clean systems and boring operations.

## Core Posture

- Optimize for explicit contracts over convenience.
- Prefer one canonical source of truth per concern.
- Treat projections and caches as disposable read models, not authority.
- Preserve boring operations over cleverness.
- Minimize abstraction bleed.
- Remove duplicate overlapping code paths once the replacement is proven.
- Fail loudly when contracts are violated.

## Key Concepts

### Seams

A seam is the boundary where one subsystem hands responsibility to another.

Examples:
- runtime ↔ control plane
- backend ↔ storage
- image ↔ mutable machine state
- app logic ↔ platform adapter
- contract test ↔ smoke test

Good engineering starts by locating the seam first.

Questions:
- Where does responsibility change hands?
- What is the canonical input/output at this boundary?
- Which side owns truth?
- What behavior is contractually required vs incidental?

### Seamless

“Seamless” does not mean “no seams.”

It means:
- seams are explicit
- ownership is obvious
- the handoff is reliable
- each side can evolve without hidden coupling

The goal is not to erase seams. The goal is to make them clean.

### Abstraction Bleed

Abstraction bleed is when implementation details leak across a boundary and start shaping code that should not know about them.

Examples:
- app-layer code depending on host-path details
- UI inferring runtime truth from stale local heuristics
- transport details becoming hidden state authority
- platform-specific hacks leaking into shared business logic

When abstraction bleed appears:
1. identify the seam
2. restate the contract
3. move the leaking behavior behind the correct boundary
4. delete the old path once the new one is proven

### Ambiguity

Ambiguity is one of the main failure generators in complex systems.

Common forms:
- two sources of truth
- unclear ownership
- unclear lifecycle transitions
- one name used for multiple concepts
- one concept described by multiple names

Ambiguity should be treated as a bug, not as a style issue.

### Canonical vs Derived

Every important system concept should be classified as either:

- canonical
  - the authoritative source of truth
- derived
  - a projection, cache, summary, or convenience view

Confusion between these two causes a large share of state bugs.

Rule:
- if canonical and derived disagree, canonical wins

### Evidence Hierarchy

Not all evidence is equal.

Prefer, in roughly this order:
- direct runtime observation
- concrete logs/events/status payloads
- black-box test results
- integration symptoms
- code inspection
- intuition

Intuition is useful for generating hypotheses. It is not the final authority.

### Duplicate Overlapping Code Paths

Duplicate paths are especially dangerous when they both “mostly work.”

They create:
- inconsistent behavior
- platform parity gaps
- stale fallback logic
- debugging confusion

Preferred pattern:
1. introduce the new canonical path
2. prove it with focused tests
3. switch callers over
4. remove the old path
5. add an invariant/regression so it cannot reappear

## Levels of Abstraction

“Level of abstraction” is a continuous scale. Agents should consciously choose the right level for the task at hand.

### High-level

Useful for:
- architecture
- ownership boundaries
- source-of-truth decisions
- sequencing work across agents
- defining migration strategy

Typical questions:
- What system are we actually building?
- What are the canonical objects?
- Which layer should own this behavior?
- What is the cleanest program shape?

### Mid-level

Useful for:
- designing APIs
- naming boundaries
- choosing test levels
- decomposing implementation work

Typical questions:
- What interface should callers use?
- Which tests prove this seam?
- What behavior belongs in the adapter vs the shared path?

### Low-level

Useful for:
- code changes
- log inspection
- payload analysis
- exact failure reproduction

Typical questions:
- What file changed?
- What frame arrived first?
- What env var is missing?
- What exact process failed?

Agents should move up and down this scale deliberately. Do not stay too low too early. Do not stay too high once the seam is clear.

## Execution Model

### The Default Loop

1. Observe reality.
2. Identify the seam.
3. State the contract.
4. Compare observed behavior to the contract.
5. Find the smallest honest fix.
6. Validate it.
7. Add regression coverage.
8. Remove obsolete paths.

This is the normal path for both debugging and refactoring.

### Fix, Describe, Regress

The preferred sequence is:

1. fix the issue
2. describe the issue and the contract clearly
3. add the regression that would have caught it

Do not stop at “it works now.”
The system should become more legible after each failure.

### Discovery Mode vs Codification Mode

Two different modes are often required:

- discovery mode
  - inspect reality
  - patch manually if needed
  - isolate the real cause
- codification mode
  - express the fix in code
  - add tests
  - remove ambiguity

Do not confuse them.

Discovery mode is how you learn the right answer.
Codification mode is how you make the system keep the answer.

## Empirical Development

Use reality as the primary guide.

Sources of reality:
- logs
- HTTP responses
- websocket frames
- process lists
- runtime status files
- screenshots
- browser automation
- shell inspection inside the actual runtime

### Empirical Debugging Loop

1. inspect the real system
2. determine what is actually true
3. identify blind spots in the instrumentation
4. improve visibility if needed
5. test the smallest plausible fix
6. confirm the result in the real environment
7. formalize the fix in code

This matters most for remote or platform-specific systems where local reproduction is incomplete.

### Remote-First Debugging

When the bug is environment-specific, it is acceptable and often correct to:
- inspect the live remote container
- patch the environment manually to discover the fix
- verify behavior empirically
- then codify the fix in the image/runtime

Important:
- live patching is for discovery, not the final solution
- the final solution must be expressed in code, tests, and deployment artifacts

### Reversible vs Irreversible Changes

Agents should know whether a step is easy to undo.

- reversible
  - local instrumentation
  - temporary guards
  - extra logs
  - additive tests
- harder to reverse
  - schema changes
  - artifact format changes
  - deleting compatibility paths
  - changing ownership boundaries

Use that awareness to sequence work safely:
- learn with reversible steps
- codify only after the seam is clear

## Testing Canon

Keep test types explicit.

- `unit`
  - pure logic
- `invariant`
  - architecture/contract assertions
- `contract`
  - black-box boundary tests for one subsystem or adapter
- `integration`
  - multiple real components wired together
- `smoke`
  - minimal end-to-end proof of critical path
- `security`
  - secrets, dependencies, config/policy scanning

### Test Placement Principle

Catch failures at the earliest honest level.

Examples:
- protocol/order bug -> contract test
- platform boot bug -> platform contract test
- deploy/auth/integration bug -> smoke/bootstrap test

Do not force lower-level tests to prove things they cannot honestly observe.

### Regression Ladder

When a real failure is found, ask:

1. what is the earliest honest level that could have caught this?
2. what higher-level test should still keep proving the full path?

Usually the answer is:
- add one earlier regression
- keep one later end-to-end proof

## Runtime and Platform Principles

- Keep shared application logic runtime-agnostic.
- Treat Docker, Modal, local, etc. as adapter implementations of one contract.
- Keep platform-specific behavior behind explicit interfaces.
- Do not let platform hacks leak into shared business logic.

If a bug only reproduces on one platform:
- first prove whether the contract differs
- then decide whether the fix belongs in:
  - shared logic
  - runtime adapter
  - image/runtime packaging
  - deployment/config

## State Principles

- Prefer one canonical writable state model.
- Separate desired state from observed state.
- Prefer durable machine/runtime state over transient side channels.
- If a database or API mirrors runtime state, make that a projection, not authority.

Questions:
- Where does truth live?
- Who owns writing it?
- Who is allowed to project or cache it?
- What happens when transport disappears?

## Naming Principles

Names should reduce ambiguity.

Good names:
- indicate ownership
- indicate level of abstraction
- distinguish canonical state from projections
- distinguish runtime concepts from UI concepts

When naming drifts:
- consolidate toward the canonical noun
- leave compatibility shims temporarily
- remove the old vocabulary after migration

## Cleanup Audit

Cleanup is not optional.

Every meaningful refactor should include:
- old-path identification
- migration of call sites
- deletion of obsolete code
- regression coverage preventing reintroduction

A refactor is not complete if the old path still quietly exists.

## What “Done” Means

Work is done when:
- the fix is in code
- the correct test level exists
- the old ambiguous path is removed or explicitly deprecated
- the system is more legible than before
- future failures at the same seam should be faster to diagnose

## Heuristics Worth Keeping

- Prefer boring systems.
- Prefer one honest code path.
- Prefer explicit ownership tables.
- Prefer platform adapters over branching shared logic.
- Prefer runtime truth over guessed truth.
- Prefer proving over assuming.
- Prefer deleting over layering once the replacement is real.

## Questions Agents Should Regularly Ask

- What seam is actually failing?
- What level of abstraction am I operating at right now?
- Is this the right level?
- What is canonical here?
- What is only a projection?
- What am I assuming that I could verify?
- Is there a duplicate path still in play?
- Would a regression at a lower or higher test level be more honest?
- Am I fixing the system, or only treating the symptom?
