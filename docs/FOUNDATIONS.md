# Foundations

Assumption-driven design document for Agentobox. Establishes the beliefs, constraints, and open questions that guide all product and architecture decisions.

## Axioms

Things we believe to be true. If any of these are wrong, downstream decisions need revisiting.

1. **Claude performs best when interactions match its training distribution.** Don't fight the model. The more natural the interaction, the better it performs. Design for how Claude naturally works, not how we wish it worked.

2. **Anthropic is investing in agent teams.** Claude Code's teaming feature gives each teammate a full `claude` binary invocation with its own context window, bidirectional mailbox communication, and direct user interaction via tmux pane splits. Teammates are spawned via the Task tool (with `team_name` + `name` parameters), which internally launches them with CLI flags (`--agent-id`, `--agent-name`, `--team-name`, `--agent-color`, `--parent-session-id`, `--agent-type`, `--model`). This is Anthropic's direction — aligning means we compound on their improvements.

3. **Agent collaboration is not human collaboration.** Agents share a single workspace and filesystem; humans use git and separate machines. This isn't a problem to solve — it's a different paradigm to design for. Coordination is real-time (Google Docs model) rather than async (GitHub model).

4. **Structured system prompts are natural for Claude.** Claude is trained to operate with system prompts, constitutions, and structured contracts. The boundary: stay within the scope of how Claude naturally handles instructions. Context delivered via CLAUDE.md, system prompts, and hook feedback is native. Custom tools and reporting formats are friction.

5. **Most users have poor AI literacy.** They don't know about Claude Code, don't want a CLI, don't want to download apps. A web interface that makes agent teams accessible without technical knowledge is a real product regardless of what Anthropic ships.

6. **Agent lifecycle is dynamic.** Claude's teaming spins agents up and down as needed. This is preferable to forced persistence. The system tracks what exists right now, not a permanent roster. History is preserved in session transcripts and task data.

## Principles

Decision rules derived from the axioms. When in doubt, defer to these.

1. **Extend, don't replace.** Prefer building on Claude Code's native capabilities over building parallel systems. If Claude Code does teaming, we provide infrastructure for teaming — not our own teaming logic.

2. **Show what's real.** The UI should reflect what's actually happening in the agent's world. Every agent gets an interface — but the interface matches the agent's nature: VNC desktop for computer-use agents, terminal stream for headless code agents, chat view for conversational agents.

3. **Ops layer, not brain layer.** Agentobox's value is provisioning (desktops, sandboxes), observability (what are they doing), persistence (transcripts, tasks, user signals), cost controls, and the user-facing web interface. The intelligence stays in Claude.

4. **Hooks are the control plane's signal source.** The control plane is not LLM-driven. It needs clear, structured signals to know when to update database records — agent status, session lifecycle, task progress. Native hooks (`TaskCompleted`, `TeammateIdle`, `PostToolUse`, `SessionStart/End`) provide these signals without requiring agents to report in additional formats. Transcripts capture the full conversation for the casebase.

5. **Observe native patterns, don't invent parallel ones.** Claude Code agents already use TaskCreate/TaskList/TaskUpdate natively for plans and todos. The shared task list is a structured signal source the control plane can observe without custom knowledge engineering. Prefer observing what agents already produce over requiring them to report in additional formats.

6. **Move fast, simplify aggressively.** Claude will continue to be trained on orchestration and teaming. Capabilities we build today may become native tomorrow. Don't over-invest in logic Claude will absorb. Invest in what accumulates: the casebase, the UX, and market share.

## Anthropic Product Landscape

| Product | What it is | Multi-agent? | Web UI? |
|---------|-----------|-------------|---------|
| Claude Code | CLI tool for coding | Yes (experimental Agent Teams) | No (tmux only) |
| Cowork | Desktop agent for non-coders (macOS) | No (single agent) | No (native app) |
| Computer Use | API tool for virtual desktop control | No | Streamlit demo only |
| Agent SDK | Python/TS SDK for custom agents | Supports sub-agents | No |
| Knowledge Work Plugins | 11 role-specific Cowork plugins | No | No |

As of writing, no product in Anthropic's landscape offers a web-based multi-agent dashboard. This is a market gap, not an axiom — it could close at any time.

## Resolved Questions

Decisions that have been made based on discussion and research.

- **Every agent needs a UI view.** The whole point of the product is making agent teams easier to work with than tmux. The lead agent and every team agent get displayed. The view type varies: VNC desktop (computer-use agents where humans can intervene for logins, captchas, etc.), terminal stream (headless agents), or chat (conversational agents).

- **Agent teams are dynamic, not persistent.** Claude spins team agents up and down. That's the right model. Agentobox tracks the current state, not a permanent roster. History is preserved in session transcripts and task data.

