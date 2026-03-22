# Foundations

Assumption-driven design document for Agentobox. Establishes the beliefs, constraints, and open questions that guide all product and architecture decisions.

## Product Vision

Agentobox is a managed agent workflow platform with real desktop environments. The core insight: containerized Xvfb + AwesomeWM + Firefox + VNC solves a concrete problem — running AI agents that need real browsers at scale. Headless browsers (Puppeteer, Playwright) get fingerprinted and blocked. Real X11 displays with real window managers dont.

The product surface is **workflows** — pre-configured team templates targeting specific audiences. Same infra underneath, different front door per audience. Users pick a workflow, it populates agent configs + instructions + schedule, results flow to the dashboard feed.

### Target Audiences

| Audience | Workflows |
|----------|-----------|
| SEO agencies | AI Overview monitoring, keyword tracking, citation tracking |
| Ecommerce | Competitor price monitoring, product research, review aggregation |
| Market research | Competitive intelligence, trend tracking |
| Data collection | Any use case needing human-like browser agents at scale |
| Recruiting / sales | Lead enrichment, prospect research |
| AI coding teams | Multi-agent coding workflows (dogfooding use case) |

### Key Differentiators

- **Real desktop per container.** X11 display + real Firefox + real window manager. Not headless Puppeteer that every bot detector flags.
- **Observable via VNC.** Humans can watch, intervene (logins, captchas), and verify.
- **Containerized for parallel execution.** Spin up N agents, each with their own isolated display.
- **Two-loop architecture.** Mechanical loop handles the 90% thats boring (polling, diffing, trigger evaluation). Agent loop handles the 10% that needs a brain.

### Market Context

Google AI Overviews appear in ~55% of searches and have NO official API. The only way to access them at scale is browser automation with real browsers. Third-party scraping APIs (SerpApi, SearchAPI) are doing browser automation underneath and charging per request. Agentobox provides the infrastructure to do this directly.

## Axioms

Things we believe to be true. If any of these are wrong, downstream decisions need revisiting.

1. **The browser is the universal interface.** Email? Open Gmail in Firefox. Slack? Open it in Firefox. Any SaaS tool? Browser. No plugin system, no integrations API, no per-service adapters. The agent uses the same interface a human would, observed via VNC.

2. **Two loops, not one.** Most workflow steps are mechanical — check if a price changed, poll for new data, evaluate a condition. These dont need an LLM. The expensive agent loop should only fire when something requires intelligence. Separating these is the difference between burning $50/day and $2/day.

3. **Events are the universal primitive.** Triggers fire events. Agents produce events. Notifications are events with side effects. The dashboard renders events. State is the latest event. History is events filtered by time. One primitive, many views.

4. **Claude performs best when interactions match its training distribution.** Dont fight the model. Design for how Claude naturally works, not how we wish it worked.

5. **Anthropic is investing in agent teams.** Claude Code's teaming feature gives each teammate a full `claude` binary invocation with its own context window, bidirectional mailbox communication, and direct user interaction. Aligning with Anthropic's direction means we compound on their improvements.

6. **Agent collaboration is not human collaboration.** Agents share a single workspace and filesystem. Coordination is real-time (Google Docs model) rather than async (GitHub model). This isnt a problem to solve — its a different paradigm to design for.

7. **Most users have poor AI literacy.** They dont know about Claude Code, dont want a CLI, dont want to download apps. A web interface that makes agent workflows accessible without technical knowledge is a real product.

## Principles

Decision rules derived from the axioms. When in doubt, defer to these.

1. **Ops layer, not brain layer.** Agentobox's value is provisioning (desktops, sandboxes), observability (what are they doing), the mechanical loop (triggers, scheduling), cost controls, and the web interface. The intelligence stays in Claude.

2. **The agent IS the workflow engine.** No n8n-style visual DAG editor. No state machine DSL. No precondition engine. The LLM plans the steps. The platform provides triggers (when to run), context (what to work on), and output capture (what happened).

3. **Three primitives, no more.** The whole platform reduces to: **State** (latest agent output as JSON), **Trigger** (condition evaluated by the mechanical loop — cron, webhook, or state diff), **Agent** (containerized desktop with instructions). Everything else is a view on these three.

4. **Show what's real.** The UI reflects whats actually happening. Every agent gets a view matching its nature: VNC desktop for browser agents, terminal stream for headless agents. Human intervention available via the same VNC interface.

