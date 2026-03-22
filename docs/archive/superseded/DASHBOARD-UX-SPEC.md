# Dashboard UX Spec

## What This Is

Agentobox is a GUI for Claude Code agent teams. Claude Code already has native teaming — `--team-name`, parent sessions, mailbox communication, shared task lists. Agentobox doesn't replace any of that. It provides the visual layer: deploy agents, watch them work, talk to them, intervene when needed.

The primary interaction model mirrors how CC teams already work:
- **You talk to the team lead.** The lead delegates to workers, coordinates, reports back.
- **You can talk to any agent directly.** The lead is the default, not the only channel.
- **You observe the team working.** Real-time visibility into what each agent is perceiving, thinking, saying, and doing.

The dashboard is not a monitoring tool bolted onto agents. It IS the way you interact with your agent team — the same way Slack is how you interact with a human team.

## The Agento Box: Agents as Cognitive Architectures

Each agent is a cognitive system with observable dimensions. The "agento box" (bento box) is the visual container that reveals these dimensions:

| Dimension | What it shows | Signal type | Examples |
|-----------|---------------|-------------|----------|
| **Perceiving** | What the agent is looking at / taking in | Sensory input | VNC screen, file contents, web page, API response, screenshot |
| **Thinking** | Internal reasoning and planning | Cognitive process | Chain of thought, planning text, decision rationale |
| **Saying** | Communication with humans and other agents | Language output | Messages to user, messages to teammates, status updates |
| **Doing** | Actions being executed on the world | Motor output | Tool calls, file edits, commands, deployments |

**Research validation:** This four-dimension decomposition is well-established across cognitive science and adjacent domains. ACT-R uses buffer-based modules (visual, motor, declarative, goal) — each a separate panel showing current state. SOAR splits perception (scene graph), reasoning (production rules), and action (trace). CoALA (Stanford, 2023) maps LLM agents to the same structure. Game AI (The Sims, behavior trees) and robotics (Foxglove, RViz) independently arrive at the same decomposition. This isn't an arbitrary UI choice — it's how cognitive systems are actually understood.

**Why this matters:**
- VNC is not a special top-level concept — it's one possible **perception** renderer. An agent reading code has a different perception than one browsing a website.
- An agent's observable surfaces are dynamic, determined by its capabilities (tools, MCPs). An agent with `computer-use` has a visual perception channel. A pure-code agent doesn't.
- The four dimensions give a principled answer to "what goes in each compartment?" that doesn't depend on any specific tool or capability.
- At L1 (scan), you see a compressed summary of all four. At L2 (focus), you see the full streams. At L3 (deep dive), you're immersed in one dimension (e.g., VNC fullscreen).

**The bento box principle:** Every compartment serves a purpose. No wasted space, no confusion about what goes where. The dashboard should feel like opening a well-organized bento box, not like looking at a server monitoring panel. The Sims, not Grafana.

### Progressive Disclosure Across Dimensions (The Sims Pattern)

The Sims is the strongest analogue for this problem — one human managing 8+ autonomous entities with internal cognitive states. Its visualization patterns map directly:

| Level | The Sims | Agento Box |
|-------|----------|------------|
| L0 | Plumbob color (green/yellow/red) | Status dot encoding multi-dimensional health |
| L1 | Thought bubble icon (current desire) | Cognitive mode icon (eye/brain/speech/wrench) + activity preview |
| L2 | Needs bars + moodlets (why they feel that way) | Four-dimension panels: perceiving/thinking/saying/doing |
| L3 | Full personality + action queue | Session replay, synchronized panels, VNC immersive |

### Dynamic Views: Capability-Based View Registry

An agent's available views are determined by its capabilities — not configured by the user, discovered from what tools/MCPs the agent has. The pattern (validated by VS Code's `when` clauses, Grafana's conditional panels, Google A2UI's widget catalog):

```
Agent capabilities (MCPs/tools)  →  View Registry  →  Available panels

computer-use    →  VncPanel (Screen tab)
playwright      →  BrowserPanel (Browser tab)
file editing    →  DiffViewer (Files tab)
terminal        →  TerminalPanel (Terminal tab)
ChatThread      →  always present (baseline)
```

At L2, per-agent tabs are auto-populated from capabilities:
- Agent with `computer-use`: [Chat | Screen | Actions | Thinking]
- Pure code agent: [Chat | Actions | Thinking]
- Agent with `playwright`: [Chat | Browser | Actions | Thinking]

At L1 (fleet level), global view toggles select which dimension to view across all agents:
- **Feed** — "saying" across all agents (Slack pattern)
- **Screens** — "perceiving" across all agents (war room)
- **Activity** — "doing" across all agents (CI/CD pipeline feel)

Empty tabs never appear. If no agents have `computer-use`, the "Screens" global toggle doesn't render.

### Agent Needs System

Agents have needs beyond running/error/idle. These are currently invisible until they become errors:

| Need | Signal | Example |
|------|--------|---------|
| Approval | Waiting for human decision | Permission prompt, AskUserQuestion |
| Information | Stuck, needs clarification | Ambiguous task, missing context |
| Resources | Rate-limited or waiting | API quota, blocked by another agent |
| Coordination | Depends on another agent's output | Waiting for backend to finish before QA can test |

A subtle needs indicator at L1 — like The Sims showing a toilet icon before the Sim has an accident — surfaces upcoming problems before they become errors. The spec's "permission denial badge" at L2 is one instance. Generalizing: any unmet agent need gets a tiny indicator visible at L1.

## Core Problem

Humans are the bottleneck in human-agent systems. A human can deploy N agents but cannot attend to N agents. The UI is the interface between a cognitively limited human and an arbitrarily scalable agent fleet.

**Human constraints that govern the design:**
- Attention is serial — you can only focus on one thing at a time
- Working memory is ~4 items — you cannot hold the state of 20 agents in your head
- Context switching is expensive — jumping between agents loses state
- Pattern recognition is fast but needs the right signal — a red dot in a sea of green is instant; reading 20 status strings is slow

**The pixel budget principle:** Every pixel of screen real estate is a zero-sum trade. Showing X means not showing Y. The only justification for X occupying space is that it reduces cognitive load more than Y would. Every pixel either moves the human closer to understanding or closer to overload — there is no neutral.

## Accessibility Baseline: The iPad Test

Managing multiple AI agents is currently so hard that only very technical people can do it (nested tmux sessions, CLI commands, split panes). The goal is an app so intuitive it dramatically lowers the barrier — iPad-level design, where the interface is self-evident.

**Design principles (underneath the Information Density Ladder):**

1. **Direct manipulation over commands.** The primary path is visual: click, drag, tap. Keyboard shortcuts (Cmd+K) are accelerators for power users, not the primary interaction. A non-technical person should be able to deploy, monitor, and intervene without a keyboard shortcut.

2. **Show, don't tell.** States must be visually self-evident without reading text. A running agent LOOKS alive (animation, pulse, color). An errored agent LOOKS broken (red, still, warning). The chimp test: remove all text labels — can you still understand fleet state?

3. **One obvious action per context.** At any moment, one thing should be clearly the next step. Not 5 buttons of equal weight. The most likely action is the biggest, most obvious affordance. If an agent just errored, the restart button practically glows.

4. **Forgiveness over confirmation.** No "Are you sure?" dialogs. Let the user act, show an undo toast for 5 seconds. Reduces friction, reduces fear, makes the app safe to explore.

5. **Zero-training onboarding.** A first-time user should be able to: deploy an agent, watch it work, send it a message, and kill it — all without reading documentation.

6. **Sensible defaults everywhere.** Don't make the user choose model, runtime, workspace on first deploy if defaults work. Minimize required decisions. Show advanced options only on demand.

**The constraint:** Every level of the Information Density Ladder must be navigable by visual interaction alone, without requiring domain knowledge.

## Information Density Ladder

Based on Shneiderman's Mantra: overview first, zoom and filter, then details on demand.

| Level | Name | Click depth | What it shows | When it's needed |
|-------|------|-------------|---------------|------------------|
| L0 | **Overview** | 0 clicks | Aggregate stats — always visible, never scrolls off | The "how is everything?" glance |
| L1 | **Scan** | 0 clicks | Compact cards/rows — default view | "Which thing needs my attention?" |
| L2 | **Focus** | 1 click | Expanded detail on one agent | "Tell me about this one thing" |
| L3 | **Deep dive** | 2 clicks | Full-screen immersive view | "I'm debugging this" |

