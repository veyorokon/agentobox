# Foundations

Assumption-driven design document for Agentobox. Establishes the beliefs, constraints, and open questions that guide all product and architecture decisions.

## Axioms

Things we believe to be true. If any of these are wrong, downstream decisions need revisiting.

1. **Claude performs best when interactions match its training distribution.** Don't fight the model. The more natural the interaction, the better it performs. Design for how Claude naturally works, not how we wish it worked.

2. **Anthropic is investing in agent teams.** Claude Code's teaming feature (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) gives each teammate a full `claude` binary invocation with its own context window, bidirectional mailbox communication, and direct user interaction via tmux pane splits. Teammates are spawned via CLI flags (`--agent-id`, `--agent-name`, `--team-name`, `--agent-color`, `--parent-session-id`, `--agent-type`, `--model`). This is Anthropic's direction — aligning means we compound on their improvements.

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

## Research Findings

What we've learned from reading Claude Code's source and Anthropic's public products.

### Claude Code Agent Teams Architecture

- **Agent definition:** Markdown files with YAML frontmatter (`name`, `description`, `model`, `color`, `tools`, `memory`).
- **Spawning:** Natural language triggers via the Task tool. Parent decides to invoke agents based on description matching.
- **Sessions:** Each agent gets its own tmux session. Bidirectional communication with parent and peers.
- **Tool restriction:** `tools` frontmatter field limits agent capabilities. `Task(agent-type)` syntax controls which agents can spawn others.
- **Memory:** Persistent memory with `user`, `project`, or `local` scope (v2.1.33+).
- **MCP access:** MCP tools are automatically available to all team agents once registered at plugin/project level.
- **Hooks:** `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreCompact`, `Notification`, `TeammateIdle`, `TaskCompleted`.
- **Team-specific hooks:** `TeammateIdle` (agent becomes idle) and `TaskCompleted` (agent finishes a task) enable multi-agent workflow automation.
- **Shared task list:** Agents use TaskCreate/TaskList/TaskUpdate natively. This is a built-in coordination mechanism.

### Anthropic Product Landscape

| Product | What it is | Multi-agent? | Web UI? |
|---------|-----------|-------------|---------|
| Claude Code | CLI tool for coding | Yes (experimental Agent Teams) | No (tmux only) |
| Cowork | Desktop agent for non-coders (macOS) | No (single agent) | No (native app) |
| Computer Use | API tool for virtual desktop control | No | Streamlit demo only |
| Agent SDK | Python/TS SDK for custom agents | Supports sub-agents | No |
| Knowledge Work Plugins | 11 role-specific Cowork plugins | No | No |

As of writing, no product in Anthropic's landscape offers a web-based multi-agent dashboard. This is a market gap, not an axiom — it could close at any time.

### Key Integration Points for Agentobox

- **Hooks** are our primary observation channel. `SessionStart`, `PostToolUse`, `TeammateIdle`, `TaskCompleted` give us lifecycle signals without requiring custom reporting.
- **Shared task list** (TaskCreate/TaskList/TaskUpdate) is already structured data agents produce. Observing it gives us plan/progress visibility natively.
- **tmux sessions** are how agents get interactive terminals. We can attach to or stream these for the terminal view in the UI.
- **MCP provisioning** is how agents get capabilities. If we expose desktop provisioning as an MCP tool, agents can self-serve computer-use environments.

### Injection Points & Supervisory Control Loop

Agentobox's control plane integrates with Claude Code through hooks that act as a **supervisory control loop** — observing agent state and injecting context/decisions at key moments. The hook script calls the Agentobox backend API, which has session context and casebase access, and returns either exit code 0 (allow) or exit code 2 (feedback + continue).

This is the evolution of two prior patterns:
- **Claude Code's native hook feedback** — simple shell scripts returning exit code 2 to keep agents working (e.g., `quality-gate.sh`)
- **Multi-agent-swarm plugin** — community pattern that predated native agent teams, using a coordinator process + markdown state files + `tmux send-keys` for IPC. Agentobox replaces the coordinator with a database-backed API, markdown files with the casebase, and shell IPC with structured hook payloads.

