# Contributing

This repo uses a small, explicit issue taxonomy.

The goal is not more process. The goal is less ambiguity.

## Work Shapes

Use these issue types:

- `Incident`
  - active breakage
  - red path
  - diagnosis-first
- `Work Thread`
  - bounded implementation, refactor, hardening, or product work
  - one main question across one or more seams
- `Epic`
  - umbrella issue tracking multiple child threads
  - not usually assigned directly for implementation

If the system is actively broken, file an `Incident`.
If the work is exploratory or implementation-oriented, file a `Work Thread`.
If the issue is just grouping multiple threads, use an `Epic`.

## Labels

Every active issue should use labels from these groups.

### Kind

- `kind/incident`
- `kind/work-thread`
- `kind/epic`

### Status

- `status/discovery`
- `status/in-progress`
- `status/blocked`
- `status/needs-proof`
- `status/confirmed`
- `status/done`

### Area

- `area/backend`
- `area/dashboard`
- `area/agent-runtime`
- `area/ci-cd`
- `area/modal`
- `area/docker`

### Seam

- `seam/runtime-control-plane`
- `seam/preview-vnc`
- `seam/storage-volume`
- `seam/theme-projection`
- `seam/auth-graphql`

### Proof

- `proof/local`
- `proof/deployed-equivalent`
- `proof/live`

## Label Rules

Use labels to make scanability obvious.

Minimum expected labels:

- one `kind/*`
- one `status/*`

Preferred labels:

- one or more `area/*`
- one `seam/*` when the failing boundary is known
- one `proof/*` once meaningful evidence exists

Do not use ad hoc labels outside this taxonomy.

## Issue Workflow

### Incidents

Incidents are diagnosis-first.

The issue body should answer:

- what is broken
- which seam is failing
- what contract was expected
- what was actually observed
- what proof level exists now
- what must be true to close the incident

Lifecycle:

1. file as `kind/incident + status/discovery`
2. narrow the failing seam
3. add proof updates in comments
4. move to `status/in-progress` once the implementation path is clear
5. move to `status/needs-proof` when code is in but final validation remains
6. close when the acceptance criteria and proof level are satisfied

### Work Threads

Work threads are bounded lines of work.

They should name:

- the seams crossed
- the target canonical shape
- the current proof level
- the concrete implementation order
- explicit non-goals

Lifecycle:

1. file as `kind/work-thread + status/discovery`
2. move to `status/in-progress` once implementation starts
3. use `status/blocked` only for real external blockers
4. use `status/needs-proof` when implementation is done but validation is incomplete
5. close when the thread’s end-to-end question is honestly resolved

### Epics

Epics are umbrellas.

They should:

- track the larger strategic problem
- link concrete child threads
- avoid carrying day-to-day implementation detail

## Proof Levels

When saying something is fixed or working, be explicit about the proof level.

- `proof/local`
  - local integration or local runtime observation
- `proof/deployed-equivalent`
  - local execution against the same topology or external system shape that matters
- `proof/live`
  - confirmation in the real remote environment

Use the strongest proof that actually exists.
Do not claim remote confidence based only on local proof.

## Hygiene

- Close issues aggressively once the actual question is resolved.
- Split issues when one thread becomes two.
- Do not broaden incidents into unrelated cleanup while the system is red.
- Update labels when the thread changes shape.
- Keep issue comments evidence-first: commands, logs, screenshots, IDs, and exact observed states.

## Pull Requests

PRs should preserve the same discipline:

- one main thread per PR when possible
- explicit contract being changed
- proof level stated honestly
- earliest honest regression added
- old ambiguous path removed or explicitly deprecated

If a PR is carrying an `Incident`, the incident should stay diagnosis-first until the seam is clear.
