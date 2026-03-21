# AGENTS.md

This file describes how agents should reason, collaborate, and execute in this repo.

It is intentionally generic. The goal is not to encode local implementation trivia, but to preserve the working style that leads to clean systems and boring operations.

## Core Posture

- Understand before changing.
- Simplify.
- Measure, don't assume.
- Look at the actual data.
- Fix the source, not the sink.
- Signal completion, don't infer it.
- Test the contract, not just the code.
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

### Threads

A thread is a coherent line of work across one or more seams.

Examples:
- fix a runtime bootstrap failure
- unify live mutable writes behind one canonical writer
- tighten CI diagnosis artifacts
- improve browser/theme presentation without changing runtime truth

Threads are not the same as components, files, or tickets.

A good thread:
- has one main question or failure mode
- names the seams it crosses
- has a clear stopping condition
- can be tested at the earliest honest level

Questions:
- What thread are we actually working right now?
- Which seams does this thread cross?
- Is this still one thread, or did it split into two?
- What evidence would close this thread honestly?

### Threads And Seams

Seams and threads are complementary:

- seams describe system boundaries
- threads describe work boundaries

Use seams to understand the system.
Use threads to organize the work.

Preferred pattern:
1. identify the thread
2. locate the failing seam inside it
3. fix the seam
4. close the thread only when the end-to-end question is resolved

When a thread starts crossing too many unrelated seams, split it.
When two threads are really symptoms of one broken seam, merge them.

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

### One Code Path

Ship the code you test and test the code you ship.

Avoid parallel execution paths that create different behavior between:
- local and production
- Docker and remote runtimes
- mock and real integrations
- fallback and primary paths

Multiple paths are acceptable only when they are explicit adapter boundaries with shared contracts.

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

### Proof Levels

Not all proof is equal.

When saying something is “fixed” or “working,” be explicit about the proof level.

Common proof levels:
- unit proof
- invariant proof
- contract proof
- local integration proof
- local deployed-equivalent proof
- real remote proof

Stronger proof is not always required, but the claimed confidence should match
the proof level that actually exists.

Questions:
- What proof level do we have right now?
- What proof level is required to close this thread honestly?
- Are we claiming remote confidence based only on local proof?

### Diagnosis-First Failures

Failures should identify the broken seam, not just emit raw symptoms.

A good failure tells you:
- what contract was being tested
- what seam failed
- what first broke
- what evidence supports that conclusion
- what the next debugging target is

Logs are evidence.
They are not a diagnosis format by themselves.

Preferred pattern:
1. emit a compact diagnosis artifact
2. surface the key fields in summaries/output
3. keep raw logs as secondary evidence

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

### Trace The Actual Chain

Before theorizing, trace the real path end to end.

Examples:
- user action -> API -> queue -> worker -> storage -> UI
- deploy -> provision -> bootstrap -> transport connect -> ready
- write -> projection -> read model -> rendered state

When possible, identify the first point where reality diverges from the expected chain.

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

### Incidents vs Refactors

Treat active breakage and structural cleanup differently.

- incident
  - the system is red now
  - user-visible or deployment-visible failure exists
  - priority is reproduction, isolation, diagnosis, fix, regression

- refactor
  - the system is stable enough
  - priority is cleanup, simplification, deletion, and stronger contracts

When a thread becomes an incident:
1. stop broad cleanup
2. reproduce the failure at the right proof level
3. fix the failing seam
4. add the regression
5. resume refactor work after stability returns

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

### Deployed-Equivalent Local Reproduction

Local reproduction should match the failing environment as closely as the seam requires.

Examples:
- localhost backend + Modal runtime
- local test runner against `dev` GraphQL
- exact smoke/bootstrap command run from this machine before push

This is often the right bridge between:
- pure local tests
- slow CI/CD confirmation

Preferred pattern:
1. run the exact failing test locally first
2. point it at the honest environment for the seam
3. debug there
4. use CI/CD to confirm, not to discover

This matters most for remote or platform-specific systems where local reproduction is incomplete.

### Look At The Actual Data

When modeling or debugging a system, inspect the concrete artifacts first:
- files
- payloads
- logs
- traces
- screenshots
- process state

Do not design from imagined shapes when the real shape is available.

### Remote-First Debugging

When the bug is environment-specific, it is acceptable and often correct to:
- inspect the live remote container
- patch the environment manually to discover the fix
- verify behavior empirically
- then codify the fix in the image/runtime

Important:
- live patching is for discovery, not the final solution
- the final solution must be expressed in code, tests, and deployment artifacts

### CI Is Confirmation, Not Discovery

CI/CD is a safety net and a signal.
It is not the primary discovery loop.

Preferred order:
1. reproduce locally at the earliest honest seam
2. prove the fix locally
3. push
4. let CI confirm the result

For platform-specific work, “locally” may still include the real remote platform.
The important distinction is:
- discovery happens in a fast, operator-controlled loop
- CI confirms what is already believed to be true

Do not rely on slow deploy pipelines to tell you facts that a focused local or direct-platform probe could have surfaced in seconds or minutes.

### Local Proof Before Push

Before pushing a fix for a runtime, bootstrap, or platform seam, gather explicit local proof.

Examples:
- focused unit or contract test for the adapter behavior
- localhost backend against the real remote runtime
- direct platform probe that exercises the exact mount, env, process, or transport contract

“Passed locally” should mean:
- the exact failing seam was exercised
- the fix was observed at that seam
- the proof is stronger than code inspection alone

If that bar is not met, the change is not ready for CI.

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

### Test The Contract, Not Just The Code

If two independently maintained components rely on the same:
- file paths
- sentinel names
- env vars
- message shapes
- lifecycle transitions

then encode that shared dependency as a contract test.

Logic tests are not enough when the failure mode is drift between systems.

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

### Environment Binding Must Be Explicit

When a platform exposes named remote resources, bind the environment explicitly.

Examples:
- volumes
- buckets
- queues
- apps
- secrets

Do not assume that “same name” implies “same resource.”

If backend-side storage and runtime-side mounts both depend on a named platform resource, they must resolve that name in the same environment/scope. Otherwise the system may appear healthy while each side is talking to a different object.

This is a contract, not an implementation detail.

If a bug only reproduces on one platform:
- first prove whether the contract differs
- then decide whether the fix belongs in:
  - shared logic
  - runtime adapter
  - image/runtime packaging
  - deployment/config

### Signal Completion, Dont Infer It

If process B depends on process A being done, process A should emit an explicit completion signal.

Do not treat these as proof of completion:
- directory exists
- file is non-empty
- port is open
- process started

These indicate that something began, not that it completed.

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

## Prior Art

Before building a non-trivial new mechanism:
- search for existing solutions
- inspect real implementations, not just docs
- study how mature systems solved the same shape of problem
- adopt or adapt when possible

Build from scratch only when there is clear evidence that existing approaches do not fit.

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