**Injection points by lifecycle phase:**

| Phase | Hook | Possible injections | Mechanism |
|-------|------|----------------------|-----------|
| **Agent startup** | `SessionStart` | Initial context, casebase retrieval | Write to `CLAUDE_ENV_FILE` path provided in hook data. Can set env vars the agent session will read. |
| **Before tool use** | `PreToolUse` | Permission decisions, guardrails, cost controls | Return JSON with `permissionDecision: "allow\|deny"` and `additionalContext` |
| **After tool use** | `PostToolUse` | Activity logging, progress tracking, anomaly detection | Log to backend. Can return `decision: "block"` with reason to halt. |
| **Task completed** | `TaskCompleted` | Next task assignment, casebase conditioning, quality checks | Return exit code 2 + feedback with retrieved cases. Exit 0 to accept completion. |
| **Agent idle** | `TeammateIdle` | New work assignment, or allow idle | Query backend for pending tasks. Exit 2 + next task description, or exit 0. |
| **Agent stopping** | `Stop` | Prevent premature shutdown, request continuation | Exit 2 + reason to keep going, or exit 0 to allow stop. |
| **Direct tmux input** | N/A (not a hook) | Commands, prompts, or context sent as if user typed them | `tmux send-keys` to pane — bypasses mailbox, acts as user input. |
| **Mailbox message** | Via `SendMessage` tool | Observable inter-agent communication | Observed in `PostToolUse` on `SendMessage`. Can also be initiated by spawning agents with matching `--parent-session-id`. |

These are capabilities the hook system exposes — not commitments. Which injection points Agentobox actually uses depends on the architecture decisions that follow from these experiments.

**Casebase retrieval flow (example):**

```
TaskCompleted fires
  → Hook calls Agentobox API: POST /hooks/task-completed {task_id, subject, description, teammate_name}
  → Backend queries casebase: "similar past projects at this stage"
  → Backend checks task list: "are there remaining tasks?"
  → If more work + relevant past sessions found:
      Return exit code 2 + "Next task: X. Context from similar projects: [summary]"
  → If done:
      Return exit code 0 (allow completion)
```

**Key design constraint:** Hook scripts must be fast (default timeout 600s, but latency matters). The Agentobox API endpoint needs to respond quickly — pre-compute retrieval results, cache recent queries.

### Agent Teams: Two Display Modes (CORRECTED after Experiment 1 + Official Docs)

Initial research conflated native agent teams with a community plugin pattern. After running Experiment 1 and reading the official docs at [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams), the full picture:

**Native Agent Teams has two display modes:**

**In-process mode** (default when NOT in tmux):
- All teammates run inside the same terminal/process
- Shift+Up/Down to select a teammate, Enter to view, Escape to interrupt
- Single tmux session, single pane — teammates are concurrent API calls
- This is what Experiment 1 observed

**Split-pane mode** (`teammateMode: "tmux"` or `--teammate-mode tmux`):
- Each teammate gets its own tmux pane (or iTerm2 pane)
- You see everyone's output simultaneously and click into a pane to interact
- Auto-detected if already inside a tmux session (`teammateMode: "auto"` is the default)
- "Orphaned tmux sessions" is a documented known issue — confirms real tmux sessions are created
- **This is the mode relevant to Agentobox** — gives us observable, separate sessions per agent

**Architecture (from official docs):**

| Component | Role |
|-----------|------|
| **Team lead** | Main Claude Code session that creates team, spawns teammates, coordinates |
| **Teammates** | Separate Claude Code instances, each in its own context window |
| **Task list** | Shared, stored at `~/.claude/tasks/{team-name}/`. File-locking prevents race conditions |
| **Mailbox** | Messaging system. Messages deliver automatically, no polling needed |
| **Team config** | `~/.claude/teams/{team-name}/config.json` — members array with name, agent ID, type |

