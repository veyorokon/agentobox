# Agentobox: Goal-Driven Agent Orchestration

## 1. Overview

Agentobox is a multi-tenant agent orchestration platform. Users define goals, the system provisions agents (Claude Code in containers), observes their work mechanically, detects when things go wrong, and learns from every execution.

The core insight: **Goal-Driven Autonomy (GDA)** applied to agent orchestration. The system doesn't manage agents through an AI orchestrator -- it runs a deterministic control loop that reads structured signals from agents, acts on status enums, and improves over time through case-based reasoning.

The system does not guess. It recalls.

---

## 2. Core Philosophy

**Behavior as State.** Git is not the state machine. The agent's natural behavior is. Git is one artifact of code tasks. The real state -- goals, plans, trajectories, cases -- lives in Postgres.

**Mechanical Orchestration.** There is no orchestrator agent. The GDA loop is deterministic: status enums trigger mechanical responses. This is cheaper, more predictable, and doesn't hallucinate.

**Case-Based Learning.** Every completed goal becomes a case. When a similar goal arrives, the system retrieves past plans as guidance. Over time, agents get faster and cheaper because the system stops guessing.

### First Principles

1. **Database is truth** -- no in-memory state that isn't backed by the DB
2. **Signals not boxes** -- capture what solves a problem, nothing more. Semantic by default, structured only where deterministic algorithms operate
3. **Fail explicitly** -- errors surface immediately, never swallowed
4. **Trace everything** -- every request, every agent op, every external call
5. **Format compliance = health** -- if structured output stops conforming, drift is detected mechanically
6. **Never ask the model to report what infrastructure already measures** -- tokens, timing, and cost come from the response envelope

---

## 3. Infrastructure

Clean separation between state, storage, and compute.

### Postgres (Structured State)

Source of truth for everything the system needs to reason about.

```
├── Goals          (text, context, plan, trajectory)
├── Cases          (retained goal+plan pairs, embeddings)
├── Events         (semantic log of all activity)
├── Agents         (lifecycle state, meta protocol fields)
└── Users/Projects (multi-tenancy, auth)
```

pgvector extension for embedding-based case retrieval from day one.

### Docker Volumes (Shared Workspace)

Persistent filesystem that agents mount. No state in containers.

```
~/projects/
├── frontend-app/     ← agents working on code
└── api-server/
~/documents/
└── research/         ← non-code work
~/workspace/          ← scratch space
```

### Docker + Modal (Ephemeral Compute)

Agent containers are stateless. Everything persists in volumes + Postgres.

**Every agent gets the full desktop image** (~800MB): Alpine + Claude Code + tmux + git + Xvfb + VNC + browser + noVNC.

No sidecar, no conditional logic, no "does this agent have a desktop?" checks. One image for everything. Code tasks show a terminal inside the desktop. Browser tasks show the browser. The dashboard always embeds a noVNC viewer -- every agent has a visual "body."

This is a product decision, not a technical one. Non-technical users seeing a virtual desktop with a cursor moving is immediately understandable. It makes agents feel real. The ~500MB overhead per agent is worth the simplicity: one image, one streaming mechanism, one dashboard component, one UX.

**Dashboard streaming**: noVNC (browser-based VNC client over WebSocket) embedded in the dashboard. Each agent's desktop is viewable in real-time. Anthropic's computer-use image already runs noVNC.

**I/O risk with Modal volumes**: Modal uses network-attached storage. Operations involving thousands of small files (`npm install`, `git status` on large repos) can be significantly slower than local SSDs. Mitigation strategies (dependency caching, ephemeral `node_modules`): TODO -- needs profiling on real workloads.

---

## 4. Data Representations

### The Goal

A goal is a living entity with three parts:

```
Goal = Text + Context + Plan
```

**Text**: desired state of the world. Natural language. "Add GitHub OAuth login."

**Context**: workspace path from the volume mount. `~/projects/frontend-app`. This does triple duty:
1. Scopes where the agent works (write access)
2. Informs case retrieval (similar goals in similar contexts)
3. Determines project organization (agents sharing a context share a filesystem)

Context granularity is user-controlled. `~/projects/frontend-app` and `~/projects/api-server` are naturally isolated. But `~/projects/` gives agents access to everything. Narrow context = isolation. Broad context = collaboration.

