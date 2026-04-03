# Virtual Self Foundation

This doc outlines the starting point for a new project focused on creating a virtual version of a person that users can message and talk to.

The goal is not to transplant the current app wholesale.
The goal is to lift the strongest engineering foundations, leave behind the misfit UI experiments, and define a cleaner v1 around the new product.

## Product Shape

Core experience:
- a user creates a virtual version of themselves
- they provide source materials:
  - images
  - voice samples
  - persona / writing style / biography / memories
- they can message that virtual self
- the system generates replies as:
  - text
  - audio
  - optional talking-head video

Recommended v1:
- living-user avatars first
- async generation first, not real-time
- clear synthetic framing
- one strong end-to-end path before advanced modes

## Product Framing

The product should be framed as:

- a synthetic likeness
- an interactive constructed presence
- a system grounded in source materials

It should not be framed as:

- literal continuation of a person
- proof of consciousness or survival
- metaphysical resurrection

Core distinction:

- the human being is not the system
- the system is a generated likeness built from traces, media, and configuration

This distinction should be explicit in both product language and system design.

## What To Lift From The Current Project

### Keep

- `AGENTS.md`
  - adapt it, do not discard it
  - it is the best reusable engineering asset

- Engineering posture
  - seam-first thinking
  - evidence-first debugging
  - canonical vs derived state
  - diagnosis-first failures
  - explicit completion signals

- CI/CD shape
  - lint
  - typecheck
  - focused tests
  - smoke path

- Testing strategy
  - unit tests for pure transforms
  - contract tests at key seams
  - integration tests for job flow
  - smoke tests for end-to-end generation

- Operational conventions
  - compact diagnosis artifacts
  - explicit failure states
  - artifact-first observability
  - boring, explicit deployment paths

### Leave Behind

- graph workspace experiments
- terminal/workbench UI
- agent-card execution UI
- retro office / spatial UI mockups
- multi-agent orchestration as the main product surface

These were useful exploration, but they are not the kernel of the new app.

## Core Seams

The new project should be organized around these seams:

1. frontend ↔ api
2. api ↔ queue
3. queue ↔ generation worker
4. worker ↔ ComfyUI / model runtime
5. worker ↔ artifact storage
6. conversation state ↔ generated response jobs
7. identity/profile data ↔ generated outputs
8. moderation/policy checks ↔ user-visible outputs

Each seam should have:
- one canonical owner
- explicit input/output contracts
- a clear test level

## Canonical Objects

### `identity_profile`

Represents the virtual self being constructed.

Suggested fields:
- id
- display_name
- source_images
- source_voice_samples
- persona_notes
- biography
- style_examples
- consent/provenance metadata
- framing mode
  - synthetic self
  - memorial likeness
- safety settings
- created_at / updated_at

### `conversation`

Represents an ongoing thread between user and virtual self.

Suggested fields:
- id
- identity_profile_id
- title
- status
- created_at / updated_at

### `message`

Represents user or avatar utterances.

Suggested fields:
- id
- conversation_id
- role
  - user
  - assistant
  - system
- text
- linked_generation_request_id
- created_at

### `generation_request`

Represents a requested avatar response.

Suggested fields:
- id
- conversation_id
- identity_profile_id
- prompt/input payload
- requested output types
  - text
  - audio
  - video
- status
- created_at

### `generation_job`

Canonical runtime execution object.

Suggested fields:
- id
- generation_request_id
- worker_type
- runtime_state
  - queued
  - running
  - failed
  - completed
- progress
- failure_diagnosis
- started_at / finished_at

### `artifact`

Durable outputs from generation.

Suggested fields:
- id
- generation_request_id
- type
  - transcript
  - audio
  - video
  - preview frame
  - metadata
- storage location
- mime type
- size
- duration
- version
- created_at

### `evaluation`

Represents quality, moderation, and runtime checks.

Suggested fields:
- id
- generation_request_id
- evaluation_type
  - safety
  - quality
  - identity consistency
  - technical validation