**Key behaviors:**
- Teammates load CLAUDE.md, MCP servers, and skills — but NOT the lead's conversation history
- Lead has **delegate mode** (Shift+Tab) — restricts lead to coordination-only (spawn, message, shutdown, tasks)
- Teammates can message each other directly (not just report to lead)
- No nested teams — teammates can't spawn their own teams
- One team per session
- Permissions inherited from lead at spawn time
- `TeammateIdle` hook: runs when teammate goes idle, exit code 2 sends feedback and keeps them working
- `TaskCompleted` hook: runs when task marked complete, exit code 2 prevents completion with feedback

**Multi-agent swarm plugin (separate community pattern):**
- Found in Claude Code repo's plugin examples — predates native agent teams
- Separate `claude` processes in separate tmux sessions
- Coordination via `tmux send-keys -t "$COORDINATOR_SESSION"` and markdown state files
- Different from native agent teams — this is manual orchestration via shell hooks

**Implication for Agentobox:** Split-pane mode (`teammateMode: "tmux"`) is the target. Each teammate becomes an observable tmux pane with its own terminal. Team config and task list are stored as files we can watch. The mailbox system means agents communicate automatically. (Validated in Experiments 3-6.)

### Testing Toolchain

**tmux MCP (`nickgnd/tmux-mcp`):**
- Installed for programmatic tmux control — create sessions, send commands, capture output, list sessions/windows/panes.
- Evaluated against `michael-abdo/tmux-claude-mcp-server` (custom orchestration, violates Principle 1) and `Ilm-Alan/claude-tmux` (similar). Chose nickgnd because it's the thinnest layer — observes without opinions.
- Useful for observing native teams via pane capture and driving headless agent sessions.

### Experiment 1: Native Agent Teams on Scratch Project

**Setup:** Created `/tmp/agentobox-test` with a simple Express CRUD API task (4 files: data layer, routes, tests, server). Launched Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in a tmux session.

**Prompt:** "Read the README.md. Build everything described there. Use agent teams to parallelize the work — have separate agents handle the data layer, the API routes, the tests, and the server entry point."

**Observations:**

1. **No separate tmux sessions.** Only ever 1 session, 1 window, 1 pane throughout. Confirmed via `list-sessions`, `list-windows`, `list-panes` during and after execution.

2. **4 named agents spawned in-process:** `@data-layer`, `@api-routes`, `@server`, `@tests`. Displayed as a tree under "4 agents launched" in the parent's terminal. Status bar showed active agent context (e.g., `@main @server`).

3. **Task list with dependencies** was the coordination mechanism. Tasks created with blocking relationships (routes blocked by data-layer, tests blocked by all three).

4. **Parent polled for completion.** The parent agent ran `ls` and `sleep` commands to check if sub-agents had created their files. No push notification from sub-agents — it was polling-based.

5. **No `.claude/` state files created.** No markdown frontmatter files, no swarm state. All coordination was in-process memory.

6. **Graceful shutdown.** "3 teammates shut down gracefully" followed by final `@server` cleanup. Parent managed the full lifecycle.

7. **Agent completion messages** visible in terminal: `@server❯ Express server entry point created`, `@api-routes❯ Task routes created successfully`.

8. **Results:** All 4 files created, 7/7 Jest tests passing. Total time ~1m 53s.

9. **Prompt submission note:** rawMode `execute-command` typed the prompt text but didn't submit it. Required a separate `noEnter: true` send of `Enter` key to actually submit to Claude Code's input.

**Key takeaway:** Experiment ran in-process mode (the default) because the tmux session was detached (created via MCP, never attached). To get split-pane mode, Claude Code likely needs an attached tmux client.

**Also discovered:** Task list stored at `~/.claude/tasks/{uuid}/` but only contains `.highwatermark` (counter) and `.lock` — no rich task data as files. Team config at `~/.claude/teams/` was not created (either cleaned up or not used in in-process mode). The mailbox system delivers messages automatically (no polling per docs).

### Experiment 2: Split-Pane Mode Attempt

**Setup:** Same scratch project, fresh start. Launched Claude Code with explicit `--teammate-mode tmux` flag inside a tmux session created via MCP.