**Plan**: ordered subtasks with status. The agent enters Claude Code's plan mode to design the approach, then uses TodoWrite to create the individual subtasks. The todo titles ARE the plan's subtasks. The system observes TodoWrite calls via PostToolUse hooks and updates `Goal.plan` in Postgres automatically. The plan is integral to the goal, not separate.

```
Goal {
  text:    "Add GitHub OAuth login"
  context: "~/projects/frontend-app"
  plan: [
    { text: "Read auth patterns",    status: completed }
    { text: "Install OAuth lib",     status: completed }
    { text: "Add provider config",   status: in_progress }
    { text: "Create routes",         status: pending }
    { text: "Write tests",           status: pending }
  ]
}
```

### The Trajectory

Any change to text, context, or plan creates a new immutable node. This tracks how goals evolve.

```
t0: goal created    → { text, context, plan: null }
t1: plan created    → { plan: [5 steps] }
t2: goal refined    → { text changed → plan stale → trigger replan }
t3: plan updated    → { plan: [7 steps] }
t4: goal satisfied  → { completed plan → retain as case }
```

Goal evolution is natural. Users refine what they want as they see progress. The system tracks this and detects when replanning is needed: if the goal text changed but the plan didn't, the plan is stale.

### Cases (Case-Based Reasoning)

A case is a proven (problem, solution) pair:

```
Case = {
  goal_text:  "Add GitHub OAuth login"
  context:    "~/projects/frontend-app"
  plan:       [completed subtasks in order]    // the workflow IS the solution
  outcome:    "satisfied"
  metrics:    { duration, cost }
  embedding:  [vector]                          // vectorized full goal JSON (text + context + plan)
}
```

The completed plan IS the workflow IS the solution. No separate capture step. When a goal is satisfied, its plan becomes a casebase entry.

**Retrieval**: vectorize the entire goal representation (the full JSON -- text, context, plan) and run cosine similarity against the casebase via pgvector. Embedding the complete object gives the vector more signal than just the text alone. "Add GitHub OAuth login" and "Implement SSO with GitHub" are textually different but semantically identical -- embeddings catch this, tag-based matching doesn't.

**Guidance injection** (pattern from ShowUI-Aloha):

```
New goal: "Add Google OAuth"
  → retrieve Case #47 (similar: "Add GitHub OAuth", same context)
  → format as guidance:
    "Similar past task completed in 22 min:
     Step [1]: Read existing auth patterns
     Step [2]: Install OAuth library
     Step [3]: Add provider configuration
     Step [4]: Create login/callback routes
     Step [5]: Write integration tests"
  → inject into agent prompt alongside goal text
```

The agent sees guidance, not instructions. It creates its own plan informed by what worked before.

---

## 5. The Meta Protocol

Bidirectional structured communication between agent and control plane. Claude self-reports cognitive state with every response. The system responds when it has something to deliver. No external classifiers. No forcing Claude into boxes. Just signals that solve problems.

### Design Principles

1. **Signals, not boxes** -- capture what solves a problem, nothing more
2. **Semantic by default** -- freeform strings except where deterministic algorithms operate
3. **Every response, no exceptions** -- enforced by `--json-schema` in structured output mode
4. **No external classifiers** -- Claude has the best context, let it self-report
5. **Format compliance = health** -- if structured output stops conforming, drift is detected mechanically

### Outbound (Agent → System)

Included in every response via Claude Code's `--output-format json --json-schema`. Structured output captures text responses only; tool calls flow through the normal pipeline separately.

| Field | Type | Purpose |
|-------|------|---------|
| `status` | Enum (6 values) | Mechanical GDA trigger. Each value maps to a specific system action. |
| `confidence` | Float 0-1 | Qualifies the status. Collected as data. See caveats below. |
| `sentiment` | String (semantic) | Agent's read on user emotion. No enum -- LLMs describe this naturally. |
| `summary` | String (semantic) | One sentence. What happened this turn. |
| `reasoning` | String (semantic) | Why. The thinking behind the status. |
| `output` | String (semantic) | What Claude produced. Tool calls are deterministically obvious (tool names + file paths). Text captured as-is. |

**6 fields. 2 structured, 4 semantic.**

