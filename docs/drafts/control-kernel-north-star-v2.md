# Control Kernel North Star v2

This note captures the tighter control-kernel shape that emerged after
reframing the system around state transitions instead of agents.

It is not a near-term rewrite plan.
It is a north star for making Agentobox more explicit, auditable, and
replaceable as the platform matures.

The goal is to define the kernel clearly enough that:

- the system still makes sense if models change
- the system still makes sense if role names change
- the system still makes sense if prompts change
- the product abstractions remain useful without being mistaken for the kernel

## Thesis

The system should not be centered on `agent` as the primary primitive.

The deeper kernel is:

- `state`
- `predicates`
- `goals`
- `operators`
- `policy`
- `authority`
- `scope`
- `evidence`
- `events`
- `evaluations`

Agents, tasks, messages, roles, personas, and skills are product abstractions
built on top of that kernel.

## Why This Matters

This gives us:

- clearer ownership boundaries
- explicit mutation contracts
- auditable decision-making
- measurable progress
- safer autonomy
- stronger evaluation loops
- cleaner UI projections
- better model replaceability

If the kernel is real, the system still has a legible shape after prompt and
model churn.

## Core Primitives

### 1. State

State is canonical system truth.

State should be:

- typed
- scoped
- versioned where needed
- explicitly writable by named authorities
- the authority when projections disagree

Important state classes:

- `world state`
  - what is believed about the environment
- `goal state`
  - desired predicates over the world/project
- `control state`
  - runtime mode, permissions, budgets, deployment state
- `memory state`
  - retrievals, summaries, traces, working beliefs
- `policy state`
  - constraints, escalation rules, risk thresholds, approvals

### 2. Predicates

Predicates are logical truth claims over state.

They are the language used to express:

- goal completion
- operator preconditions
- expected effects
- policy checks
- evaluator checks
- discrepancy detection

Examples:

- `runtime.status == "ready"`
- `project.artifacts.spec exists`
- `budget.remaining > 0`
- `deployment.health != "failed"`
- `goal.launchable == true`

Predicates make the system inspectable and serializable.
They should not be hidden inside ad hoc imperative checks when they can be
expressed declaratively.

### 3. Goals

Goals are desired-state predicates, not just prose tasks.

A useful goal should be:

- typed
- measurable
- attributable
- decomposable
- versioned when edited
- auditable when changed

Examples:

- `runtime is converged`
- `project has an approved spec`
- `deploy health is green`
- `virtual-self response quality exceeds threshold`

Goals define what should become true.
They do not define what is allowed, preferred, or safe.

### 4. Operators

Operators are typed possible transitions over state.

An operator should define:

- `read set`
- `write set`
- `preconditions`
- `expected effects`
- `authority required`
- `scope required`
- `evaluation criteria`

Examples in Agentobox terms:

- provision runtime
- restart runtime
- apply machine mutation
- send agent input
- capture incident
- write project artifact
- approve change
- promote overlay

Operators are the durable kernel object behind a large share of what product
surfaces will call `tasks`, `actions`, or `commands`.

### 5. Policy

Policies are not goals.

Goals define:

- what state we want

Policies define:

- what is allowed
- what must be preferred
- what risk is acceptable
- what requires approval
- what must be blocked or escalated

Policies constrain operators and evaluations.

### 6. Authority

Authority must be explicit.
It should not be hidden in prompts or inferred from role names alone.

Typical levels:

- advisory
- proposal
- command
- mutation
- approval-gated mutation
- veto

Authority answers:

- who may propose
- who may apply
- who may approve
- who may block

### 7. Scope

An invocation should not see or mutate all state by default.

Scope defines:

- readable state
- writable state
- allowed operator families
- active policy overlays
- applicable evaluators

Scope is how the same kernel can support:

- platform operations
- project execution
- human supervision
- agent execution

without pretending those are all the same trust domain.

### 8. Evidence

Evidence is what supports belief that a transition actually happened.

Examples:

- artifacts
- logs
- screenshots
- machine observations
- health payloads
- tool outputs
- human approvals
- evaluator bundles

Evidence should be first-class because autonomy without proof degenerates into
prompt theater and stale belief.

### 9. Events

Events are append-only trace of what happened.

At minimum, record:

- state read
- proposal produced
- operator selected
- operator invoked
- effect observed
- evaluation result
- intervention
- final outcome

Events are not the same as canonical state, but they are a critical part of
diagnosis and auditability.

### 10. Evaluations

Evaluators are first-class judgments over transitions and outcomes.