**Prompt:** Same as Experiment 1.

**Result:** Still ran in-process mode. 4 agents (`@data-layer`, `@api-routes`, `@server-entry`, `@test-writer`), same single pane, 6/6 tests passing, ~1m 44s.

**Why split-pane didn't activate:**
1. **Detached session.** The tmux session was created via MCP and never had an attached client. `tmux split-window` requires an attached client to know window dimensions. No client = split fails = fallback to in-process.
2. **Permission delay.** User was away for ~5 min when a permission prompt appeared. The timeout may have caused Claude Code to fall back.

**Architectural implication for Agentobox:** In containerized deployments, Claude Code is launched headless by the backend — there's no attached tmux client unless someone is VNC'd in with a terminal. This means **in-process mode may be the default in production containers.** Split-pane mode would require either:
- A dummy attached client (script that attaches to the session)
- Running Claude Code from within a desktop terminal in the VNC session
- Or accepting in-process mode and observing via pane capture + file watching

### Experiment 3: Split-Pane Mode Confirmed

**Setup:** Same scratch project. User manually created and attached to tmux session: `tmux new-session -s exp3 -c /tmp/agentobox-test`. Launched Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --dangerously-skip-permissions --teammate-mode tmux`.

**Prompt:** Same 4-agent build task as Experiments 1 & 2.

**Result:** Split-pane mode activated. 4 agents spawned with visible tmux pane splits. 6/6 tests passing, ~2m 24s. Panes were cleaned up when agents shut down — by the time we could observe via MCP, all panes had collapsed back to 1.

**What confirmed it:**
- User visually saw split panes during execution
- Status bar showed `@main @helper · shift+↑ to expand · 1 teammate` (teammate count visible)
- Agents displayed with `shift+↑ to manage` hint (split-pane UI, not in-process shift+Up/Down)

**Key finding:** Split-pane requires an **attached** tmux client. Experiments 1 & 2 used detached sessions (created via MCP) → fell back to in-process. Experiment 3 had user attached → split-pane worked.

### Experiment 4: Live Teammate Inspection

**Setup:** Immediately after Experiment 3, in the same session. Asked Claude to spawn one teammate and keep it alive for inspection.

**Prompt:** "spawn one teammate agent for now split pane and keep it alive until i tell u to kill it"

**Result:** Split pane created. Lead on left (`%0`), teammate `@helper` on right (`%5`). Both captured live via tmux MCP.

**The spawn command** (visible in the teammate's pane — this is the full CLI contract):

```
cd /private/tmp/agentobox-test && \
CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
/Users/veyorokon/.local/share/claude/versions/2.1.37 \
  --agent-id helper\@standby \
  --agent-name helper \
  --team-name standby \
  --agent-color blue \
  --parent-session-id c30b2d37-e14b-43a5-9661-a5e719d30edc \
  --agent-type general-purpose \
  --dangerously-skip-permissions \
  --model claude-opus-4-6
```

**Observations:**

1. **Each teammate is a full `claude` binary invocation.** Not a sub-process or lightweight worker. Own welcome screen, own prompt, own model, own context window.

2. **CLI flags define the teammate contract:**
   - `--agent-id helper\@standby` — unique ID with state hint (`@standby`)
   - `--agent-name helper` — display name
   - `--team-name standby` — team namespace
   - `--agent-color blue` — UI color for the pane badge
   - `--parent-session-id` — links back to lead session (UUID)
   - `--agent-type general-purpose` — agent type (suggests extensibility)
   - `--model claude-opus-4-6` — model selection per teammate

3. **Bidirectional mailbox.** Lead sees `@helper> Helper agent ready for tasks`. Helper sees `@team-lead>` prefixed messages. Automatic delivery, no polling.

4. **Standard tmux pane split.** Single session, single window, two panes. No extra sessions or windows created. Pane titles: `✳ Teammate Agent` (lead) and `✳ Claude Code` (helper).

5. **Environment variables set:** `CLAUDECODE=1` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` propagated to teammate.