5. **Extend, dont replace.** Build on Claude Code's native capabilities over building parallel systems. If Claude Code does teaming, provide infrastructure for teaming — not our own teaming logic.

6. **Hooks are the control plane's signal source.** The control plane is not LLM-driven. Native hooks (`TaskCompleted`, `TeammateIdle`, `PostToolUse`, `SessionStart/End`) provide structured signals without requiring agents to report in additional formats.

7. **Move fast, simplify aggressively.** Capabilities we build today may become native tomorrow. Dont over-invest in logic Claude will absorb. Invest in what accumulates: workflows, market share, the casebase.

## What NOT to Build

Explicit anti-patterns to prevent scope creep.

- **No visual DAG editor.** The agent IS the workflow engine. The LLM plans the steps.
- **No state machine DSL or precondition engine.** Triggers are simple conditions evaluated by the mechanical loop.
- **No per-service UI components.** No email composer, no SMS sender. The browser IS the universal interface — the agent opens Gmail in Firefox, you watch via VNC.
- **No plugin/extension system for effects.** Small fixed set: notify (slack/email/webhook), wake_agent, update_state. Maybe 5-6 total.

## Anthropic Product Landscape

| Product | What it is | Multi-agent? | Web UI? |
|---------|-----------|-------------|---------|
| Claude Code | CLI tool for coding | Yes (experimental Agent Teams) | No (tmux only) |
| Cowork | Desktop agent for non-coders (macOS) | No (single agent) | No (native app) |
| Computer Use | API tool for virtual desktop control | No | Streamlit demo only |
| Agent SDK | Python/TS SDK for custom agents | Supports sub-agents | No |
| Knowledge Work Plugins | 11 role-specific Cowork plugins | No | No |

No product in Anthropic's landscape offers a web-based managed workflow platform with real desktop environments. This is a market gap, not an axiom — it could close at any time.

## Resolved Questions

Decisions that have been made based on discussion and research.

- **Every agent needs a UI view.** VNC desktop for computer-use agents (humans can intervene for logins, captchas), terminal stream for headless agents, chat for conversational agents.

- **Agent teams are dynamic, not persistent.** Claude spins team agents up and down. Agentobox tracks the current state, not a permanent roster. History is preserved in session transcripts and task data.

- **Computer-use agents get isolated displays.** Multiple agents on the same container get separate X displays (`Xvfb :1`, `:2`, etc.) with isolated input/display. Headless agents dont need a display.