They score:

- success
- quality
- policy compliance
- safety
- convergence
- efficiency/cost
- progress against goals

Evaluations should be explicit objects, not buried in prose comments or only
implied by success paths.

## Canonical Loop

The kernel loop is:

1. inspect current state
2. evaluate predicates
3. determine which goals are unsatisfied
4. select an operator whose preconditions hold
5. verify policy, authority, and scope
6. execute through a human or agent
7. collect evidence and events
8. update belief about state
9. evaluate whether expected effects and goals were satisfied
10. repeat

This is the stable loop underneath:

- runtime operations
- project execution
- incidents
- canaries
- approvals
- future autonomous work

## Product Abstractions Built On Top

These remain useful, but they are not the kernel:

- `agent`
- `task`
- `message`
- `role`
- `skill`
- `persona`
- `tag`
- `project`

Clean compression:

- `agent`
  - executor configuration:
    - model/runtime
    - scope
    - operator family
    - policy context
    - authority level
- `task`
  - an operator instance or planned transition in service of a goal
- `message`
  - one interface artifact, not canonical control truth
- `role`
  - reusable preset over scope, operator family, authority, and policy
- `skill`
  - operator family or capability preset
- `persona`
  - behavior and evaluation preset
- `tag`
  - grouping/routing metadata

The system should still make sense if these product abstractions evolve.

## Tasks, Preconditions, Effects

Tasks deserve special clarification.

A task is not the deepest primitive.

A task is best modeled as:

- a planned or active operator instance
- attached to one or more goals
- constrained by preconditions
- expected to produce effects
- executed by an agent or human within a scope
- judged by evidence and evaluation

This means:

- task status is not enough
- task truth comes from:
  - preconditions
  - effects
  - evidence
  - evaluation

This is why predicate logic matters:

- `preconditions`
  - when the task is eligible
- `effects`
  - what should change if it succeeds
- `goal predicates`
  - what desired state it is trying to satisfy
- `policy predicates`
  - what must remain allowed while it runs

## Canonical vs Derived

Important rule:

- canonical state wins
- projections are disposable

Examples of derived views:

- dashboard summaries
- agent inboxes
- task lists
- graphs
- timelines
- read-optimized projections

Those views are valuable, but they are not authority.

## Read/Write Authority

The kernel should make read/write loops explicit.

The system is healthier when it is clear:

- who writes canonical state
- who only reads it
- which surfaces are projections
- which surfaces are allowed to mutate
- which mutations require approval

Humans and agents should both be thought of as clients of the kernel, not the
kernel itself.

## UI Implication

The central UI object should be a control graph or layered state-transition
graph, not a chat transcript and not an agent roster.

A clean layered view is:

1. `state`
2. `goals`
3. `operators / tasks`
4. `agents / executors`
5. `evidence / evaluations`

That central graph can be paired with:

- left rail
  - active goals
  - blocked operators
  - attention items
- right pane
  - selected node detail
  - predicates
  - preconditions
  - effects
  - evidence
  - controls
- bottom timeline later
  - event and execution history

This makes the UI a projection of the kernel rather than a separate ontology.

## What This Changes About Agentobox

This north star implies:

- incidents are evaluator artifacts over state transitions
- canaries are evaluator executions against real environments
- runtime convergence is predicate and evaluation driven
- project work should become more measurable through explicit predicates and
  effects
- operator contracts are more important than role prose
- autonomy should be constrained by policy, authority, and scope, not only
  model instructions

## What This Is Not

This is not:

- a mandate to remove the word `agent`
- a claim that prompts do not matter
- a plan to force users to author predicate logic directly
- a near-term rewrite
- a demand that all state becomes a git-like artifact substrate

It is a design lens for reducing ambiguity as the system grows.

## Near-Term Product Guidance

Do not rewrite the product into abstract operator language.

Instead:

1. keep current product objects
   - agents, projects, tasks, messages
2. strengthen kernel contracts underneath them
   - state
   - predicates
   - operators
   - authority
   - policy
   - evidence
   - evaluation
3. make authority and scope more explicit
4. make project execution more measurable
5. make evidence and evaluation more first-class in both backend and UI

## Short Summary

First-class:

- state
- predicates
- goals
- operators
- policy
- authority
- scope
- evidence
- events
- evaluations

Second-class:

- agents
- tasks
- messages
- roles
- modes
- personas
- skills
- tags

If the model changes, role names change, prompts change, and product surfaces
evolve, the system should still make sense.

That is the north star.