- **Computer-use agents get isolated displays.** Multiple computer-use agents on the same container get separate X displays (`Xvfb :1`, `:2`, etc.) each with its own VNC session. They share the filesystem but have isolated input/display. This prevents mouse/keyboard conflicts. Headless agents don't need a display.

- **Computer-use agents are provisioned on demand.** When a lead agent provisions a teammate with the computer-use MCP, our system detects that and attaches a virtual desktop + VNC. This makes browser-based tasks possible (web navigation, form filling, etc.) with human intervention available via the same VNC interface.

- **The casebase is the moat.** Models are getting better at execution and reasoning, but they have no memory across projects. Past sessions — what was tried, what worked, what failed — are inherently useful context that no model carries natively. Agentobox records and retrieves this context (ops). Claude reasons about it (brain). See [Casebase Design](#casebase-design).

- **The business case survives competition.** Even if Anthropic ships their own interface, a better UX, web accessibility, captured market share, and the casebase moat sustain the product.

- **The task list is a primary signal source.** Rather than inventing a parallel reporting protocol, we observe the native TaskList that agents already maintain. This gives us plan visibility, progress tracking, and completion signals — all without custom knowledge engineering.

- **The meta protocol is unnecessary.** Hooks provide lifecycle signals (`SessionStart/End`), progress signals (`TaskCompleted`, `TeammateIdle`), and complete activity logs (`PostToolUse`). Transcripts capture the full conversation including reasoning. Retrieved past sessions give agents context they wouldn't otherwise have. There is no remaining gap that requires a custom system prompt contract for structured signal emission.

- **Three data streams, no knowledge engineering.** Per-agent transcripts (`.jsonl` files, stored as-is — user messages already appear in each agent's input stream), plans + tasks (structured decompositions via TaskCompleted/TaskUpdate hooks), and user signals (periodic sentiment ratings via UI). No explicit "goal," "trajectory," or "user conversation" model needed. The casebase indexes and retrieves from these streams.

- **Agentobox's role is clear.** Sandbox provisioning, display streaming (VNC/terminal/chat), the supervisory control loop (hooks → API → exit code decisions), the casebase (session storage and retrieval), and a web UI for non-technical users. The intelligence stays in Claude. Validated by experiments: Agentobox can orchestrate directly via CLI flags or let a lead agent use the Task tool natively to spawn teammates. Both paths work.

## Casebase Design

The casebase is a design, not a validated system. Open questions about implementation are in [Open Questions > Casebase](#casebase).

**Core insight:** Models are getting better at reasoning but have no memory across projects. They struggle with meta-reasoning (which approach fits this situation?) unless explicitly prompted with relevant context. Past sessions — what was tried, what worked, what failed, how the user felt about it — are that context. The system doesn't need to do the reasoning. It needs to store and retrieve the right context so the model can.

**What it stores:** Three data streams, all captured from what already exists:

- **Transcripts** — per-agent `.jsonl` session logs, stored as-is. Each agent already produces these; `transcript_path` is provided in hook data. Each transcript is a self-contained record of that agent's perspective — its input (user messages or teammate delegations), its responses, its tool calls, and hook events. The human's messages already appear in whichever agent received them (typically the lead). No separate "user conversation" capture needed — each agent's input stream contains everything. To reconstruct the full picture for a team, query all transcripts where `teamName` matches.
- **Plans + Tasks** — structured task decompositions with dependencies, status transitions, and ownership. Captured via `TaskCreate`/`TaskUpdate`/`TaskCompleted` hooks. Separating these from transcripts gives clean structured data about what was planned vs. what was executed.
- **User signals** — periodic sentiment ratings (bad/ok/great) collected via UI prompts at natural checkpoints. A time series of how the user thinks things are going — like Claude Code's built-in feedback prompt. This is the outcome data.

No abstraction step. No pattern extraction. No knowledge engineering. Capture what already exists, plus a simple user sentiment prompt.

**The pipeline:**

```
CAPTURE (continuous — already happening)
│
│  SessionEnd / SubagentStop hooks → backend stores transcripts
│  TaskCreate / TaskUpdate / TaskCompleted hooks → backend stores plan + task data
│  No new data formats — just collect what Claude Code already produces
│
▼
USER SIGNALS (periodic, via UI)
│
│  UI prompts: "How's it going?" → bad / ok / great
│  Stored as time series tied to the project
│  This IS the outcome data — no binary success/fail label needed
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
│  Surface as native context (CLAUDE.md, system prompt, hook feedback):
│    "Similar past projects: [summaries]. What worked: X. What failed: Y."
│  Claude does the reasoning about what to do with this.
│
▼
CAPTURE (loop closes)
│
│  New project completes → new sessions stored → corpus grows
```

**Why not build an abstraction layer?** The earlier version of this design had a pattern extraction step — generalize cases into reusable "patterns" with "signal vocabularies" and "meta-signals." This is knowledge engineering. It assumes we need to pre-digest sessions into structured reasoning artifacts. But:

1. Models are already good at reasoning over raw examples when prompted with them. "Here's what happened last time in a similar project" is sufficient context.
2. Any abstraction we build will be worse than what future models can do on-the-fly from raw data.
3. It creates unsolved problems (how to abstract, how to define signal vocabularies, how to detect divergence) that block shipping.
4. The raw corpus is more valuable than processed patterns — it doesn't lose information and gets more useful as models improve.

If abstraction becomes valuable later (e.g., corpus too large for context windows, retrieval precision needs help), it can be added as a layer on top. Starting with raw storage + retrieval is the simplest thing that could work.

**Delivery mechanism:** Native context (CLAUDE.md, system prompts, hook feedback), not custom tools. The casebase surfaces past sessions into context agents already know how to consume. Think of it like hints — lightweight context injection at the right moment, not an orchestration engine.

**What makes this different from RAG:** Traditional RAG retrieves documents (how-tos, API docs). The casebase retrieves *what actually happened* in similar projects — the sessions, not the theory. It doesn't answer "how do I build X" (agents know that). It answers "here's what happened last time someone built something like X, including where they got stuck and how the user felt about it."

**Self-improving:** More projects → more session data + user signals → better retrieval matches → more useful context for agents → better outcomes → better data. The moat is the corpus. As models get better at reasoning over examples, the same corpus becomes more valuable without us doing anything.

## Open Questions

Things we need to answer before committing. Ordered roughly by impact.

### Visualization

- **How do we visualize project history?** Session transcripts + git diffs provide the raw data. The UI should show what agents did over time. This is a timeline problem — what happened, when, and what the outcome was.

### Casebase

- **How do we summarize transcripts for retrieval?** Full transcripts are too large to embed or inject as context. What's the right summarization — per-task, per-session, or something else? How much context is useful before it becomes noise? Implementation detail, but determines retrieval quality.

### Agent Teams & Display

- **How do we detect agent type (computer-use vs. headless)?** If a team agent has computer-use MCP, we attach a display. Need to understand how to observe MCP provisioning events — possibly via `PostToolUse` hooks or by watching the agent's tool list.

- **How do we stream tmux sessions to the web UI?** For headless agents, we need a terminal stream from their tmux session to the browser. Options: tmux capture-pane polling, terminal-to-websocket bridges, or ttyd/gotty-style tools.

### Provisioning & Resources

- **What bounds resource usage?** Agents spinning up team agents = potential runaway. Need cost ceilings per project, spawn limits, and token budgets. This is critical infrastructure.

## Hypotheses

Testable predictions. Validated hypotheses are moved to Resolved Questions.

### Validated

1. **The native task list provides sufficient signal for the control plane.** Validated in Experiments 7 & 8. `TaskCompleted` hook provides task_id, subject, description, teammate_name, team_name. `PostToolUse` on `TaskUpdate` shows dependency setup. `TeammateIdle` signals availability. No meta protocol needed.

2. **Claude Code's native teaming outperforms custom orchestration.** Partially validated. Native teaming (mailbox, shared task list, CLI spawn interface) provides more than enough primitives. Agentobox's role is ops layer (provisioning, observability, casebase), not orchestration.

### Open

3. **Dynamic desktop provisioning is viable at team scale.** Test: measure sandbox spin-up time and cost for on-demand VNC desktops with separate X displays. If it's under 30s and affordable, computer-use team agents become a real feature.

4. **Retrieved past sessions improve agent performance.** Test: compare agent performance on similar tasks with vs. without retrieved session context. If agents with "here's what happened last time" context make fewer mistakes or finish faster, the casebase thesis is validated.

5. **Session summaries fit usefully in context windows.** Test: summarize a completed project's sessions at different granularities. Is there a summary length that's both small enough to inject as context and detailed enough to be useful?

## References

- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams) — official docs on teaming, display modes, team config, mailbox
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — hook event types, matcher syntax, stdin JSON schema
- [Claude Code Hooks guide](https://code.claude.com/docs/en/hooks-guide) — patterns, examples, decision control
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — agent teams tmux fix, TeammateIdle/TaskCompleted hooks
- [Anthropic Cowork](https://www.anthropic.com/products/cowork) — single-agent macOS desktop app
- [Computer Use API](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) — API tool for virtual desktop control