6. **Teammate has full Claude Code UI.** Welcome screen, tip about `/init`, bypass permissions status bar, `@helper` badge.

7. **Lead status bar evolves.** Shows `@main @helper · shift+↑ to expand · 1 teammate · ctrl+t to hide tasks`.

**Architectural implications for Agentobox:**

- **Programmatic spawning is possible.** The CLI flags are the complete interface. Agentobox's backend could spawn teammates by invoking the `claude` binary with these flags, without going through the lead agent's UI.
- **`--parent-session-id` is the coordination key.** This UUID links all teammates to their lead. The backend can track team membership via this.
- **In containers without an attached client**, we'd need a workaround for split-pane mode (virtual attached client, or accept in-process mode and observe via hooks + task list).
- **The `--agent-type` flag** suggests Claude Code may support specialized agent types beyond `general-purpose` in the future. Watch this.

### Experiment 5: Cross-Process Mailbox Communication

**Setup:** With Experiment 4's lead + helper still alive in exp3 (window @0), created a new tmux window (@1) and manually spawned a standalone `tester` agent using the same `--parent-session-id` and `--team-name` — but NOT through the lead agent.

**Spawn command (run directly, not by lead):**
```
claude --agent-id tester@standby --agent-name tester --team-name standby \
  --agent-color green --parent-session-id c30b2d37-e14b-43a5-9661-a5e719d30edc \
  --agent-type general-purpose --dangerously-skip-permissions --model claude-opus-4-6
```

**Also tested:** Sending a command directly to the helper's tmux pane via MCP (`execute-command` with rawMode + Enter). Helper received and executed it — listed directory contents.

**Results:**

1. **Standalone tester launched successfully** with `@tester` badge. But no `@team-lead>` greeting — it didn't receive an initial prompt from the lead (because the lead didn't spawn it).

2. **Mailbox works across independently spawned processes.** Told tester "send a message to @helper saying hello from tester" → tester showed `"Message sent to helper"` → helper received `@tester> Greeting from tester to helper` and replied → tester received `@helper> Greeting back to tester`.

3. **The lead detected the rogue teammate.** Lead's pane showed: *"Heads up — a tester agent just appeared and messaged helper. I didn't spawn it. Want me to look into where it came from, or ignore it?"* — Awareness of unauthorized team joins is built in.

4. **Direct tmux input to teammates works.** Sent "list the files in this directory" to the helper's pane via tmux MCP. Helper executed the command, listed files, and reported back to the lead via mailbox.

**Key findings:**

- **Mailbox is keyed on `--parent-session-id`**, not routed by the lead process. Any `claude` process with the matching session ID can join the team and communicate. This is file/IPC-based, not in-memory.
- **Agentobox can be the orchestrator.** The backend can spawn teammates directly using CLI flags without a lead agent, or use a lightweight lead. No need to go through the lead's UI.
- **Two control paths exist:** (a) via the lead's mailbox (natural language delegation) or (b) direct tmux input to teammate panes (bypasses mailbox, sends commands as if the user typed them).
- **The lead has teammate awareness** — it detects new teammates it didn't spawn. This is a security/coordination feature to be aware of.

### Experiment 6: Headless Split-Pane + Leadless Team Communication

**Setup:** No user-attached terminal. Created tmux session with forced dimensions: `tmux new-session -d -s headless -x 200 -y 50`. Generated a fake UUID (`7e7ec72b-f68a-4fb1-9642-f7026bbf5bcb`) not belonging to any Claude Code session.

**Test 1 — Headless split-pane:**
- Launched Claude Code with `--teammate-mode tmux` in the detached session
- Asked it to spawn a teammate → **split-pane activated**. Two panes created (lead + watcher)
- The fix for Experiments 1 & 2: `-x 200 -y 50` gives tmux the dimensions it needs for `split-window`, even without an attached client