**Cost tracking**: read from Claude Code's response envelope (`usage: { input_tokens, output_tokens }`). Never self-reported.

### Status Values

```
working       → GDA: agent alive, monitor
conversing    → GDA: hands off, don't count as work time, don't nudge
needs_info    → GDA: system tries to help first, then escalates
blocked       → GDA: escalation ladder
completed     → GDA: retain case, evaluate goal satisfaction
goal_changed  → GDA: new trajectory node, check plan staleness
```

6 values. Each triggers a specific mechanical action. No ambiguity.

### Confidence x Status

LLMs are unreliable at fine-grained confidence (0.73 vs 0.81 is meaningless). They ARE good at extremes and categorical distinctions. The system operates primarily on **status** (the enum) and **sentiment** (the semantic string). Confidence is collected but treated as a coarse signal -- effectively a classifier between "sure" and "unsure."

The GDA loop's mechanical responses are driven by status values, not confidence thresholds:

```
status = needs_info    → system tries to help, regardless of confidence
status = blocked       → escalation ladder kicks in
status = goal_changed  → new trajectory node
status = completed     → retain case
```

Where confidence adds value is at the extremes:

```
blocked + high confidence    → skip system help, escalate to user directly
completed + low confidence   → stop hook verifies more carefully
working + low confidence     → data point collected for future analysis
```

Confidence calibration -- how accurate is Claude's self-reported confidence? TODO. Collecting as data. May become more useful as models improve.

### Inbound (System → Agent)

Only sent when there's something to deliver. Never empty. Injected via hook `systemMessage` on the next PostToolUse, or prepended to the next user message by the control plane.

```json
{
  "datetime": "2026-02-05T14:32:00Z",
  "protocol_version": 1,
  "from_user": "use Google OAuth instead of GitHub",
  "from_system": [
    "agent worker-2 finished the API endpoint",
    "casebase: similar task used passport.js, took 22 min"
  ]
}
```

| Field | Type | Purpose |
|-------|------|---------|
| `datetime` | ISO 8601 | Always present. Temporal grounding so Claude never loses track of time. |
| `protocol_version` | Integer | Version the control plane expects. For fleet management during rollouts. |
| `from_user` | String (optional) | User messages relayed through control plane. Clearly separated from system noise so Claude prioritizes it. |
| `from_system` | String[] (optional) | System messages: other agent updates, casebase guidance, nudges. Each entry is freeform. |

### The Escalation Ladder

System gets multiple chances to resolve before bothering the user:

```
Claude reports: needs_info
  ↓
System inbound: "check the .env file, credentials might be there"
  ↓
Claude re-evaluates: working (found them)
  OR
Claude re-evaluates: needs_info (not there)
  ↓
System inbound: "casebase says project X stored creds in vault"
  ↓
Claude re-evaluates: blocked (verified not available)
  ↓
System: surfaces to user. "Agent needs GitHub OAuth credentials."
```

`needs_info` means "could proceed but shouldn't without this." Different from `blocked` which means "cannot proceed." This creates a natural escalation where the system tries before the user gets interrupted.

---

## 6. Two Observation Channels

The system observes agents through two complementary channels:

```
Channel             What it captures           How
───────             ────────────────           ───
Meta Protocol       Cognitive state            Structured output on every response
                    (status, sentiment,        (--json-schema)
                    reasoning, intent)

Hooks               Behavioral state           Claude Code plugin hooks
                    (tool calls, session       (SessionStart, PostToolUse, Stop)
                    lifecycle, heartbeats)
```

Meta protocol is the primary intelligence layer -- it captures what the agent thinks. Hooks are thin transport -- they capture what the agent does and deliver inbound messages. Together they form the complete picture.

### Hooks as Thin Transport

Hooks exist but their role is minimal. Pipes, not intelligence.

```
SessionStart:   bootstrap (register agent, persist env vars)
PostToolUse:    deliver inbound messages via systemMessage
                + behavioral heartbeat (tool call = agent alive)
Stop:           gate completion (can block premature stops)
```

The meta protocol absorbs everything that used to require smart hooks:
- Goal change detection → `status: "goal_changed"` (was: external LLM classifier)
- Progress tracking → `summary` + `confidence` (was: TodoWrite parsing)
- Intent classification → `status: "conversing"` vs `"working"` (was: fast LLM on messages)
- User sentiment → `sentiment` field (was: not captured at all)
- Stall detection → TODO (signals collected, detection learned from data)

