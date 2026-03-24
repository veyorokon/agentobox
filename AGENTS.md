# AGENTS.md

This file describes how agents should reason, collaborate, and execute in this repo.

It is intentionally generic. The goal is not to encode local implementation trivia, but to preserve the working style that leads to clean systems and boring operations.

## Repo Docs

Use the repo-facing docs for process and project context:

- `README.md`
  - product overview
  - architecture summary
  - local commands
  - documentation map
- `CONTRIBUTING.md`
  - issue taxonomy
  - label policy
  - incident vs work-thread workflow
  - proof-level expectations for contributors

`AGENTS.md` is the agent working model.
`README.md` and `CONTRIBUTING.md` are the repo operating docs.

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
  Boring means fewer moving parts, explicit data flow, and no hidden inference from ambient state.
- Minimize abstraction bleed.
- Remove duplicate overlapping code paths once the replacement is proven.
- Fail loudly when contracts are violated.
  Prefer structured diagnosis, explicit error surfaces, and named contract breaches over silent degradation or raw stack traces alone.

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

### Contracts

A contract is the explicit agreement at a seam about what each side provides and requires. If a seam is the boundary, a contract is the stitch that holds the two sides together. Without the contract, the seam is just a gap where things drift apart.

A contract is expressed through code, tests, and docs, but is not reducible to any one of them. It is the invariant that all three must honor. Code implements the contract. Tests enforce it. Docs state it. If any of the three contradict the contract, the contract wins.

A good contract:
- names the seam it governs
- states who owns truth (who writes, who reads)
- lists the inputs each side must provide
- lists the outputs each side must produce
- defines the invariants that must hold across all valid states

An invariant is a specific rule within a contract that must never be violated regardless of how the system evolves. "Prod artifact identity comes from an explicit manifest ref" is an invariant of the release contract. It does not describe what happens. It describes what must never stop being true.

Contracts separate what must be true from how it is achieved. Implementations behind the contract can change freely. If the contract stays the same, downstream consumers do not need to change.

When a bug happens at a seam, the contract tells you which side broke its promise.

Examples:
- release contract: dev writes the manifest, prod reads it, images are never rebuilt for promotion
- machine contract: runtime owns observed state, backend owns desired state
- image contract: built image must satisfy boot, healthcheck, and filesystem expectations

Questions:
- What is the contract at this seam?
- Which side owns writing truth?
- What invariants must hold?
- Is the current implementation honoring the contract, or working around it?
- If the implementation changed, would the contract still be satisfied?

### Goals

A goal is the desired state of the world a thread is trying to make true.

If a seam tells you where responsibility changes hands, and a contract tells you
what must hold at that handoff, the goal tells you why the thread exists and
what world should exist when the thread is done.

Goals should be stated explicitly instead of being inferred from implementation
ideas.

A good goal:
- describes the desired state, not the patch
- distinguishes current state from desired state
- is testable at the right proof level
- makes the stopping condition obvious

Examples:
- release goal: prod promotes the exact tested dev artifact set by explicit manifest ref
- runtime goal: executor readiness is explicit and independent from optional desktop services
- state goal: one canonical writer owns live mutable machine state

Questions:
- What is true today?
- What should be true instead?
- Is this thread changing the world in the intended way, or only changing code shape?
- Would we still want this outcome if the implementation path changed completely?

Agents should assume that users will often describe goals colloquially,
implicitly, or in solution-shaped language. The agent's job is to translate
that into an explicit desired-state statement and keep the thread grounded in
that statement.

Preferred pattern:
1. listen for the user's intended outcome
2. restate it as a desired state of the world
3. distinguish that goal from any proposed implementation
4. use the desired state as the reference point for tradeoffs and completion

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
- states the current state and the desired state
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
2. state the current state and desired state explicitly
3. locate the failing seam inside it
4. fix the seam
5. close the thread only when the end-to-end question is resolved

When a thread starts crossing too many unrelated seams, split it.
When two threads are really symptoms of one broken seam, merge them.

### Issues As Shared Memory

GitHub issues are not just backlog items in this repo. They are also part of the
working memory for active threads.

Use issue comments to externalize important discoveries so progress does not
depend on one agent's transient context window.

