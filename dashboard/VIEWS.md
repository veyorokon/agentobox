# AgentBox Dashboard Views

Design brief for frontend implementation. Use the existing aesthetic from `ui-ux-designer-chat/` as reference. Follow the same design language, color palette, and component patterns. Use shadcn/ui components and Tailwind.

## Context

AgentBox is a multi-agent orchestration system. Users create **bentos** (projects), each with one **Agento** (orchestrator) and multiple **boxes** (worker agents). Each worker is a Claude Code instance in an isolated Linux desktop container with browser access.

Agent states: `idle`, `working`, `completed`, `blocked`, `dead`
Each state has a free-form message (e.g. "browsing google.com", "need GitHub credentials").

---

## View 1: Bento List (`/`)

Landing page. Grid of project cards.

**Each bento card shows:**
- Project name
- Number of active agents (boxes)
- Agento status indicator (online/offline pulse)
- Summary: "3 working, 1 blocked, 2 idle"
- Last activity timestamp

**Actions:**
- "Create Bento" button → opens modal (just name field for now)
- Click card → navigate to `/bento/[id]`

**Layout:** Responsive grid, 2-3 columns

---

## View 2: Bento Grid (`/bento/[id]`)

Main workspace for a project. Split layout.

**Left: Agento Chat Sidebar (~350px, persistent)**
- Chat interface between user and Agento
- Message input at bottom
- Conversation flow: user on right, Agento on left
- This is clean chat — no system events shown here
- Agento status indicator at top

**Right: Box Grid (main area)**
- Grid of agent cards
- Responsive: 2-3 columns depending on width

**Each box card shows:**
- Agent name
- State badge (colored by state)
- Status message (the free-form text)
- Thumbnail area (placeholder for sprite — show a colored box with state icon for now)

**Card states (visual distinction):**
- `idle`: Muted/gray
- `working`: Active/blue, subtle animation
- `completed`: Success/green
- `blocked`: Warning/orange, attention-grabbing
- `dead`: Dimmed/red, faded

**Actions:**
- "Create Agent" button in grid area
- Click card → navigate to `/bento/[id]/[name]`
- Tab/link to Event Feed

---

## View 3: Box Detail (`/bento/[id]/[name]`)

Full view for a single agent. Split layout.

**Top section (~60% height):**
- Large placeholder for live desktop (dark area with "Live Desktop" text, "LIVE" indicator in corner)
- Adjacent or below: Terminal panel (dark background, monospace placeholder text, scrollable)
- These could be side-by-side or stacked depending on viewport

**Bottom section:**
- Agent info panel: name, state badge, current message, uptime, created timestamp
- Controls row:
  - "Send Message" button (opens input modal or inline input)
  - "Kill Agent" button (red, with confirmation)
- Recent events: compact list of last 5-10 state changes with timestamps

**Navigation:**
- Back button/breadcrumb to bento grid
- Agent name in header

---

## View 4: Event Feed (`/bento/[id]/events`)

Activity log for the entire project. Timeline view.

**Each event row shows:**
- Timestamp (compact format)
- Agent name as colored badge
- State as text or icon
- Message text

**Filters (top of page):**
- Agent filter: multi-select dropdown (filter to specific agents)
- State filter: toggle buttons for each state (idle, working, completed, blocked, dead)

**Layout:**
- Compact rows, scannable log format
- State badges use consistent colors from the rest of the app
- Reverse chronological (newest first) with option to toggle

**Navigation:**
- Same layout as bento grid (agento chat sidebar persists)
- Tab to switch between Grid and Events

---

## View 5: Navigation

**Top nav bar (all views):**
- App logo/name: "AgentBox" (left)
- When in a project: breadcrumb showing project name, link back to bento list
- Navigation: links to Grid, Events (when inside a project)

**Agento chat sidebar:**
- Persists across Grid and Events views within a project
- Collapsible on mobile
- Not shown on the Bento List page

---

## Mock Data

Use placeholder data for all views:

**Projects (3-4):**
- "Website Redesign" - 4 agents, 2 working, 1 completed, 1 idle
- "Competitor Research" - 2 agents, 1 blocked ("need login credentials"), 1 working
- "Data Migration" - 3 agents, all completed

**Agents per project:**
- scout: working, "browsing competitor websites"
- researcher: completed, ""
- writer: idle, "waiting for next task"
- builder: blocked, "need GitHub credentials"

**Events (10-15 sample):**
- Timestamps in last hour
- Mix of all states
- Realistic messages

**Chat messages (5-6):**
- User: "Create 3 agents to research competitors"
- Agento: "I've created scout, researcher, and analyst..."
- etc.

---

## Notes

- Focus on layout, information hierarchy, interaction patterns
- Components will be wired to real data later
- Use the existing `ui-ux-designer-chat/components/ui/` library
- Match the bold, distinctive aesthetic of the existing mockup
- State colors should be consistent and meaningful across all views