- **The casebase is the moat.** Models have no memory across projects. Past sessions — what was tried, what worked, what failed — are inherently useful context. Agentobox records and retrieves this context (ops). Claude reasons about it (brain). See [Casebase Design](#casebase-design).

- **The task list is a primary signal source.** Observe the native TaskList agents already maintain rather than inventing a parallel reporting protocol. Plan visibility, progress tracking, and completion signals without custom knowledge engineering.

- **The meta protocol is unnecessary.** Hooks provide lifecycle signals, progress signals, and complete activity logs. Transcripts capture full conversation including reasoning. No custom system prompt contract needed.

- **Three data streams, no knowledge engineering.** Per-agent transcripts (`.jsonl` stored as-is), plans + tasks (structured via hooks), and user signals (periodic sentiment ratings via UI).

- **Workflows are templates, not programs.** A workflow populates agent configs, instructions, schedule, and trigger conditions. It does NOT define execution steps — thats the agent's job. Workflows are a UX concept (which audience, which use case), not an execution concept.

## Casebase Design

The casebase is a design, not a validated system. Open questions about implementation are in [Open Questions > Casebase](#casebase).

**Core insight:** Models are getting better at reasoning but have no memory across projects. They struggle with meta-reasoning unless explicitly prompted with relevant context. Past sessions — what was tried, what worked, what failed, how the user felt about it — are that context. The system stores and retrieves the right context so the model can reason.

**What it stores:** Three data streams, all captured from what already exists:

- **Transcripts** — per-agent `.jsonl` session logs, stored as-is. Each agent already produces these; `transcript_path` is provided in hook data.
- **Plans + Tasks** — structured task decompositions with dependencies, status transitions, and ownership. Captured via `TaskCreate`/`TaskUpdate`/`TaskCompleted` hooks.
- **User signals** — periodic sentiment ratings (bad/ok/great) collected via UI prompts at natural checkpoints.

No abstraction step. No pattern extraction. No knowledge engineering. Capture what already exists, plus a simple user sentiment prompt.

**The pipeline:**

```
CAPTURE (continuous — already happening)
│
│  SessionEnd / SubagentStop hooks → backend stores transcripts
│  TaskCreate / TaskUpdate / TaskCompleted hooks → backend stores plan + task data
│
▼
USER SIGNALS (periodic, via UI)
│
│  UI prompts: "How's it going?" → bad / ok / great
│  Stored as time series tied to the project
│
▼
INDEX (for retrieval)
│
│  Summarize + embed transcripts for similarity search
│  Features: project description, task types, file patterns, tools used
│
▼
RETRIEVE & DELIVER (for new projects)
│
│  At key moments (SessionStart, TaskCompleted, TeammateIdle):
│  Query: "similar past sessions"
│  Surface as native context (CLAUDE.md, system prompt, hook feedback)
│  Claude does the reasoning about what to do with this.
│
▼
CAPTURE (loop closes)
│
│  New project completes → new sessions stored → corpus grows
```

**Self-improving:** More projects → more session data + user signals → better retrieval matches → more useful context for agents → better outcomes → better data. The moat is the corpus.

## Open Questions

Things we need to answer before committing. Ordered roughly by impact.

### Workflows

- **What does a workflow template schema look like?** It needs to express: which agents, what instructions, what triggers (cron/webhook/state-diff), what model, what MCP servers. Needs to be simple enough that adding a new workflow is config, not code.

- **How do we price workflows?** Per-agent-minute? Per workflow run? Flat monthly per workflow? The two-loop split matters here — mechanical loop is cheap compute, agent loop is expensive LLM inference + container time.

### Mechanical Loop

- **Where does the mechanical loop run?** Modal cron functions in prod, management command locally. Need to define the trigger evaluation contract — what conditions are supported, how state diffs are expressed.

- **How do we handle trigger fan-out?** One trigger might need to wake multiple agents or fire multiple effects. Need to decide: sequential or parallel, what happens on partial failure.

### Visualization

- **How do we visualize workflow history?** Session transcripts + state snapshots provide raw data. The UI should show what happened per workflow run — trigger fired, agent woke, results produced, state updated.

### Casebase

- **How do we summarize transcripts for retrieval?** Full transcripts are too large to embed. What granularity — per-task, per-session? Implementation detail, but determines retrieval quality.

### Provisioning & Resources

- **What bounds resource usage?** Agents spinning up = potential runaway. Need cost ceilings per project, spawn limits, and token budgets.

## Hypotheses

Testable predictions. Validated hypotheses are moved to Resolved Questions.

### Validated

1. **The native task list provides sufficient signal for the control plane.** Validated in Experiments 7 & 8. `TaskCompleted` hook provides task_id, subject, description, teammate_name, team_name. No meta protocol needed.

2. **Claude Code's native teaming outperforms custom orchestration.** Partially validated. Native teaming provides more than enough primitives. Agentobox's role is ops layer, not orchestration.

### Open

3. **Dynamic desktop provisioning is viable at team scale.** Test: measure sandbox spin-up time and cost for on-demand VNC desktops with separate X displays. If under 30s and affordable, computer-use team agents are a real feature.

4. **Retrieved past sessions improve agent performance.** Test: compare agent performance on similar tasks with vs. without retrieved session context.

5. **The mechanical loop handles 90% of workflow steps without LLM.** Test: implement a price-monitoring workflow. Measure what percentage of checks result in no change (mechanical loop handles) vs. meaningful change (agent needed).

6. **Real browsers avoid detection at scale.** Test: run the same scraping task with headless Playwright vs. real Firefox in Xvfb. Compare block rates across major sites.

## References

- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams) — official docs on teaming, display modes, team config, mailbox
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — hook event types, matcher syntax, stdin JSON schema
- [Claude Code Hooks guide](https://code.claude.com/docs/en/hooks-guide) — patterns, examples, decision control
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — agent teams tmux fix, TeammateIdle/TaskCompleted hooks
- [Anthropic Cowork](https://www.anthropic.com/products/cowork) — single-agent macOS desktop app
- [Computer Use API](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) — API tool for virtual desktop control