**Current state:** The dashboard jumps from L0 (almost nothing — "3 agents deployed") straight to L3 (full VNC iframe) with no L1/L2 in between. The least-informative element (blank VNC terminal) gets the most visual real estate.

## Layout Architecture

### 2-Column with Unified Feed + View Toggle

```
┌─────────────────────────────────────────────────────────────────────┐
│ [project ▾]  ● 3 running  ⚠ 1 error  ○ 1 idle    $4.82    [👤]   │  ← L0 StatusBar
├──────────────┬──────────────────────────────────────────────────────┤
│ [+ Deploy]   │  [Feed ● | Screens ○ | Activity ○]    All agents ▾  │
│ [search...]  │                                                      │
│              │  ┌─ system ────────────────────────────────────────┐ │
│ ● lead       │  │ backend joined the team                        │ │
│  🧠 Planning │  └────────────────────────────────────────────────┘ │
│ ● backend    │  ┌─ lead ─────────────────────────────────────────┐ │
│  🔧 Testing  │  │ I'll delegate the auth fix to backend and     │ │
│ ● frontend   │  │ have frontend update the login form.           │ │
│  👁 Reading   │  └────────────────────────────────────────────────┘ │
│ ● qa         │  ┌─ backend ──────────────────────────────────────┐ │
│  ⏳ Waiting   │  │ Editing auth.ts, running tests (+3 tools)     │ │
│              │  └────────────────────────────────────────────────┘ │
│              │  ┌─ ⚠ backend ────────────────────────────────────┐ │
│              │  │ npm test failed: expected 200, got 401         │ │
│              │  │ [Restart]                                      │ │
│              │  └────────────────────────────────────────────────┘ │
│              │                                                      │
│              │  ───────────────────────────────────────────────────  │
│ L1 AgentList │  [@lead ▾] Message your team...              [→]    │
├──────────────┴──────────────────────────────────────────────────────┤
```

**2-column, not 3:** Feed and VNC panels compete for pixels — showing both simultaneously means neither is good. The view toggle (Feed | Screens | Activity) switches the right pane between dimensions. Feed gets full width when active, VNC panels get full width when active.

**The unified feed (L1.5):** This is where operators live 80% of the time. It's between L1 (scan list) and L2 (per-agent deep dive). The feed is lead-mediated — primarily one conversation with the team lead, punctuated by system events when workers need attention.

### Lead-Mediated Feed

The feed mirrors CC's team communication model. At 9 agents, you don't see 9 parallel streams. You see:

| What shows in the feed | Why |
|------------------------|-----|
| Lead messages | Your primary conversation partner — the lead delegates to workers |
| Your messages | What you said, with @agent targeting |
| Worker errors | Needs your attention immediately |
| Status transitions | "backend joined", "frontend errored", "qa completed" |
| Worker direct messages to you | Only when they @mention you or need a decision |
| Worker activity | Collapsed to activity lines: "backend: Editing auth.ts (+3 tools)" |

Workers doing their thing quietly? Hidden behind activity lines. The lead summarizes their progress. Click a worker in L1 → feed scopes to that agent's full conversation.

### Filter-in-Place Navigation

Click an agent in L1 → feed filters to that agent's messages. Compose bar updates from `@all` to `@frontend`. L0 and L1 stay visible — the operator never loses fleet context.

Back action: click agent again (deselect) or click "All agents" in the content header → returns to unified feed.

For deep debugging (L3): double-click or "Expand" button → FullscreenView (VNC + chat side-by-side). Escape returns.

Flow: `Team Feed → Click agent → Filtered Feed → Double-click → Fullscreen → Escape → Filtered → Click "All" → Team Feed`

**Split pane:** Agent list (L1, ~240px) on left, content pane on right. The content pane shows the unified feed by default, or per-agent filtered view, or VNC panels grid, depending on view toggle and agent selection.

## L0: StatusBar

Always visible, fixed top strip. Never scrolls off.

```
[test ▾] [3 running] [1 error] [1 idle 12m] — $4.82 total — $1.20/hr     [broadcast] [👤]
```

- **Project switcher** (left): dropdown with project list + "+ New project"
- **Status segments** (center): clickable counts. Click `[1 error]` → filter L1 list to error agents AND auto-select the worst (navigate-to-worst pattern)
- **Cost + burn rate** (right of segments): total spend + $/hr derivative
- **Broadcast button**: fleet-level message input targeting all/filtered agents
- **User menu** (far right): avatar → dropdown (account, API keys, secret groups, billing, logout)

**What does NOT belong at L0:** agent names, individual costs, model info, timestamps. Those are L1 concerns.

## L1: AgentListPanel

Default view. 0 clicks. Chat-list style (like iOS Messages / Slack channels). Fits 20 agents without scrolling.

### Components
- **Deploy button** — top of panel, always visible, accent color, large touch target
- **Search/filter input** — type to filter by name, always visible
- **Active filter indicator** — when L0 status segment is clicked

### AgentListItem (~56px card, chat-list style)

```
┌──────────────────────────────────────────┐
│ ◉ frontend   👁    3s ago                │  ← breathing pulse + cognitive mode icon
│   Reading auth module...          $1.23  │
└──────────────────────────────────────────┘
```

| Element | Purpose |
|---------|---------|
| Activity pulse | Breathing animation = agent is actively working (CSS, ~0 pixel cost) |
| Agent avatar | Colored circle with initial — visual identity without reading |
| Agent name | Primary text |
| Cognitive mode icon | Preattentive signal of WHAT KIND of thing the agent is doing (see below) |
| Activity preview | Secondary text: human-readable intent, not raw tool names |
| Time badge | "3s ago" — right-aligned, muted. Staleness detector |
| Cost badge | Only if above threshold |
| Needs indicator | Subtle badge when agent is waiting for user input (see Agent Needs System) |

### Cognitive Mode Icons

A tiny icon on the agent card showing the current cognitive dimension — preattentive signal that doesn't require reading text:

| Icon | Mode | Meaning | Triggered by |
|------|------|---------|-------------|
| 👁 | Perceiving | Reading / browsing / looking at something | Read, WebFetch, VNC interaction |
| 🧠 | Thinking | Planning / reasoning | Text output, chain of thought |
| 💬 | Saying | Communicating with humans or agents | SendMessage, AskUserQuestion |
| 🔧 | Doing | Executing actions on the world | Edit, Write, Bash, tool calls |
| ⏳ | Waiting | Blocked — needs something | Waiting for user input, rate limited |

At a glance across 9 agents, you see a mix of icons and instantly know: "3 are doing, 2 are thinking, 1 is reading, 1 is waiting for me, 2 are idle." No text reading required.

### Visual State Encoding (the chimp test)

Remove all text labels — can you still understand fleet state?

| State | Visual treatment | Animation | Pixel budget |
|-------|-----------------|-----------|-------------|
| **Running + active** | Normal card, green accent | Subtle breathing pulse on border | Baseline |
| **Running + idle** | Normal card, no accent | No animation (stillness IS the signal) | Baseline |
| **Error** | Red border, warning icon, **expanded card (~80px)** | None (dead = still) | +40% — error summary + inline Restart button visible at L1 |
| **Deploying** | Loading spinner on card border | Linear progress animation | Baseline |
| **Stopped** | Dimmed/faded, lower opacity | None | -20% (ghost state) |

**Status-weighted prominence:** Errored cards expand to show error summary + inline "Restart" button at L1. The operator can restart a broken agent without drilling into L2. Normal cards stay compact. The size difference is a preattentive signal — one expanded red card pops out of a sea of compact green cards in a single fixation.

**Error card at L1:**
```
┌──────────────────────────────────────────┐
│ ⚠ backend                    12s ago     │  ← red border, no animation
│   npm test failed                        │
│   [ Restart ]                     $0.89  │  ← inline action at L1
└──────────────────────────────────────────┘
```

### Space-to-Peek (power user accelerator)

Press Space while hovering over a card → ephemeral L2 popover showing last 3-4 chat bubbles + status + error. Arrow keys navigate between agents while peeking. One interaction to scan 5 agents at L2 depth. On mobile: long-press equivalent. Keyboard interaction — power user path, not primary (iPad test still requires tap-to-navigate).

## L2: AgentDetailView (ChatThread)

