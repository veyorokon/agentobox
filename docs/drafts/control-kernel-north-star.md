# Control Kernel North Star

This note captures a possible long-term architecture direction for Agentobox.

It is not the current product model and not a rewrite plan.
It is a north star for how the system can become more explicit, measurable,
and replaceable as the platform matures.

## Thesis

The system should not be centered on `agent` as the primary primitive.

The deeper kernel is:

- `state`
- `goals`
- `operators`
- `policies`
- `authority`
- `evaluations`
- `events`
- `scopes`

Agents, roles, tasks, skills, personas, and tags are product abstractions
built on top of that kernel.

## Why This Matters

This gives us:

- clearer ownership boundaries
- explicit mutation contracts
- auditable decision-making
- measurable progress
- model replaceability
- safer autonomy
- better evaluation and training loops

If the model, prompts, or role names change, the system should still make
sense. That is the test for whether the architecture is real or just prompt
theater.

## Kernel Primitives

### State

Canonical, versioned, scoped system truth.

Important state classes:

- `world state`
  - what is believed about the environment
- `goal state`
  - desired predicates over the world/project
- `control state`
  - runtime mode, permissions, budgets, deployment state
- `memory state`
  - retrievals, traces, summaries, working beliefs
- `policy state`
  - constraints, preferences, escalation rules, risk thresholds

### Goals

Desired-state predicates, not just prose tasks.

A useful goal should be:

- typed
- measurable
- attributable
- decomposable
- versioned
- auditable when changed

### Operators

Typed possible transitions over state.

An operator should define:

- read set
- write set
- preconditions
- expected effects
- authority required
- evaluation criteria

Examples in Agentobox terms:

- provision runtime
- restart runtime
- write machine state
- send agent input
- capture incident
- apply project artifact change
- promote project overlay

### Policies

Policies are distinct from goals.

Goals define:

- what state we want

Policies define:

- what is allowed
- what must be preferred
- what risk is acceptable
- what requires approval or escalation

### Authority

Authority must be explicit, not hidden in prompts.

Typical levels:

- advisory
- proposal
- command
- mutation
- veto
- approval-gated mutation

### Evaluations

Evaluators are first-class.

They score:

- success
- quality
- safety/policy compliance
- convergence
- efficiency/cost
- progress against goals

### Events

Append-only trace.

At minimum, record:

- state read
- operator invoked
- proposal produced
- decision taken
- effect applied
- evaluation result
- intervention
- final outcome

### Scopes

An invocation does not see or control all state.

Scope defines:

- readable state
- writable state
- operator families allowed
- policy overlays active
- evaluator set applied

## Product Abstractions Built On Top

These remain useful, but they are not the kernel:

- `agent`
- `role`
- `task`
- `message`
- `skill`
- `persona`
- `tag`
- `project`

Clean compression:

- `agent`
  - model + scope + operator family + policy context + authority
- `role`
  - reusable preset of the above
- `mode`
  - temporary overlay on policy / authority / scope
- `skill`
  - operator family or capability preset
- `persona`
  - policy / behavior / evaluation preset
- `tag`
  - routing, matching, grouping, attachment metadata

## Platform vs Project Is A Projection, Not A Different System

Platform-level evaluators today:

- incidents
- canaries
- deploy health
- runtime convergence
- product/system integrity

Project-level evaluators later:

- task success
- goal completion
- output quality
- cost/budget adherence
- workflow progress

These are the same architectural shape:

- evaluations over state transitions under policy and authority constraints

CI/CD is one instance of the same control pattern:

- desired state
- operators
- preconditions
- effects
- evaluations
- promotion gates
- trace

Project execution can evolve toward the same shape.

## How This Maps To Current Agentobox Work

Current work is already laying groundwork for this model.

Examples:

- layered state contract
  - `desired / observed / applied / events`
- machine contract
  - explicit runtime state ownership
- incidents
  - compact evaluator artifacts over system state
- canaries
  - post-deploy evaluator executions
- non-converged active-agent detection
  - evaluation over runtime state vs desired state
- bounded raw support bundles
  - trace and evidence improvements
- billing model
  - separating operational records from accounting records

This is not wasted tactical work. It is kernel work.

## Likely Evolution Path

Do not rewrite the product around abstract operator language.

Instead:

1. keep current UX objects
   - agents, messages, tasks, projects
2. strengthen kernel contracts underneath them
   - state, operator, authority, evaluation
3. make authority and scope more explicit
4. make project work more measurable
5. add evaluator and promotion concepts where they naturally fit

## Git-Like Project State

A project may eventually benefit from a versioned artifact substrate.

That does not mean "git is the architecture."

It means durable project artifacts may be:

- versioned
- diffable
- branchable
- promotable
- auditable

This would enable:

- project overlays
- checkpoints
- branch/merge-like plan evolution
- evaluator gates
- promotion from draft -> approved -> applied

Use git-like semantics for durable authored artifacts.
Do not force all runtime or event state into that substrate.

## What This Is Not

This is not:

- a mandate to remove the word `agent`
- a plan to force users to author predicate logic
- a claim that prompts stop mattering
- a near-term rewrite

It is a design lens for making the system less ambiguous as it grows.

## Short Summary

First-class:

- state
- goals
- operators
- policies
- authority
- evaluations
- events
- scopes

Second-class:

- agents
- roles
- modes
- messages
- tags
- skills
- personas

If the model changes, the role names change, and the prompts change, the
system should still make sense.

That is the north star.