**Test 2 — Leadless team:**
- Killed the headless session, created a fresh one
- Manually spawned two agents (`alpha` and `beta`) in separate panes using the fake UUID as `--parent-session-id`. No lead agent.
- Told alpha (via tmux input): "send a message to @beta saying hello from alpha, can you read the README.md and tell me what it says?"
- **Result: full round-trip communication.** Alpha sent → beta received (`@alpha> Hello from alpha`), beta read README.md, beta responded → alpha received (`@beta> README describes Task Tracker REST API`). Complete mailbox exchange with a made-up UUID.

**Key findings:**

1. **Headless split-pane works with forced dimensions.** `tmux new-session -d -x W -y H` is sufficient. No attached client needed. This solves the containerized deployment problem.

2. **The mailbox does not require a lead process.** `--parent-session-id` is just a namespace key. Any UUID works. Agents sharing the same value can communicate regardless of who spawned them.

3. **Agentobox can be the orchestrator directly.** The backend generates a UUID, creates a tmux session, spawns N agents with matching `--parent-session-id`, and controls them via tmux input. No lead Claude Code instance needed.

4. **Three control paths available:**
   - (a) Mailbox: agents message each other via `@name` references
   - (b) Direct tmux input: send commands to any pane as if the user typed them
   - (c) Shared task list: agents can coordinate via TaskCreate/TaskList/TaskUpdate

5. **Production deployment pattern:**
   ```
   tmux new-session -d -s team-{uuid} -x 200 -y 50 -c /workspace
   # For each agent:
   tmux split-window -t team-{uuid} -c /workspace
   tmux send-keys -t team-{uuid}:{pane} "claude --agent-id {id} \
     --agent-name {name} --team-name {team} --agent-color {color} \
     --parent-session-id {uuid} --agent-type general-purpose \
     --dangerously-skip-permissions --model {model}" Enter
   ```

### Experiment 7: Hooks Observation

**Setup:** Headless tmux session with `-x 200 -y 50`. Created `.claude/settings.local.json` with hooks registered for: `SessionStart`, `SessionEnd`, `PostToolUse`, `TeammateIdle`, `TaskCompleted`, `SubagentStart`, `SubagentStop`, `Stop`. All hooks log to `/tmp/hooks.log` via a shell script that dumps timestamp, env vars, and stdin JSON.

**Prompt:** "spawn one teammate called builder. have it add input validation to the POST /tasks endpoint in routes/tasks.js - require a title field. then run the tests."

**Result:** 638 lines of hook data. Complete lifecycle captured.

**Event timeline:**

Lead session (`54d5b223`):
1. `SessionStart` → `{source: "startup", model: "claude-opus-4-6"}`
2. `SubagentStart` → `{agent_id: "ade267b", agent_type: "Explore"}` (codebase exploration)
3. `PostToolUse` (multiple) → Bash, Read calls from Explore subagent
4. `SubagentStop` → Explore done, provides `agent_transcript_path`
5. `PostToolUse` → `{tool_name: "SendMessage", tool_input: {type: "shutdown_request", recipient: "builder"}}`
6. `PostToolUse` → `{tool_name: "TeamDelete", tool_response: {team_name: "task-validation"}}`
7. `SubagentStop` (x2) → with `agent_transcript_path` for each subagent
8. `Stop` → lead finished

Teammate session (`1e6e5ebc`):
1. `SessionStart` → separate session_id, separate transcript_path
2. `PostToolUse` (multiple) → Read, Edit, Bash (actual implementation work)
3. `Stop` → builder finished task
4. `TeammateIdle` → `{teammate_name: "builder", team_name: "task-validation"}`
5. `PostToolUse` → `{tool_name: "SendMessage", tool_input: {type: "shutdown_response", approve: true}}`
6. `SessionEnd` → `{reason: "other"}`

**Key findings:**

1. **`SendMessage` is a proper tool**, not just a mailbox primitive. PostToolUse captures it with full payload including `type` field: `"shutdown_request"`, `"shutdown_response"`, and regular messages. This gives the control plane **full visibility into all inter-agent communication**.

2. **`TeammateIdle` fires on the teammate's session**, not the lead's. Contains `teammate_name` + `team_name`. This is the "agent is available for work" signal.