1 click from L1. The critical reframe: **the agent IS a conversation partner.** L2 looks like a messaging thread (iMessage/WhatsApp), not a monitoring dashboard. Agent actions are left-aligned bubbles. Operator messages are right-aligned. The monitoring data (tool calls, file edits, test results) is the agent's "messages" rendered in structured form.

### DetailHeader
- Back button (← arrow, returns to L1)
- Agent avatar (same as L1 but larger, animated if active)
- Name + status pill (Running/Error/Idle — visual, not text-heavy)
- **MoreMenu** (three dots → Kill, Restart, Duplicate, Config). Secondary actions behind a single tap. Exception: when errored, Restart promotes itself into the ErrorBubble in the chat flow.

### ChatThread (core of L2)

```
┌────────────────────────────────────┐
│ ← frontend                        │
├────────────────────────────────────┤
│                                    │
│ ┌─ frontend ──────────────────┐   │
│ │ 📄 Reading src/auth.ts      │   │  ← ActionBubble (left-aligned)
│ │ ████████░░ 200 lines        │   │
│ └─────────────────────────────┘   │
│                                    │
│ ┌─ frontend ──────────────────┐   │
│ │ ✏️ Editing login handler     │   │  ← ActionBubble with expandable diff
│ │ +14 -3 lines                │   │
│ └─────────────────────────────┘   │
│                                    │
│          ┌────────────────────┐   │
│          │ Fix the auth bug   │   │  ← UserBubble (right-aligned)
│          └────────────────────┘   │
│                                    │
│ ┌─ frontend ──────────────────┐   │
│ │ ▶ Running npm test          │   │
│ │ ⏳ in progress...           │   │
│ └─────────────────────────────┘   │
│                                    │
├────────────────────────────────────┤
│ Message frontend...        [→]    │  ← MessageComposer (fixed bottom)
└────────────────────────────────────┘
```

**Bubble types:**

| Type | Alignment | Visual | On tap |
|------|-----------|--------|--------|
| ActionBubble | Left | Tool icon + 1-line summary | Expand to show full result/diff |
| TextBubble | Left | Agent reasoning, 2-line truncate | Expand to full text |
| UserBubble | Right | Operator message (like "sent") | No expand needed |
| ErrorBubble | Left, red | Error message + **inline Restart button** | Restart fires immediately + undo toast |

**Key rules:**
- Every bubble occupies 1-2 lines by default. Expansion is opt-in (tap to expand, like a link preview in chat).
- Errors auto-surface with restart affordance at point of failure — no menu hunting.
- New bubbles append in real-time (live streaming from agent).

### Interactive Cards (Existing CC Pattern — Phase 1)

Claude Code already has `AskUserQuestion` — a tool that presents structured options to the user. The data is already flowing through the backend as `tool_use` content parts with structured `questions` containing options (label + description, single or multi-select). The current chat view renders these as plain tool bubbles saying "Asking question..." — useless.

**Phase 1 (dogfooding essential):** Render `AskUserQuestion` tool_use parts as interactive cards with clickable buttons. User clicks an option → sends the response via `sendMessage` mutation. This is not new generative UI — it's rendering existing structured data as interactive elements instead of plain text.

```
┌─ ● backend ──────────────────────────┐
│  Which database should we use?       │
│                                      │
│  [PostgreSQL]  [SQLite]              │
│                                      │
│  or type a custom response...        │
└──────────────────────────────────────┘
```

At 9 agents, being able to tap a button instead of typing a response is the difference between manageable and painful. Multiple pending requests queue with priority (errors > permissions > questions) and surface in the feed as interactive cards that stay highlighted until resolved.

### Generative UI Bubbles (Phase 3)

Beyond the existing CC pattern, agents can present richer interactive elements using a constrained component catalog. The agent selects from pre-built components and fills with data — it never generates raw UI. Industry consensus (Vercel AI SDK, Google A2UI, Slack/Discord, MCP Apps): structured intent → pre-approved components.

| Bubble type | When | Visual | Interaction |
|-------------|------|--------|-------------|
| ApprovalCard | Agent needs a yes/no decision | Card with context + [Approve] [Reject] buttons | Tap button → card mutates in-place to show decision record |
| ChoiceSelector | Agent presents options | Card with 2-4 option buttons | Tap option → card shows selection, agent resumes |
| DataPreview | Agent shows data before acting | Expandable data card + [Continue] [Abort] | Review data, then decide |
| ProgressCard | Multi-step operation | Steps list with live progress indicators | Read-only, auto-updates |