- result
- summary
- raw evidence pointer
- created_at

### `provenance_record`

Represents where the likeness came from and what authority exists to create it.

Suggested fields:
- id
- identity_profile_id
- source_type
  - self-submitted
  - family-submitted
  - archive/import
- authority_basis
- source asset references
- disclosure text
- created_at

## Source Of Truth Rules

- `generation_job` is canonical for execution state
- `artifact` is canonical for produced outputs
- `conversation` and `message` are canonical for chat history
- `provenance_record` is canonical for source and authority metadata
- UI status is derived
- dashboards and summaries are projections only

If canonical and derived disagree, canonical wins.

## Recommended v1 Architecture

### Frontend

Responsibilities:
- onboarding / profile creation
- upload source images and voice samples
- conversation UI
- job progress display
- playback of generated audio/video artifacts
- clear disclosure of synthetic nature and provenance

### API

Responsibilities:
- auth
- identity/profile CRUD
- conversation/message CRUD
- generation request creation
- job status reads
- artifact lookup

### Queue

Responsibilities:
- decouple user interaction from heavy generation
- retry policy
- concurrency control
- backpressure

### Worker

Responsibilities:
- construct generation inputs
- invoke ComfyUI workflow or equivalent runtime
- collect outputs
- persist artifacts
- emit explicit completion/failure

### Artifact Storage

Responsibilities:
- store source assets
- store generated outputs
- preserve metadata
- support retrieval and playback

### Admin / Ops Surface

Responsibilities:
- inspect failed jobs
- retry jobs
- inspect diagnosis artifacts
- audit pipeline health

This can be minimal at first.

## Testing Strategy

### Unit

Use for:
- prompt assembly
- profile normalization
- artifact metadata derivation
- policy/evaluation transforms

### Contract

Use for:
- API request/response contracts
- queue payload contracts
- worker input/output contracts
- ComfyUI workflow adapter contracts
- artifact persistence contracts

### Integration

Use for:
- request -> queue -> worker -> artifact storage flow
- conversation message -> generation request -> generated reply flow

### Smoke

Use for:
- one real end-to-end avatar response path
- minimal deployment proof that:
  - assets upload
  - request enqueue
  - worker runs
  - artifact is stored
  - conversation shows result

## CI/CD Expectations

Minimum pipeline:
- lint
- typecheck
- unit tests
- contract/integration tests at key seams
- smoke path for deploy-critical workflow

Preferred principle:
- discover locally
- use CI to confirm

## Product Constraints For v1

- avoid real-time promises initially
- avoid excessive UI ambition
- avoid overfitting to one generation runtime
- keep one honest execution path
- treat failed jobs as first-class states
- keep product framing explicit and non-metaphysical

## Safety / Framing

Recommended initial framing:
- synthetic avatar of a living user
- clear disclosure that generated responses are synthetic
- explicit provenance of source materials
- explicit distinction between likeness and person

Key product invariant:
- the system must never imply that the generated avatar is literally the person

If memorial mode is explored later, frame it as:
- interactive synthetic remembrance
- source-grounded memorial likeness
- not personhood continuity

Important measurable policy axes:
- provenance of source materials
- authority to create the likeness
- disclosure shown to users
- whether the system makes identity claims beyond “synthetic likeness”

Deceased-loved-one emulation, if ever pursued, should be treated as a later, higher-risk product question rather than the initial scope.

## Suggested Repo Structure

Example high-level layout:

```text
apps/
  web/
  worker/

packages/
  core/
  api-contracts/
  generation-runtime/
  storage/
  evaluation/

docs/
  architecture/
  drafts/

tests/
  contract/
  integration/
  smoke/
```

## First Concrete Milestone

Build the smallest honest path:

1. create identity profile
2. upload one image and one voice sample
3. create conversation
4. send one user message
5. enqueue one generation request
6. worker produces one reply artifact set
   - text
   - audio
   - optional video
7. show the result in the conversation UI

If this path is solid, the repo and product shape are real.