3. **`TaskCompleted` did NOT fire.** The lead sent work directly via SendMessage without using the formal TaskCreate/TaskUpdate system. `TaskCompleted` likely only fires when a task is explicitly marked complete via TaskUpdate. Implication: for small delegations, agents skip the task list.

4. **`TeamDelete` tool** handles cleanup — removes team directories and worktrees. Captured in PostToolUse.

5. **Separate transcripts per agent.** Each agent has its own `.jsonl` transcript file. Subagents (Task tool) get nested: `{parent-session}/subagents/agent-{id}.jsonl`. These are complete conversation logs — rich data for the casebase.

6. **`CLAUDE_ENV_FILE`** provided during SessionStart. Path like `~/.claude/session-env/{session-id}/sessionstart-hook-0.sh`. Hook scripts can write env vars here to inject them into the session.

7. **`PostToolUse` is the firehose.** Every tool call on every agent fires it. Includes full `tool_input` and `tool_response`. For file reads, this includes the complete file content. For Bash, stdout/stderr. This is the richest observation channel but highest volume.

8. **Shutdown protocol is two-phase.** Lead sends `SendMessage` with `type: "shutdown_request"` → teammate responds with `type: "shutdown_response", approve: true` → teammate exits. This is observable via PostToolUse hooks.

**Hook data schema (stdin JSON):**

```jsonc
// Common fields (all hooks)
{
  "session_id": "uuid",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/working/dir",
  "hook_event_name": "PostToolUse",
  "permission_mode": "bypassPermissions"
}

// PostToolUse additions
{
  "tool_name": "SendMessage",
  "tool_input": { /* full input */ },
  "tool_response": { /* full response */ },
  "tool_use_id": "toolu_xxx"
}

// TeammateIdle additions
{
  "teammate_name": "builder",
  "team_name": "task-validation"
}

// SubagentStart/Stop additions
{
  "agent_id": "abc123",
  "agent_type": "Explore",
  "agent_transcript_path": "/path/to/subagent.jsonl"  // Stop only
}
```

**Implications for Agentobox control plane:**

- **Primary signals:** `TeammateIdle` (who's available), `PostToolUse` on `SendMessage` (inter-agent communication), `SessionStart`/`SessionEnd` (lifecycle)
- **Rich data:** `PostToolUse` on all tools gives complete activity log, but needs filtering to avoid noise
- **Transcript files** are the authoritative record — can be tailed or watched for casebase ingestion
- **`TaskCompleted`** requires agents to use the formal task system. For it to fire reliably, the system prompt should encourage TaskCreate/TaskUpdate usage.

### Experiment 8: TaskCompleted Hook Validation

**Setup:** Same headless tmux + hooks config as Experiment 7. Prompt explicitly asked for formal task list usage: "create all 3 tasks first using TaskCreate, set up dependencies, then spawn 2 teammates."

**Prompt:** "I need you to do 3 tasks using the task list to track them. Create all 3 tasks first, then spawn 2 teammates to work on them. Task 1: add a GET /tasks/:id endpoint. Task 2: update DELETE to return deleted task. Task 3: add tests for both (blocked by 1 and 2)."

**Result:** 3 sessions (lead + 2 teammates: `api-dev` and `tester`). All 3 `TaskCompleted` events fired.

**TaskCompleted payloads:**

```jsonc
// Task 1 — completed by api-dev
{
  "hook_event_name": "TaskCompleted",
  "task_id": "1",
  "task_subject": "Add GET /tasks/:id endpoint to routes/tasks.js",
  "task_description": "Add a GET /tasks/:id route...",
  "teammate_name": "api-dev",
  "team_name": "tasks-api"
}

// Task 2 — completed by api-dev
{
  "hook_event_name": "TaskCompleted",
  "task_id": "2",
  "task_subject": "Update DELETE /tasks/:id to return deleted task",
  "task_description": "Modify the DELETE route...",
  "teammate_name": "api-dev",
  "team_name": "tasks-api"
}

// Task 3 — completed by tester
{
  "hook_event_name": "TaskCompleted",
  "task_id": "3",
  "task_subject": "Add tests for GET /tasks/:id and updated DELETE response",
  "task_description": "Add tests to tests/tasks.test.js for...",
  "teammate_name": "tester",
  "team_name": "tasks-api"
}
```

**Also observed:**

- `PostToolUse` on `TaskUpdate` with `addBlockedBy` — dependency setup visible to hooks
- `TaskCompleted` fires on the **teammate's session** (not the lead's)
- Lead used `Stop` events between task assignments (waiting for unblocked tasks)
- 3 separate `SessionStart` events — one per agent