**Design rules for generative UI:**
- Cards mutate in-place after interaction (Slack pattern — no new message clutters the feed)
- Every card includes "why" context (agent's reasoning), collapsed by default for low-stakes decisions
- Buttons have TTLs — gray out with "Expired" after N minutes if no response
- The component catalog is fixed. Agents fill templates, they don't create new ones. Consistent behavior builds operator trust.
- High-stakes decisions (delete, deploy, config change) require the operator to engage — not just a single tap. Show confidence level, flag low-confidence.

### Observation Modes: Cognitive Dimensions in the ChatThread

The ChatThread is the universal baseline — it merges Saying (conversation) and Doing (tool calls) into one temporal stream because they're naturally interleaved. The other dimensions are accessed via capability-gated tabs (see Dynamic Views above):

| Dimension | In ChatThread | As separate tab | Gated by capability? |
|-----------|---------------|-----------------|---------------------|
| **Doing** | ActionBubbles — tool calls interleaved with conversation | Activity tab (filterable, sortable) | No — every agent does things |
| **Saying** | UserBubbles + TextBubbles — the conversation | Chat tab (default, always present) | No — every agent communicates |
| **Perceiving** | Inline thumbnails when agent takes screenshots | Screen tab (VNC), Browser tab (Playwright) | Yes — only if computer-use/playwright MCP |
| **Thinking** | TextBubbles showing reasoning | Thinking tab (chain of thought, separated from conversation) | No — but only useful when verbose |
| **Configuration** | — | Config tab (MoreMenu → gear) | No — always in MoreMenu |

At L1.5 (unified feed), Doing collapses to activity lines and Saying shows in full. At L2 (filtered to one agent), all dimensions expand. At L3, dimensions break apart into synchronized side-by-side panels (like Foxglove for robotics) for deep debugging.

Future: agents could use an MCP tool (`display_to_user`) to render rich visual content (ASCII diagrams, data tables, charts) as special bubbles in the ChatThread, making the conversation thread richer without requiring VNC.

### ConfigCollapsible
Gear icon in MoreMenu → expands inline: model selector, MCP picker, secret attacher, instructions editor. Collapsed by default (zero pixel cost). Reuses deploy sheet components.

### VNC Access
On desktop: "Show VNC" toggle in MoreMenu → lazy-loaded iframe below chat. On mobile: horizontal swipe from chat → VNC as adjacent page. VNC is an escape hatch, not the default.

### MessageComposer
Fixed bar at bottom: `Message frontend...` with send button (arrow icon, accent color). Always visible, always in the same place. Type → tap send. Identical to every messaging app.

## L3: FullscreenView

2 clicks from default. Explicit opt-in via "Open fullscreen" button in L2 or double-click card.

```
┌──────────────────────────────────────────────┐
│ [Agent name]  [status]  [interrupt] [kill]   │
├─────────────────────┬────────────────────────┤
│                     │                        │
│    VNC / Terminal   │   Activity Feed        │
│    (resizable)      │   (same as L2 feed)    │
│                     │                        │
├─────────────────────┴────────────────────────┤
│ [message input]                              │
└──────────────────────────────────────────────┘
```

L3 = L2 + VNC side-by-side, not a different paradigm. The transition from L2 to L3 is "add VNC to what you're already seeing." Resizable divider between panes.

## Cmd+K Command Palette

Global keyboard shortcut layer (L0). Fuzzy search over finite command set:

- Agent commands: `kill frontend`, `message backend`, `restart qa`, `interrupt frontend`
- Fleet commands: `kill all error`, `message all`, `broadcast <text>`
- Navigation: `go to frontend`, `deploy agent`
- Top result executed on Enter

At 10+ agents, keyboard navigation is the primary efficiency tool, not a power-user luxury.

## Batch Operations

**Implicit batching via L0:** Click `[1 error]` → filters L1 to error agents. Contextual bulk actions appear: "Kill all errored", "Restart all idle".

**Explicit selection:** Checkboxes or shift-click on L1 rows. Floating action bar at bottom: "Kill 3 agents" / "Message 3 agents". Gmail/Figma pattern.

Start with implicit batching (lower complexity, covers most common workflow).

## Notifications / Attention Routing

Three layers, increasing intrusiveness:

| Layer | Mechanism | When | Cost |
|-------|-----------|------|------|
| L0 bar update | Status segment count changes, red appears | Always, real-time | Zero — already there |
| Toast | Bottom-right popup: "frontend errored — npm test failed" + "View" button | Agent state transitions | Peripheral vision interrupt |
| L1 row pulse | Background color flash for 1s | Agent status change | Gentlest nudge, no overlay |

**No sound by default.** Sound doesn't scale (20 agents = constant noise). Opt-in for critical errors only.
**No badge system.** Badges create notification debt. L0 bar already aggregates status.

### Tiered Mobile Escalation (when L1 is off-screen)

On mobile, L1 is hidden during L2 (push/pop navigation). Three tiers of interruption, escalating with severity:

**Tier 1 — Single error: toast overlay**

A toast slides up from the bottom of L2, above the message input. Shows agent name + error summary + "View" action. Tap "View" → navigates to that agent's L2. Auto-dismisses after 8 seconds. The operator can ignore it and continue chatting.

```
┌────────────────────────────────────┐
│ ⚠ frontend errored                │
│ npm test failed        [View →]   │
└────────────────────────────────────┘
```

**Tier 2 — Multiple errors (2-4 within 5s): merged toast**

When 2+ agents error within a 5-second window, toasts merge into a summary. "Triage" navigates back to L1 with error filter active. Prevents toast spam.

```
┌────────────────────────────────────┐
│ ⚠ 3 agents errored                │
│ frontend · qa · devops             │
│                      [Triage →]    │
└────────────────────────────────────┘
```

**Tier 3 — Cascade failure (5+ within 10s): full-screen interrupt**

Almost certainly a shared dependency failure (database down, API key expired). Full-screen takeover with:
- Count and agent names
- "Possible cause" hint if errors share a pattern (same error message, same timeframe)
- "View Fleet" → L1 with error filter
- "Restart All" → batch restart with undo toast
- "Dismiss" → return to current context

```
┌────────────────────────────────────────┐
│                                        │
│              ⚠                         │
│                                        │
│      5 agents errored                  │
│                                        │
│  frontend · backend · qa               │
│  devops · testing                      │
│                                        │
│  Possible cause: shared dependency     │
│  failure (all errored within 8s)       │
│                                        │
│  ┌──────────────────────────────┐      │
│  │        View Fleet →         │      │
│  └──────────────────────────────┘      │
│  ┌──────────────────────────────┐      │
│  │        Restart All          │      │
│  └──────────────────────────────┘      │
│                                        │
│           Dismiss                      │
│                                        │
└────────────────────────────────────────┘
```

**StatusBar as passive signal on mobile:** Even in L2, the StatusBar is always visible (top bar with back button). Status segments update in real-time — the operator sees `[2 error]` turning red while chatting. This is the passive layer; toasts are the active interrupt.

## Liveness Signals: "Humans Like to See Things Happening"

Even when not strictly informative, humans need visual confirmation that autonomous agents are working. This is trust calibration — without visible activity, the operator loses confidence and starts drilling in unnecessarily.

**Minimum liveness signals by level:**

| Level | Signal | Pixel cost | What it tells you |
|-------|--------|-----------|-------------------|
| L0 | Status segment counts update in real-time | Zero (already rendered) | "The fleet is alive" |
| L1 | Current action line updates live, action age ticks | ~0 (text swap) | "This agent is doing something" |
| L1 | Subtle pulse/shimmer on actively-working agent rows | ~0 (CSS animation) | "This one is working right now" |
| L2 | New feed items append in real-time | Minimal (1 DOM node) | "I can see it working step by step" |
| L3 | Live VNC + live feed side-by-side | High (iframe + feed) | "I'm watching it work" |

The key insight: L1 liveness signals (action line updates + row shimmer) satisfy the "I can see it's working" need at near-zero pixel cost. The operator only needs L3 (VNC) when they want to pair-program or visually debug — not just to confirm the agent is alive.

## Analogue Research: Patterns from Adjacent Domains

Research across 15+ tools in 8 domains where a single operator manages many autonomous entities. The goal: extract concrete patterns, validate our interaction counts, and find novel ideas we haven't considered.

### Theoretical Foundation

**Endsley's Situation Awareness (SA) model** — 76% of SA errors in complex systems are Level 1 (perception) failures. The operator didn't notice the change, not that they misunderstood it. Implication: our primary design job is ensuring state changes are perceivable, not just comprehensible. Color, motion, and position do more work than text.

**Trust calibration (Lee & See, 2004)** — Three types of trust in automation:
- **Performance trust**: "Does it produce good results?" (earned over time)
- **Process trust**: "Can I see it working?" (visual activity signals)
- **Purpose trust**: "Is it working toward my goal?" (alignment indicators)

Our liveness signals serve process trust. Without them, operators lose confidence and start drilling in unnecessarily, wasting time on healthy agents.

**Norman's Gulf of Evaluation** — The gap between system state and the user's perception of it. Every additional click to understand what's happening widens the gulf. L0 and L1 exist to close this gulf for the most common questions.

### Interaction Count Comparison Across Analogues

| Action | Veyon | Grafana | Lens/K8s | Linear | Call Center | Trading | **Our Target** |
|--------|-------|---------|----------|--------|-------------|---------|---------------|
| See overall health | 1 | 0 | 1 | 1 | 0 | 0 | **0** |
| Find problematic entity | 0 (scan red) | 0 (red panel) | 0 (red in list) | 0 (filter) | 0 (sort) | 0 (color) | **0** |
| See what entity is doing | 0 (thumbnail) | 1 | 1 | 0.5 (Space peek) | 1 | 1 | **0.5-1** |
| Take action on entity | 1 (right-click) | N/A | 2 | 1-2 | 1-2 | 1 | **1-2** |
| See detailed logs/history | N/A | 2 | 2 | 2 | 2 | 2 | **2** |
| Configure entity | 3+ | N/A | 2 | 2 | 2-3 | N/A | **2-3** |
| Batch operate | 1-2 | N/A | N/A | 3-5 | 1-2 | N/A | **1-2** |

Key insight: Linear's Space-to-Peek gives 0.5-click L2 access, beating every other tool. We should match this.

### 5 Novel Patterns to Adopt

**1. Space-to-Peek (from Linear)**

Press Space while hovering over an agent card to show ephemeral L2 detail without navigating. Arrow keys move between agents while peeking. One interaction to scan 5 agents at L2 depth vs. 10+ interactions with click-navigate-back.

- Preserves L1 spatial context (operator stays in fleet view mentally)
- On mobile: long-press equivalent
- Highest-ROI interaction pattern we can implement

**2. Spotlight/Watch Panel (from Veyon)**

A collapsible side panel where the operator pins 1-3 agents for enlarged continuous monitoring. The pinned agents show expanded detail (L1.5) while the full fleet grid remains visible.

- Separates "entities I'm tracking" from "entities I glance at"
- Reduces L1→L2 cost to 0 for pinned agents
- Persists across page refreshes (user preference)
- Pin via right-click > "Watch" or drag

**3. Status-Weighted Visual Prominence (composite)**

Errored agents get more visual real estate than healthy ones. Instead of uniform cards, errored agents expand to show error summary + action button inline at L1.

- Normal card: ~200x120px — name, status dot, current task, progress
- Alert card: ~200x200px — same + red border + error message (2 lines) + "Restart" button inline
- Preattentive detection: red expanded cards pop out of green field in a single fixation
- Implements Endsley's L1 SA: problems are perceivable without deliberate search

**4. Instant Emotional Reading (from Grafana)**

L0 header bar with colored stat indicators that communicate fleet health before any text is read. The operator knows green/green/green/red = "one problem, find the red one" in <1 second.

- Each stat is clickable to filter L1 (matches our navigate-to-worst)
- Subtle red tint on entire bar when critical errors exist
- Functions as Calm Technology — peripheral awareness that only demands focus on change
- 50 glances/day x 0.5s each = 25s total (vs. minutes reading status text)

**5. Contextual Toolbar on Selection (from Veyon + Retool)**

When agent(s) are selected, a floating toolbar appears showing only valid actions for the current selection. Adapts based on count and state.

- 3 running agents selected → "Pause All" / "Stop All" (no "Start All")
- Mixed states → annotated actions: "Start 2 / Stop 1"
- Reduces batch operations to 2 clicks (select + action) vs. Jira's 5-click wizard
- Replaces the need to navigate to L2 for common actions

### Cross-Domain Patterns That Validate Our Design

| Pattern | Where we see it | How it maps to our spec |
|---------|----------------|------------------------|
| Persistent overview bar | Grafana, Trading, Call Centers, RMM | Our L0 StatusBar |
| Color + icon + text (never color alone) | Carbon Design System, Astro UXDS | Accessibility requirement for status dots |
| Hover-for-summary | RMM (NinjaOne), Trading heatmaps | Potential L1.5 — tooltip on agent card hover |
| Z-pattern layout | All dashboard tools | StatusBar top-left, cost top-right, list bottom-left |
| Restart count as signal | Kubernetes/Lens | Add restart count to AgentListItem if > 0 |
| Time-in-state counters | Call centers (Zendesk) | Our "action age" and "run duration" fields |
| Exception-based escalation | Drone fleet, Call center routing | Don't show every agent action, only surface anomalies |
| Progress rings on entities | Drone fleet, CI/CD | Consider for agent cards at L1 |
| Sparklines as trend signals | Grafana, Datadog | Mini cost/activity sparkline in AgentListItem |
| DAG visualization for dependencies | CI/CD (GitHub Actions, Jenkins) | Future: agent task dependency visualization |
| Undo toast for destructive actions | Trading platforms, Gmail | Our "forgiveness over confirmation" principle |

### Anti-Patterns Confirmed by Research

1. **Modal dialogs for every action** — breaks flow, blocks dashboard view (NOC tools)
2. **Uniform visual weight for all entities** — forces scanning all 20 to find the 2 that matter (Veyon weakness)
3. **Showing L3 content at L1** — VNC thumbnails waste space when status dot + text suffice (classroom tools at scale)
4. **Fixed refresh intervals** — "last updated 5 minutes ago" breeds distrust. Use WebSocket push.
5. **Per-entity alerts without aggregation** — 20 agents x N errors = notification fatigue (NOC/monitoring tools)
6. **Sound by default** — doesn't scale. 20 agents = constant noise (all domains)
7. **Mixing severity levels with equal visual weight** — critical and info shown the same way (Kubernetes weakness)

## Deploy Flow (end-to-end)

The deploy flow is designed for zero-friction first deployment. A first-time user goes from zero to watching an agent work in under 60 seconds.

### Zero projects (absolute first visit)

```
┌────────────────────────────────────────────────────────────┐
│                                                     [user] │
│                                                            │
│                         ┌───────┐                          │
│                         │  ...  │                          │
│                         └───────┘                          │
│                                                            │
│                    Welcome to Agentobox                     │
│                                                            │
│             Deploy AI agents that write code,               │
│             run tests, and build software.                  │
│                                                            │
│              ┌───────────────────────────┐                  │
│              │  Create your first project │                  │
│              └───────────────────────────┘                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- No StatusBar segments (no project context yet)
- Single CTA: "Create your first project"
- Tapping opens inline input (not a modal — minimize friction)

### Zero agents (project exists, nothing deployed)

```
┌────────────────────────────────────────────────────────────┐
│ [my-saas-app v]                                     [user] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                         ┌───────┐                          │
│                         │  ...  │                          │
│                         └───────┘                          │
│                                                            │
│                   Deploy your first agent                   │
│                                                            │
│              Give it a role like "frontend" or              │
│              "backend" and it will start working.           │
│                                                            │
│                  ┌──────────────────────┐                   │
│                  │    Deploy Agent ->   │                   │
│                  └──────────────────────┘                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- StatusBar present but status segments empty
- Instructional copy teaches the naming convention: "Give it a role"
- "It will start working" sets the expectation that agents are autonomous
- No split pane rendered — nothing to list on either side

### DeploySheet (bottom sheet, not modal)

```
┌────────────────────────────────────────────────────────────┐
│ --                                                         │
│                                                            │
│   What should this agent work on?                          │
│                                                            │
│   ┌──────────────────────────────────────────────────────┐ │
│   │ frontend                                             │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                            │
│   ┌──────────────────────────────────────────────────────┐ │
│   │                    Deploy ->                         │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                            │
│   More options                                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- Bottom sheet, slides up. Drag handle at top. Swipe down to dismiss.
- One text input, auto-focused, placeholder: "frontend, backend, qa..."
- Deploy button: full-width, accent color, disabled until name is non-empty
- "More options" reveals: model, runtime, workspace, MCP, secrets, instructions (all with sensible defaults pre-filled)
- The prompt "What should this agent work on?" frames the name as a role, not a technical identifier

### Deploying -> Running transition

After tapping Deploy, the sheet dismisses and the dashboard transitions from empty state to split pane:

1. L1 panel appears with new agent card in deploying state (spinner + "Starting...")
2. L2 auto-selects the new agent (auto-navigate on deploy — the user wants to watch their first agent boot)
3. L2 shows deploying state: spinner, agent name, "This usually takes 30-60 seconds"
4. L0 updates: "1 deploying"
5. When agent finishes booting: spinner -> breathing dot, "Starting..." -> first action
6. ChatThread starts populating with ActionBubbles as agent reads files and orients
7. Message input becomes active — the user can send their first instruction

The transition is seamless. The user watched the agent boot and is now watching it work. They never left the screen.

### All agents stopped/completed

```
┌────────────────────────────────────────────────────────────┐
│ [my-saas-app v]  # 3 stopped              $12.47   [user] │
├──────────────────────┬─────────────────────────────────────┤
│                      │                                     │
│  [+ Deploy]          │   All agents have finished.          │
│                      │                                     │
│  ┌──────────────┐    │   ┌──────────────────────────┐      │
│  │ # frontend   │    │   │   Deploy a new agent ->  │      │
│  │   stopped 4m │    │   └──────────────────────────┘      │
│  └──────────────┘    │                                     │
│  ┌──────────────┐    │   or tap an agent to review         │
│  │ # backend    │    │   its work.                         │
│  └──────────────┘    │                                     │
│  ┌──────────────┐    │                                     │
│  │ # qa         │    │                                     │
│  │   stopped 1m │    │                                     │
│  └──────────────┘    │                                     │
│                      │                                     │
├──────────────────────┴─────────────────────────────────────┤
```

- L1 shows stopped agents (dimmed) — still tappable to review ChatThread
- L2 shows "All agents have finished" + deploy CTA + hint to review past work
- L0 shows total cost — a session summary
- Stopped agents' ChatThreads are read-only (no message input) — conversation is over, history preserved

## Undo Scope

| Action | Undo? | Behavior |
|--------|-------|----------|
| **Kill agent** | Yes, 8s | Undo = redeploy same config. Agent gets fresh session. |
| **Restart agent** | No | Restart IS the recovery action. Undoing recovery is confusing. |
| **Duplicate agent** | Yes, 8s | Undo = kill the duplicate. Accidental duplicate wastes resources. |
| **Config change** (model, MCP, instructions, secrets) | Yes, 8s | Undo = revert to previous value. Next agent turn uses old config. |
| **Send message** (single) | No | Messages are cheap and non-destructive. "Did the agent see it?" is confusing. |
| **Broadcast message** | 3s delay | Don't undo — delay sending. Show "Sending in 3..." progress bar on toast. Tap "Cancel" to prevent send. Gmail "Undo Send" pattern. |
| **Delete secret group** | Yes, 8s | Soft-delete for 8s, hard-delete after. Undo = un-hide. |

**General rule:** Undo for destructive/expensive actions. Delay-then-send for irreversible communications. Nothing for cheap/recovery actions.

## Feature Inventory

Each feature is classified by: level, interaction count (clicks to reach), location, and justification.

**Interaction count rules:**
- 0 = visible on page load, no interaction needed
- 1 = one click (select agent, open dropdown, etc.)
- 2 = two clicks (select agent + open section/fullscreen)
- K = keyboard shortcut (Cmd+K), faster than any click path
- hover = visible on mouseover

| Feature | Level | Clicks | Location | Justification |
|---------|-------|--------|----------|---------------|
| **Monitoring — Aggregate** | | | | |
| Agent count by status | L0 | 0 | StatusBar segments | Binary "do I need to act?" |
| Total cost | L0 | 0 | StatusBar | Spend awareness without drilling in |
| Burn rate ($/hr) | L0 | 0 | StatusBar | Derivative — where spend is going |
| Error count (clickable) | L0 | 0 | StatusBar segment (red) | Attention trigger — most important single number |
| Stalest idle duration | L0 | 0 | StatusBar idle segment | Flags forgotten agents |
| | | | | |
| **Monitoring — Per-Agent Scan** | | | | |
| Agent name | L1 | 0 | AgentListItem | Identity |
| Status dot (color-coded) | L1 | 0 | AgentListItem | Deviation signal — red/amber/green |
| Current action / error description | L1 | 0 | AgentListItem | Highest-value per-agent datum |
| Action age ("3s ago") | L1 | 0 | AgentListItem | Staleness detector |
| Run duration ("2h 14m") | L1 | 0 | AgentListItem | Compound signal with cost |
| Per-agent cost | L1 | 0 | AgentListItem | Spend per agent (if > threshold) |
| Liveness shimmer (active agents) | L1 | 0 | AgentListItem CSS | "This agent is working right now" |
| | | | | |
| **Monitoring — Per-Agent Detail** | | | | |
| Activity feed (tool calls, text) | L2 | 1 | DetailPane | Core of L2 — structured action history |
| Tool result content | L2 | 2 | ActivityFeed expand | Full output: 1 click select agent + 1 click expand item |
| Agent text / reasoning (full) | L2 | 2 | ActivityFeed expand | 2-line preview at 1 click, full at 2 |
| Diff view (file edits) | L2 | 2 | ActivityFeed expand on Edit items | Structured before/after inside expanded tool result |
| Agent metadata (model, runtime) | L2 | 1 | AgentHeader | Context for focused investigation |
| Session cost breakdown | L2 | 1 | AgentHeader | Detailed spend analysis |
| MCP servers attached | L2 | 2 | ConfigCollapsible (gear icon) | Diagnostic: 1 click agent + 1 click gear |
| Secret groups attached | L2 | 2 | ConfigCollapsible | Rarely needed |
| Instructions / responsibilities | L2 | 2 | ConfigCollapsible | Scope reference |
| Permission denials | L2 | 1 | AgentHeader badge | Agent blocked signal — visible without extra click |
| Error details | L2 | 1 | ActivityFeed (red, auto-expanded) | Errors show without extra expand click |
| | | | | |
| **Monitoring — Immersive** | | | | |
| VNC iframe (live desktop) | L3 | 2 | FullscreenView left pane | 1 click agent + 1 click fullscreen |
| VNC + feed side-by-side | L3 | 2 | FullscreenView split | Both signal types together |
| VNC in detail pane (opt-in) | L2 | 2 | DetailPane VncToggle | 1 click agent + 1 click "Show VNC" |
| | | | | |
| **Monitoring — Cross-Agent** | | | | |
| Fleet activity feed (all agents) | L1 | 1 | AgentListPanel toggle | 1 click to switch from list to feed view |
| | | | | |
| **Actions — Lifecycle** | | | | |
| Deploy new agent | L1 | 1 | DeployButton → DeployModal | 1 click opens modal |
| Kill agent | L2 | 2 | QuickActions | 1 click select + 1 click kill |
| Kill agent (keyboard) | L0 | K | Cmd+K "kill frontend" | Faster than any mouse path |
| Interrupt agent | L2 | 2 | QuickActions | 1 click select + 1 click interrupt |
| Restart agent | L2 | 2 | QuickActions | 1 click select + 1 click restart |
| Restart agent (keyboard) | L0 | K | Cmd+K "restart frontend" | Post-error fast path |
| Duplicate agent | L2 | 2 | QuickActions | 1 click select + 1 click duplicate |
| Kill from L1 (context menu) | L1 | 1 | Right-click AgentListItem | Power user shortcut |
| Batch kill/interrupt | L1 | 2 | Multi-select + BatchActionBar | 1 click select multiple + 1 click action |
| Batch kill (implicit) | L1 | 2 | Click L0 error segment + "Kill all" | 1 click filter + 1 click bulk action |
| | | | | |
| **Actions — Communication** | | | | |
| Message one agent | L2 | 1+type | MessageInput (DetailPane bottom) | 1 click select agent, then type |
| Message (keyboard) | L0 | K+type | Cmd+K "message frontend" | Fastest message path |
| Broadcast to all | L0 | 1+type | BroadcastButton (StatusBar) | 1 click opens broadcast input |
| Broadcast (keyboard) | L0 | K+type | Cmd+K "broadcast" | Fleet message fast path |
| Message filtered subset | L1 | 2+type | Multi-select + BatchActionBar | Select agents + message action |
| | | | | |
| **Actions — Runtime Config** | | | | |
| Change model | L2 | 2 | ConfigCollapsible | 1 click agent + 1 click gear + select |
| Add/remove MCP servers | L2 | 2 | ConfigCollapsible | 1 click agent + 1 click gear |
| Update instructions | L2 | 2 | ConfigCollapsible | 1 click agent + 1 click gear |
| Attach/detach secrets | L2 | 2 | ConfigCollapsible | 1 click agent + 1 click gear |
| | | | | |
| **Navigation** | | | | |
| Project switcher | L0 | 1 | StatusBar left dropdown | 1 click opens project list |
| New project | L0 | 2 | ProjectSwitcher → "+ New" | 1 click dropdown + 1 click new |
| Agent selection (L1 → L2) | L1 | 1 | Click AgentListItem | Core navigation — list to detail |
| Navigate to error agent | L0 | 1 | Click StatusSegment error | Navigate-to-worst: auto-filters + auto-selects |
| Navigate to stale agent | L0 | 1 | Click StatusSegment idle | Navigate-to-worst for idle agents |
| Go to agent (keyboard) | L0 | K | Cmd+K "go to frontend" | Keyboard navigation |
| L2 → L3 fullscreen | L2 | 1 | Button in DetailPane | 1 click from L2 (already selected agent) |
| L3 → L2 back | L3 | 1 | Escape key or close button | 1 press to exit immersive |
| View toggle (list/grid) | L1 | 1 | AgentListPanel header | Auto-switches at count > 6 |
| Search/filter agents | L1 | 0+type | AgentListPanel search input | Always visible, type to filter |
| Fleet feed toggle | L1 | 1 | AgentListPanel header | Switch list ↔ fleet feed |
| | | | | |
| **Notifications** | | | | |
| L0 bar real-time update | L0 | 0 | StatusBar segments | Passive — auto-updates |
| Toast on state transition | L0 | 0 | Bottom-right overlay | Auto-appears, no action needed to see |
| Toast → view agent | L0 | 1 | Toast "View" button | 1 click from toast to L2 |
| L1 row pulse on change | L1 | 0 | AgentListItem background flash | Peripheral vision, auto |
| | | | | |
| **Settings / Account** | | | | |
| User menu | L0 | 1 | StatusBar far right → dropdown | 1 click opens menu |
| Account settings | L0+1 | 2 | UserMenu → settings page | 1 click menu + 1 click item |
| Secret group CRUD | L0+1 | 2 | UserMenu → modal | 1 click menu + 1 click "Secret groups" |
| API key management | L0+1 | 2 | UserMenu → page | 1 click menu + 1 click item |
| Billing / usage | L0+1 | 2 | UserMenu → page | Reference, not monitoring |
| Logout | L0+1 | 2 | UserMenu → click | 1 click menu + 1 click logout |
| | | | | |
| **Content Types (within ActivityFeed)** | | | | |
| Tool call (1-line summary) | L2 | 1 | ActionItem | 1 click to select agent, item visible |
| Tool result (full content) | L2 | 2 | ActionItem expand | 1 click agent + 1 click chevron |
| Agent text (2-line preview) | L2 | 1 | TextItem | 1 click to select agent |
| Agent text (full) | L2 | 2 | TextItem expand | 1 click agent + 1 click "more" |
| Diff view | L2 | 2 | Edit ActionItem expand | 1 click agent + 1 click expand |
| Error output | L2 | 1 | ActionItem (auto-expanded, red) | Errors don't require extra click |
| Screenshot / image | L2 | 2 | ActionItem expand → thumbnail | 1 click agent + 1 click expand |
| VNC live view | L3 | 2 | FullscreenView | 1 click agent + 1 click fullscreen |

## Component Tree

```
<DashboardShell>
  ├── <StatusBar>                              # L0 — visual, not textual
  │     ├── <ProjectSwitcher />
  │     ├── <FleetHealth>                      # Visual dots/pills, not text counts
  │     │     ├── <StatusDot status="running" count={3} animated />
  │     │     ├── <StatusDot status="error" count={1} />
  │     │     └── <StatusDot status="idle" count={1} />
  │     ├── <CostPill total={4.82} rate={1.20} />
  │     └── <UserAvatar />                     # Tap → dropdown
  │
  ├── <NavigationStack>                        # Split pane on desktop, push/pop on mobile
  │     ├── <AgentListPanel>                   # L1 — chat-list style
  │     │     ├── <DeployButton />             # Large, prominent, accent color
  │     │     ├── <SearchInput />
  │     │     ├── <AgentList>
  │     │     │     ├── <AgentListItem variant="normal" />    # ~56px, breathing pulse
  │     │     │     ├── <AgentListItem variant="error" />     # ~88px, expanded, red border, inline Restart
  │     │     │     ├── <AgentListItem variant="stale" />     # ~56px, muted/dimmed
  │     │     │     └── <AgentListItem variant="deploying" /> # ~56px, progress spinner
  │     │     ├── <PeekOverlay />              # Space (desktop) / long-press (mobile)
  │     │     └── <BatchToolbar />             # Slides up on multi-select
  │     │
  │     └── <AgentDetailView>                  # L2 — chat-style thread
  │           ├── <DetailHeader>
  │           │     ├── <BackButton />          # ← returns to L1
  │           │     ├── <AgentAvatar animated />
  │           │     ├── <AgentName />
  │           │     ├── <StatusPill />
  │           │     ├── <InterruptButton />     # Always visible pause button
  │           │     └── <MoreMenu />            # Kill, Duplicate, Config, Rename
  │           ├── <ChatThread>                 # Core of L2
  │           │     ├── <ActionBubble />        # Tool call: icon + summary, tap to expand
  │           │     ├── <TextBubble />          # Agent text, left-aligned
  │           │     ├── <UserBubble />          # Operator message, right-aligned
  │           │     └── <ErrorBubble />         # Red, prominent, inline Restart
  │           ├── <VncSlide />                 # Horizontal swipe on mobile, toggle on desktop
  │           └── <MessageComposer>            # Fixed bottom bar
  │                 ├── <TextInput />
  │                 └── <SendButton />
  │
  ├── <DeploySheet>                            # Bottom sheet, not modal
  │     ├── <RoleInput />                      # "What should this agent work on?"
  │     ├── <DeployButton />                   # Big, primary
  │     └── <AdvancedOptions />                # Collapsed by default
  │
  ├── <CommandPalette />                       # Cmd+K — power user accelerator
  ├── <UndoToast />                            # 8-second undo for destructive actions
  ├── <NotificationToasts />                   # Bottom-right, state transitions
  │
  └── <FullscreenView>                         # L3 — VNC + ChatThread side by side
        ├── <DetailHeader />
        ├── <SplitPane>
        │     ├── <VncEmbed />
        │     └── <ChatThread />
        └── <MessageComposer />
```

## Build Phases

### Phase 1: L0 + L1 + ChatThread (the iPad moment)

Delivers the complete overview + scan + conversation experience. After this, a first-time user can deploy an agent, watch it work, message it, and kill it — without documentation.

| Step | Component | Description |
|------|-----------|-------------|
| 1 | StatusBar | FleetHealth dots (not text), CostPill, ProjectSwitcher, UserAvatar |
| 2 | AgentListItem | 3 variants: normal (~56px, breathing pulse), error (~88px, expanded, inline Restart), stale (~56px, dimmed) |
| 3 | AgentListPanel | DeployButton (prominent), SearchInput, AgentList |
| 4 | NavigationStack | Split pane on desktop, push/pop on mobile. Layout refactor. |
| 5 | DeploySheet | Bottom sheet, 1 required field ("What should this agent work on?"), sensible defaults, collapsed advanced options |
| 6 | ChatThread | ActionBubble, TextBubble, UserBubble, ErrorBubble (with inline Restart). The messaging paradigm. |
| 7 | MessageComposer | Fixed bottom bar, send button. Messaging as natural as texting. |
| 8 | UndoToast | 8-second undo for Kill. Forgiveness over confirmation. |
| 9 | CommandPalette | Cmd+K — power user accelerator (not primary path) |

**Build order:** Steps 1-4 are structural minimum (skeleton). Steps 5-7 are the iPad moment (skin). Steps 8-9 are interaction polish.

### Phase 2: Triage + configuration

| Component | Description |
|-----------|-------------|
| PeekOverlay | Space-to-Peek (desktop) / long-press (mobile) for rapid L2 triage |
| BatchToolbar | Multi-select + contextual batch actions (Stop, Restart, Message) |
| ConfigCollapsible | Runtime config in MoreMenu (model, MCP, secrets, instructions) |
| VncSlide | Opt-in VNC access (horizontal swipe on mobile, toggle on desktop) |
| NotificationToasts | Agent state transition alerts, bottom-right |
| Restart count badge | Shows on error indicator when restart count > 0 |
| Duplicate agent | 1-click scale-out in MoreMenu |

### Phase 3: L3 + generative UI + polish

| Component | Description |
|-----------|-------------|
| FullscreenView | VNC + ChatThread side-by-side, resizable |
| Generative UI bubbles | ApprovalCard, ChoiceSelector, DataPreview — agent-presented interactive elements in ChatThread |
| Empty states | Zero projects, zero agents, all-stopped onboarding screens |
| Keyboard shortcuts overlay | `?` key → shortcut reference |

## Backend Data Requirements

To power L0 and L1, the backend needs to expose:

- **Aggregate query:** Agent counts by status, total cost across project, burn rate (sum of active agents' $/hr)
- **Per-agent fields:** `current_action` (last tool call name + primary arg), `last_action_at` (timestamp), `run_duration` (uptime since deploy), `session_cost_usd` (already exists)
- **Error context:** When status is error, the last error message / failing tool name
- **Restart mutation:** Kill + redeploy with same config (name, model, runtime, MCP, secrets, workspace, instructions)
- **Duplicate mutation:** CreateAgent with config copied from existing agent
- **Runtime config mutations:** `updateAgentModel`, `updateAgentMcpServers`, `updateAgentInstructions`, `updateAgentSecrets`

## Design Rules

1. Presentation depth is a function of necessity — the most-needed data gets the most visual real estate.
2. Default to L1, not L3.
3. L0 is always visible.
4. Each level transition = single interaction.
5. Information scent at every level — each level hints at what the next level contains.
6. Navigate-to-worst — any L0 click routes to the entity most likely to need intervention.
7. Every feed item = one line by default. Expansion is opt-in.
8. VNC is an escape hatch, not the default view.

---

## UX Critique: Non-Programmer Perspective

Walkthrough from the perspective of a tech-savvy non-programmer (iPad/Excel level). 15 findings across 4 categories.

### What's Confusing

**1. MCP is jargon.** "MCP servers" means nothing to a non-technical user. Should be "Tools" or "Capabilities." The user thinks: "I want my agent to use GitHub" — not "I need to attach an MCP server."

**2. "Interrupt" is ambiguous.** Does it pause? Cancel? Kill? The word doesn't predict the outcome. "Pause" is universally understood. Show "Paused" state clearly, with "Resume" as the obvious next action.

**3. StatusBar is dense.** `[3 running] [1 error] [1 idle 12m] — $4.82 — $1.20/hr` is seven data points in one bar. Non-programmers will skip it entirely. Solution: use visual encoding (colored dots, proportional segments) — text labels secondary.

**4. MoreMenu hides critical actions.** Kill, Restart, Config behind three dots. When an agent errors, the user needs to restart — not hunt through a menu. The expanded error card with inline Restart at L1 is the right fix. MoreMenu is for infrequent actions only.

**5. "Broadcast" is military vocabulary.** "Message all agents" or "Tell everyone" is what a non-programmer would say. The feature itself is powerful but the label gatekeeps.

**6. ActionBubbles are illegible to non-programmers.** `Read src/auth.ts (+14 -3 lines)` means nothing. The user needs to know *what happened*, not the technical operation. Better: "Made changes to the login page" with a "Show details" option for the technical content.

### What Feels Bland

**7. No progress toward a goal.** The user sees agents doing things but not progressing toward anything. There's no "60% done" or "3 of 5 files updated." Without progress, autonomous agents feel like perpetual motion machines — busy but unproductive.

**8. No personality.** Every agent looks the same — same card, same layout, same everything. When you have 5 agents, distinguishing them requires reading names. Unique avatars, color accents per agent, or distinct visual identities make the fleet feel alive.

**9. Nothing celebrates completion.** When an agent finishes a task, nothing happens. A subtle success state — brief flash, checkmark, completion message — gives the user the satisfaction of "it worked." Without it, agents just... stop.

**10. No way to see actual output.** The user thinks: "What did my agent build?" There's no way to see the end result without digging into VNC or reading tool call logs. A "Show what changed" summary at task completion would transform the experience.

### What's Awkward

**11. Space-to-Peek is undiscoverable on mobile.** The long-press equivalent has no affordance. Nothing tells the user "hold here for a preview." Consider a visible "peek" swipe gesture or simply make tap-to-navigate fast enough that peek becomes unnecessary.

**12. Instructions are buried behind 3+ taps.** MoreMenu -> Config -> Instructions. But instructions are the most important thing the user set. They should be visible at L2, not hidden in config — at least as a collapsed summary.

**13. Expired approval cards feel like lost control.** When a TTL expires and buttons gray out with "Expired," the user thinks they missed something important. Need a fallback: "This decision was needed 5 minutes ago. The agent [continued without it / is waiting for you to decide / chose a default]."

### What I Wish I Had

**14. Plain-English activity summary.** Instead of `Read package.json (8s ago)`, show `Checking project setup` at L1, with the technical details on expand. The agent should narrate what it's doing in human terms, not developer terms.

**15. Group chat for broadcast.** When I "message all agents," I want to see their responses together — like a group chat. Not 5 separate threads. The coordination pattern needs a coordination view.

## Time as a Design Dimension

Agents have narrative arcs, not just status states. A user's emotional relationship with an agent changes over time:

| Phase | User feeling | What UI should communicate |
|-------|-------------|---------------------------|
| Just deployed | Excitement + uncertainty | "It's starting up, give it a moment" |
| Deep in work (10min+) | Trust building | "It's been productive — here's what it's done" |
| Wrapping up | Anticipation | "Almost done — reviewing its work" |
| Idle for a while | Suspicion | "Why did it stop? Is it stuck?" |
| Done | Satisfaction (if shown) | "Completed. Here's the summary." |
| Errored | Concern | "Something went wrong. Here's what to do." |

**Design implication:** The card's visual treatment should subtly shift across these phases. Not just status colors, but the overall feeling. An agent that's been running for 2 hours and completed 50 tool calls should feel "mature" compared to one just deployed. Duration badges, activity counts, or progress indicators serve this.

**Agent arcs matter for trust.** The user needs to build trust over the agent's lifetime. Liveness signals serve "process trust" (I can see it working), but the arc serves "performance trust" (it's actually getting things done). Showing cumulative progress — files changed, tests passed, tasks completed — builds performance trust.

## Vocabulary Decisions

Every user-facing label must be immediately understandable to a non-programmer.

| Current term | Problem | Proposed | Rationale |
|-------------|---------|----------|-----------|
| Deploy | Infrastructure jargon | **Launch** or **Start** | "Launch an agent" is intuitive |
| Kill | Violent, alarming | **Stop** | Universal, non-threatening |
| Fleet | Military, cold | **Your agents** / **Team** | Personal, warm |
| Broadcast | Military radio | **Message all** / **Tell everyone** | Conversational |
| Interrupt | Ambiguous (pause? cancel?) | **Pause** | Clear, reversible connotation |
| MCP servers | Protocol jargon | **Tools** / **Capabilities** | What the user actually thinks about |
| Runtime | Developer concept | Hidden behind "More options" | Non-programmers don't choose runtimes |
| Workspace path | Filesystem concept | **Project folder** or hidden | If auto-detected, don't show |

**The bento box principle:** The original name concept — "Agent Bento Boxes" — carries a design philosophy. A bento box is neat, complete, carefully prepared. Everything in its place. Each compartment serves a purpose. No wasted space, no confusion about what goes where. The dashboard should feel like opening a well-organized bento box, not like looking at a server monitoring panel.

Design direction: **Notion, not Grafana.** Clean, calm, organized. Complexity exists but is revealed progressively. The visual language should feel considered and intentional — like someone carefully arranged every element.

## Predefined Team Configurations

Common team setups should be one-click deployable. Instead of creating agents one by one, users pick a team template and customize.

### Team Templates

| Template | Agents | Description |
|----------|--------|-------------|
| **Solo developer** | 1 agent (fullstack) | Single agent with broad instructions. Good for small projects. |
| **Frontend + Backend** | 2 agents | Split by concern. Frontend handles UI/components, backend handles API/DB. |
| **Full team** | 3-4 agents | Frontend, backend, QA/testing, and optionally DevOps/infrastructure. |
| **Research team** | 2-3 agents | Literature review, data analysis, synthesis. Non-coding use case. |
| **Custom** | N agents | User defines from scratch. |

### Template Structure

Each template defines:
- **Agent names** — pre-filled (editable)
- **Instructions per agent** — role description + responsibilities + coordination notes
- **Recommended model** — per agent (e.g., Opus for architect, Sonnet for implementation)
- **MCP servers** — per agent (e.g., GitHub for all, browser for frontend)
- **Coordination hints** — how agents should communicate (embedded in instructions)

### Deploy Flow with Templates

```
┌────────────────────────────────────────────────────────────┐
│ --                                                         │
│                                                            │
│   How do you want to work?                                 │
│                                                            │
│   ┌──────────────────────────────────────────────────────┐ │
│   │  Solo developer                                      │ │
│   │  One agent handles everything                        │ │
│   └──────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────┐ │
│   │  Frontend + Backend                                  │ │
│   │  Two agents, split by concern                        │ │
│   └──────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────┐ │
│   │  Full team                                           │ │
│   │  Frontend, backend, QA — the works                   │ │
│   └──────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────┐ │
│   │  Custom setup                                        │ │
│   │  Define your own team                                │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                            │
│   These are starting points — you can add or remove        │
│   agents anytime.                                          │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

After selecting a template, user sees a summary of agents to be created with editable names/instructions. One "Launch team" button deploys all simultaneously.

### Team Lead Agent

Every team template includes an implicit or explicit **team lead** concept:

- **For "Solo developer":** The single agent IS the lead (no coordination needed).
- **For multi-agent templates:** The team lead is an agent whose instructions include: awareness of other agents' roles, ability to coordinate work distribution, responsibility for high-level planning.
- The team lead is deployed first and receives a CLAUDE.md that lists all team members and their roles.
- Future: team lead auto-deploys with the project and persists across sessions.

### Backend Requirements for Templates

- `TeamTemplate` model: name, description, agent_configs (JSON array of {name, model, instructions, mcp_servers})
- `deployTeam` mutation: takes template_id + project_id, creates all agents in parallel
- Seed data: built-in templates shipped with the product
- User templates: users can save their current team config as a reusable template

## Inter-Agent Awareness

**Current state:** Agents are completely isolated. Each runs in a separate container. While Claude Code team flags (`--team-name`, `--parent-session-id`) are set, the file-based mailbox doesn't work across containers.

**Gap analysis:**
- CLAUDE.md has no team roster — agents don't know who else exists
- No agent-to-agent messaging — only user-to-agent via `sendMessage`
- No shared state beyond workspace mounts
- Claude Code's native mailbox system (`~/.claude/tasks/{team-name}/`) assumes co-located processes on the same filesystem

**Required fixes (priority order):**

1. **Team roster in CLAUDE.md** — When provisioning, inject a `## Team` section listing all agents in the project with their names, roles (from instructions), and status. Update when agents join/leave.

2. **Backend-routed inter-agent messaging** — Agent A sends a message to Agent B via an MCP tool (`send_message_to_agent`). The backend enqueues it in B's `pending_input`. This replaces file-based IPC with API-based routing.

3. **MCP tool for team state** — `get_team_status` tool returns current state of all agents in the project. Agents can query who's running, who errored, what each agent is working on.

4. **Shared context via workspace** — For agents that share a workspace, coordinate via filesystem conventions (e.g., `TASKS.md`, `STATUS.md`). This is the simplest coordination mechanism and works today if workspace_path is set.