Preferred pattern:
1. keep one relevant issue (or one umbrella issue plus linked child issues) per thread
2. when understanding changes, update the issue
3. record:
   - the seam
   - the contract
   - the current finding
   - the proof level
   - the next step
4. prefer updating the existing issue over leaving important orientation only in chat

This is especially important when:
- multiple agents are working in parallel
- a thread splits into child threads
- runtime/control/UI semantics are being clarified incrementally
- the work spans multiple sessions or deploy cycles

While waiting on CI, deploys, or another agent:
- use the time to reconcile issue state
- update stale issue bodies/comments while discoveries are still fresh
- narrow umbrella issues when child threads have become clearer
- close or relabel issues whose original scope is no longer accurate
- run targeted audits for drift in:
  - visible vocabulary
  - contracts
  - tests
  - docs/comments

Audits are a good use of waiting time when they stay specific and thread-relevant.

### Seamless

“Seamless” does not mean “no seams.”

It means:
- seams are explicit
- ownership is obvious
- the handoff is reliable
- each side can evolve without hidden coupling

The goal is not to erase seams. The goal is to make them clean.

### Formalization

Formalization is the act of turning discovered truth into explicit system shape.

Examples:
- moving from an operator-discovered fix to code
- replacing implied behavior with an explicit contract
- encoding a handoff in tests, types, names, and ownership
- collapsing multiple half-working paths into one canonical path

Formalization should result in:
- clearer ownership
- fewer hidden assumptions
- stronger invariants
- more legible failures

Formalization is what moves a system from:
- “we think this is how it works”

to:
- “this is how it works, and the system now enforces it”

Discovery finds the answer.
Formalization makes the answer durable.

Naming is part of formalization.

Good naming helps turn an abstract or half-understood thing into a concrete system object.
It makes the shape easier to:
- track
- compare against reality
- assign ownership to
- test
- evolve

Weak naming preserves ambiguity.
Strong naming is one of the ways a system becomes more real and more legible.

### Extensibility

Extensibility is the property that a formalized system can admit adjacent growth cleanly.

It does not mean:
- vague flexibility
- many hooks
- many optional paths
- easy layering by accumulation

It means:
- the core seams are explicit
- the core contracts are stable
- new behavior has an obvious place to live
- adjacent features can be added without bending ownership boundaries

A system with good extensibility has:
- rigid bones in the right places
- flexibility at explicit extension points
- low pressure to leak implementation details across seams

Questions:
- Is this seam formalized yet?
- Is the formalization extensible?
- Are we adding an adjacent feature cleanly, or exposing that the underlying shape is not extensible?

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

### Gap Detection

Gap detection is the disciplined practice of comparing explicit expectations to concrete observations.

A gap exists when:
- the expected contract says one thing
- the observed evidence shows another

This is not the same as vague discomfort or style preference.
A gap is worth tracking when the mismatch affects:
- contract validity
- proof level
- ownership
- lifecycle behavior
- operator understanding
- naming/taxonomy accuracy

In practice:
- expectation is the currently assumed contract
- observation is the evidence from reality
- gap is the divergence between the two

Preferred pattern:
1. state the expected contract
2. record the observed evidence
3. name the gap explicitly
4. describe the consequence
5. identify the fix target
6. state what proof closes the gap

Template:
- expected contract:
- observed evidence:
- gap:
- consequence:
- fix target:
- closing proof:

This matters because:
- without explicit expectations, discrepancies stay vague
- without concrete observations, expectations stay theoretical
- without discipline, every mismatch becomes noise

Good gap detection turns discrepancies into diagnosis signal.

### Thread Updates

Thread updates are periodic structured progress comments posted to the relevant GitHub thread.

Their purpose is to:
- preserve state outside transient chat
- make the current shape of the work legible
- record which gaps have been resolved
- record which gaps remain open
- improve handoff between agents and future operators

Thread updates should be posted when:
- the shape of the thread materially changes
- a meaningful seam is fixed
- a diagnosis becomes clearer
- the remaining work meaningfully narrows

Preferred shape:
- current shape:
- what changed:
- resolved gaps:
- remaining gaps:
- next seam / next decision:

Thread updates are not meant to restate everything.
They are meant to make the thread durable, navigable, and concrete.

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

### Smoke vs Canary

Keep these terms distinct:

- `smoke`
  - a test type
  - minimal end-to-end proof of a critical path
- `canary`
  - a deployment-verification context
  - selected smoke scenarios run against a real deployed environment after deploy

Canaries are composed of smoke scenarios, but not all smoke tests are canary runs.

Do not call something a `canary` unless it is part of a real post-deploy remote verification run.

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

“Fail loudly” should mean the broken seam is easier to identify after the
failure than before it.

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

### Entering A Codebase

When entering a repo or thread cold:

1. read the operating docs first
2. identify the active thread
3. state the current state before proposing the desired state
4. identify the seams the thread crosses
5. read the files, tests, and contract docs for those seams before editing

Do not jump from a request directly into code changes without first orienting
on the active thread and seam.

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

### Scope Discipline

Do the thread that was asked for.

When adjacent breakage or cleanup appears:
- identify it explicitly
- decide whether it belongs to the same thread or a new one
- do not silently widen scope just because the code is nearby

If the seam changes, the thread probably changed too.

### Shared-State Actions

Before taking a shared-state action, be explicit about it.

Shared-state actions include:
- commits
- pushes
- merges
- deploys
- secret or environment mutations
- live host or cloud resource mutations

If the user already asked for that exact action, proceed.
If not, surface the action before doing it.

### Trace The Actual Chain

Before theorizing, trace the real path end to end.

Examples:
- user action -> API -> queue -> worker -> storage -> UI
- deploy -> provision -> bootstrap -> transport connect -> ready
- write -> projection -> read model -> rendered state

When possible, identify the first point where reality diverges from the expected chain.

### Blast Radius

Before changing a shared contract, output, schema, workflow interface, or
other widely consumed surface:
- identify downstream consumers
- identify what else must change with it
- prefer one coherent migration over partial drift

Do not change a shared seam in isolation when multiple consumers depend on it.

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

### Search Heuristics For Large Codebases

When the repo is too large to hold in working memory, search for the seam, not
just the topic.

Heuristics that generally work well:
- start from the user-visible surface or external entrypoint, then trace inward
- search for canonical write or resolve points, not just every read site
- search for exact literals that define the contract: env vars, file paths, GraphQL fields, status values, workflow outputs
- use tests as contract documentation, especially when test names already encode the intended behavior
- look for local contradictions: comments, config, and code paths that describe incompatible truths
- treat absence as evidence too; if a path or artifact is referenced in config but never appears in image/build/runtime setup, that gap matters

These are search heuristics, not rigid steps. Use them to find the canonical
path faster, not to create ceremony.

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

### Multi-Agent Collaboration

When other agents are involved:
- treat their output as evidence, not automatic truth
- avoid duplicating work that has already been proven
- reuse their findings when the proof level is sufficient
- surface disagreements explicitly in terms of seam, contract, and evidence

Parallel work should reduce uncertainty, not create multiple competing stories.

### Handling Corrections

When the user or another agent corrects the direction:
1. restate the corrected desired state
2. drop the superseded frame
3. adjust the plan immediately
4. do not defend the old path out of inertia

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

Normalize names across equivalent concepts whenever possible.

Examples:
- prefer `Agentobox Dev`, `Agentobox Prod`, and `Agentobox Local` over one-off variants
- prefer one stable noun for the same resource across docs, dashboards, provider consoles, and runbooks
- prefer explicit environment qualifiers over implicit or historical names

Naming normalization is not cosmetic. It is part of ambiguity reduction and seam hygiene.

A good normalization pass:
- keeps the same concept named the same way across environments
- makes environment scope explicit when it matters
- removes stale aliases once the new name is proven
- treats naming drift as a contract bug, not just a style issue

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
- the change stayed inside the motivating thread instead of quietly absorbing adjacent work

## Repo Docs

Start with:

- `README.md`
  - product, architecture, commands
- `CONTRIBUTING.md`
  - issue taxonomy, labels, contributor workflow
- `bin/README.md`
  - harness conventions and when to use `bin/` instead of `tests/`

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