**Confirmed:** `TaskCompleted` fires when `TaskUpdate` sets status to `completed`. The payload includes the full task metadata — everything the control plane needs to track progress without additional reporting.

### Claude Code Task System (Task = Todo = Plan Tracking)

The task system evolved through these names but is a single mechanism:

| Version | Name | Tools |
|---------|------|-------|
| v0.2.82 | "Todo list" | Original implementation |
| Later | "Task list" | Renamed to `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` |
| v2.1.33 | + Hooks | Added `TaskCompleted` hook event |
| v2.1.37 | + Delete | Added `status: "deleted"` via `TaskUpdate` |

**Task** = shared work item with:
- `id`, `subject`, `description`, `status` (`pending` → `in_progress` → `completed`)
- `blockedBy` / `blocks` (dependency graph)
- `owner` (which agent owns the task)
- `activeForm` (present tense description shown during execution)

**There is no separate "todo" or "plan" data structure.** When agents say "let me create a todo list" or track a plan, they use `TaskCreate`. Plans (via the `Plan` subagent or `EnterPlanMode`) are conversation output, not persistent data.

**Implication for Agentobox:** The `TaskCompleted` hook gives the control plane structured, reliable progress signals — but only when agents use the formal task system. For simple single-task delegations, agents may skip TaskCreate and send work directly via SendMessage (as seen in Experiment 7). To ensure `TaskCompleted` fires, the system prompt or team config should encourage formal task creation.

## References

- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams) — official docs on teaming, display modes, team config, mailbox
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — hook event types, matcher syntax, stdin JSON schema
- [Claude Code Hooks guide](https://code.claude.com/docs/en/hooks-guide) — patterns, examples, decision control
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — agent teams tmux fix, TeammateIdle/TaskCompleted hooks
- [Multi-agent swarm plugin](https://github.com/anthropics/claude-code/tree/main/plugins/plugin-dev/skills/plugin-settings/references) — community pattern (separate from native teams)
- [Anthropic Cowork](https://www.anthropic.com/products/cowork) — single-agent macOS desktop app
- [Computer Use API](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) — API tool for virtual desktop control

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

- **Agentobox's role is clear.** Sandbox provisioning, display streaming (VNC/terminal/chat), the supervisory control loop (hooks → API → exit code decisions), the casebase (session storage and retrieval), and a web UI for non-technical users. The intelligence stays in Claude. Validated by experiments: Agentobox can be the orchestrator directly (Experiment 6), no lead agent needed.

## Casebase Design

The casebase is a design, not a validated system. Open questions about implementation are in [Open Questions > Casebase](#casebase).

**Core insight:** Models are getting better at reasoning but have no memory across projects. They struggle with meta-reasoning (which approach fits this situation?) unless explicitly prompted with relevant context. Past sessions — what was tried, what worked, what failed, how the user felt about it — are that context. The system doesn't need to do the reasoning. It needs to store and retrieve the right context so the model can.

**What it stores:** Three data streams, all captured from what already exists:

- **Transcripts** — per-agent `.jsonl` session logs, stored as-is. Each agent already produces these; `transcript_path` is provided in hook data (Experiment 7). Each transcript is a self-contained record of that agent's perspective — its input (user messages or teammate delegations), its responses, its tool calls, and hook events. The human's messages already appear in whichever agent received them (typically the lead). No separate "user conversation" capture needed — each agent's input stream contains everything. To reconstruct the full picture for a team, query all transcripts where `teamName` matches.
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