### Claude Code Native Tool Mapping

```
Claude Code         What it is for us          Observed by
─────────────       ──────────────────         ───────────
Plan mode           Goal's plan                Meta protocol (status, reasoning)
TodoWrite           Subtasks of plan           Hook (PostToolUse) + meta protocol
Stop                Agent finished             Hook (Stop gate) + meta protocol (completed)
Tool calls          Agent working              Hook (heartbeat) + meta protocol (output)
Text responses      Cognitive state            Meta protocol (structured output)
```

---

## 7. The GDA Loop

Runs continuously. Reads meta protocol output from Postgres, agent state from Docker API. Deterministic -- no LLM in the loop.

### What It Computes

All derived from the protocol's 10 total fields plus infrastructure signals:

| Signal | Source |
|--------|--------|
| Progress | status = working + hook heartbeats |
| Stall | TODO -- learned from collected data |
| Cost | usage from Claude Code response envelope |
| Duration | datetime deltas between messages |
| User satisfaction | sentiment field over time |
| Case quality | confidence at completion (coarse) |
| Budget | accumulated token usage exceeding threshold |
| Goal evolution | status = goal_changed + reasoning explains what |
| Blocked | status = blocked + reasoning explains what/who |
| Alignment health | structured output conforming to schema |
| Container health | Docker API status |

### Autonomy Levels

Autonomy = log level threshold. Events have severity. Autonomy setting determines what surfaces to the human.

```
High autonomy:       only errors surface
Medium:              + blocks, escalations
Low:                 + completions, warnings
Supervised:          everything
```

How sentiment adjusts autonomy: TODO. Sentiment is collected from day one. First use: dashboard heatmap showing which projects/goals cause friction. Automated adjustment comes later once we have data. Avoid premature feedback loops (frustration → more notifications → more frustration).

### Replanning Triggers

Four triggers, all mechanical:

1. **Goal text changed** (meta protocol: `status = goal_changed`) → plan may be stale
2. **Agent stuck** (meta protocol: `status = blocked` persists after escalation ladder) → plan may be wrong
3. **Agent crashed** (Docker API: container dead) → fresh plan needed
4. **Context changed** (files moved, dependencies updated) → plan may be invalid

Mechanism: system sends inbound directive to replan. Agent creates new plan. Meta protocol captures the status shift. New trajectory node. Re-retrieve from casebase with updated goal.

### No Dedicated Orchestrator Agent

The GDA loop + meta protocol + casebase already does everything a dedicated orchestrator would:

| Orchestration task | Who does it |
|--------------------|-------------|
| Monitor progress | GDA loop (reads meta protocol from Postgres) |
| Detect blocks | GDA loop (status = blocked / needs_info) |
| Detect stalls | TODO -- learned from data |
| Trigger replanning | GDA loop (sends inbound directive) |
| Escalate to user | GDA loop (escalation ladder) |
| Learn from past | Casebase (retained goals + plans) |
| Coordinate agents | GDA loop (reads all agents' meta protocol output) |
| Inject guidance | Inbound protocol (casebase, agent updates) |

All deterministic. No LLM in the orchestration loop.

**The AI layer is the user interface, not the orchestrator.** When a user wants to interact naturally, an LLM with the system's full context serves as the voice:

```
User: "how's the OAuth task going?"
  → LLM reads: goal state, agent meta protocol output, recent trajectory
  → responds naturally with status

User: "spin up another agent for the API work"
  → LLM translates to: create agent, assign goal, mount volume
  → system executes mechanically
```

One AI with the system's full context per user. It sees across all projects, all agents, all goals. It's the system's voice, not the system's brain.

---

## 8. Agent Experience

From the agent's perspective:

1. Wake up in a directory (volume mount)
2. CLAUDE.md explains the project + meta protocol instructions
3. Receive a goal (+ guidance from similar past cases if available)
4. Enter plan mode, create a plan
5. Execute plan using whatever tools needed
6. Every response includes a structured meta block (status, confidence, sentiment, etc.)
7. Occasionally receive inbound messages (datetime, updates, guidance)
8. Done

The agent doesn't know about Postgres, the GDA loop, the casebase, or trajectory tracking. It participates in one simple protocol: report your state with every response. Like a pilot's radio callout -- report altitude, heading, intentions. The system does the rest.

---

## 9. Tech Stack

```
Control Plane:     Async Django (ASGI) + Django Channels
API:               Strawberry GraphQL (queries, mutations, subscriptions)
Database:          Postgres + pgvector
ORM:               Django ORM (async queries, single source of truth)
Compute:           Docker (local) + Modal (prod, Python SDK)
Agent Runtime:     Claude Code (structured output mode)
LLM (AI layer):    LiteLLM (unified provider interface)
Observability:     structlog + OpenTelemetry
Frontend:          Next.js + React + Zustand + Tailwind
Hosting:           Railway (control plane + DB + dashboard) + Modal (agent compute)
```

### API Strategy

```
Dashboard  <-->  GraphQL  (queries, mutations, subscriptions)
Agents     --->  REST POST /webhook/event  (simple callback, HMAC-signed)
```

GraphQL handles all dashboard communication. One endpoint, flexible queries, real-time via subscriptions (replaces SSE). The webhook stays REST because agents in containers shouldn't need a GraphQL client for a simple event POST.

Strawberry GraphQL: async-native, type-safe with dataclasses, Django integration via strawberry-django. Subscriptions over WebSocket via Django Channels.

### Why These Choices

- **Async Django** -- ASGI gives us WebSocket subscriptions, async ORM, and async views in one framework with auth + admin + migrations out of the box
- **Strawberry over Graphene** -- async-native, cleaner type system, better maintained
- **GraphQL over REST** -- data model is graph-shaped (User → Projects → Agents → Goals → Events), dashboard benefits from flexible queries, subscriptions replace SSE
- **Modal Python SDK** -- mature and well-documented. The JS SDK's immaturity triggered this rewrite from the original TypeScript implementation
- **pgvector from day one** -- embeddings are necessary for case retrieval, not optional. Cosine similarity on vectorized goal representations beats tag-based matching
- **LiteLLM** -- unified interface across providers, easy switching, standardized rate limiting

---

## 10. Message Delivery

How inbound messages actually reach agents:

User messages flow through the control plane to Claude Code. System messages (from GDA loop, other agents, casebase) get queued and batched into the next delivery opportunity. Two delivery paths:

1. **PostToolUse hook**: after any tool call, the hook checks for queued messages and injects them via `systemMessage`
2. **User message prepend**: control plane prepends system context to the next user message before forwarding

The terminal already batches naturally -- messages queue up and Claude processes them on its next turn. No separate polling or push mechanism needed.

`from_user` is clearly separated from `from_system` in the inbound schema so Claude knows to prioritize the user message as its primary response while incorporating system context. TODO: how exactly Claude should prioritize when both are present needs clear protocol guidance in CLAUDE.md.

---

## 11. Concurrent Writes

Two agents sharing a volume and writing to the same codebase is a real concern.

1. **Claude Code's built-in detection**: already detects when a file has been modified externally since last read. Warns and refuses to edit stale files. Handles most race conditions out of the box.
2. **Context scoping**: agents on different goals typically work in different parts of the codebase. Context paths naturally reduce collision.
3. **Git conflicts**: for code tasks, agents use git. Merge conflicts are a natural coordination mechanism -- agent discovers conflict, reports `blocked`, system coordinates.

Sufficient for v1. True concurrent editing of the same file by multiple agents is an edge case addressable by goal/subtask scoping.

---

## 12. Schema Evolution

When a field is added to the outbound JSON schema, every running agent becomes non-conformant. Since format compliance = health signal, schema changes trigger false-positive drift detection across the fleet.

**v1 approach**: protocol spec baked into the Docker image (CLAUDE.md). `protocol_version` in every inbound message tells the control plane which version each agent is running.

During rollouts:
1. New image built with updated protocol spec
2. New agents get the new version automatically
3. Running agents keep the old version until restarted
4. Control plane handles multiple versions simultaneously
5. Stale agents flagged for restart when convenient

**Future**: dynamic protocol updates via inbound `from_system`. Claude adapts without restart. TODO: needs testing to confirm reliability.

---

## 13. Design Decisions

### No Gitea

Gitea was solving "how do we observe progress." The meta protocol + hooks solve this better:

| Gitea feature | Replaced by |
|---------------|-------------|
| Branch per goal | Goal record in Postgres |
| Commit observation | Meta protocol + hooks → trajectory in Postgres |
| PR for completion | Meta protocol (completed) + Stop hook gate |
| Version control | Agent uses git naturally (GitHub, etc.) |
| File persistence | Docker volume |
| Collaboration | Shared volume mount |

### Universal Desktop Image

Every agent gets the full desktop environment. No lean/sidecar split. One image, one UX. The ~500MB overhead is worth the simplicity and the product value of agents having a visible "body." See Infrastructure section for details.

### Stall Detection

Not implemented. The system collects the right signals (status, confidence, sentiment, summary, timestamps, usage) but how to reliably detect stalls requires data. A long `status: working` could be heavy compilation, deep research, or a genuine stall. Once we have enough data, we build detection that works rather than speculating about heuristics.

### Sentiment Collection

Collected from day one via the `sentiment` field. First use: dashboard heatmap showing which projects/goals cause the most friction. How it drives autonomy adjustment comes later once we can analyze aggregated data.

---

## 14. Prior Art

### ShowUI-Aloha

Their trajectory system is manual (record demo, LLM captions it, manually name and store, manually select which trace to use). We automate all of it.

**What we take:**
- Trajectory format: ordered semantic steps (`Step [N]: description`)
- Guidance injection: format past trajectory, inject into prompt
- The insight that guidance from past executions improves success

**What we don't take:**
- Manual recording and captioning (we auto-capture from meta protocol + hooks)
- Manual trace selection (we do similarity retrieval via pgvector)
- The observation/think/action/expectation 4-tuple per step (overkill for code tasks)

### AionUi

Wraps multiple CLI agents through ACP protocol. Clean typed message system.

**What's relevant:**
- PlanUpdate: entries with content + status. Mirrors our goal.plan subtasks
- ToolCallUpdate: status tracking per tool call. We get this from hooks
- Message persistence: SQLite with conversation_id. We use Postgres with goal_id
- Session resume: ACP session IDs. We resume by giving a new agent the same volume + goal

---

## 15. Emergent Properties

Things that fall out naturally from this design without extra work:

1. **Trajectory capture** -- meta protocol status + hooks on plan/tool changes
2. **Workflow extraction** -- completed plan = workflow = case
3. **Goal evolution tracking** -- `goal_changed` status = new trajectory node
4. **Replan detection** -- `goal_changed` + plan stale = trigger
5. **Collaboration** -- shared volume mount = agents see each other's files
6. **Code version control** -- agents already use git for code tasks
7. **Progress observation** -- meta protocol + GDA loop reading Postgres
8. **Agent resume after crash** -- new agent, same volume, same goal, fresh plan
9. **Cost optimization** -- usage from response envelope + casebase tells us cost per goal type
10. **Non-code goals** -- same system works for research, writing, analysis
11. **User sentiment tracking** -- `sentiment` field, no external classifier
12. **Intent classification** -- `status` field replaces external LLM classification
13. **Temporal grounding** -- `datetime` on every inbound keeps agent anchored
14. **Alignment monitoring** -- structured output compliance = health signal
15. **Stall signal collection** -- data accumulates for future detection logic

---

## 16. Open Questions

- **Plan granularity**: how detailed should subtasks be? Agent decides? System enforces?
- **Multi-agent on same goal**: how do two agents coordinate on the same plan? Split subtasks?
- **Goal hierarchies**: "Run my business" → sub-goals. How deep? Recursive goals?
- **Message prioritization**: when inbound contains both user messages and system events, how does Claude prioritize? Needs protocol guidance in CLAUDE.md
- **Embedding model selection**: which model for pgvector case retrieval? TODO -- balance quality vs cost vs latency
- **Stall detection**: how to distinguish thinking from hanging? TODO -- needs data
- **Sentiment → autonomy**: how and when sentiment drives autonomy adjustment? TODO -- needs data
- **Agent-to-agent communication**: not in v1, but how would agents coordinate directly?
- **Deployment**: decided. Railway (Django + Postgres + Redis + Dashboard) + Modal (agent compute). See IMPLEMENT.md for details
