# Dashboard Views

Design brief for the agentobox dashboard. Single-page app with two routes: `/login` and `/` (main dashboard). Uses augmented-ui for cyberpunk-style clipped borders, shadcn/ui components, and Tailwind.

## Context

Agentobox is a multi-agent orchestration system. Users create **projects**, each containing multiple **agents**. Each agent is a Claude Code instance in an isolated Linux desktop container with browser access and VNC streaming.

**Agent statuses:** `working`, `conversing`, `needs_info`, `blocked`, `completed`, `goal_changed`, `dead`

**Goal statuses:** `active`, `satisfied`, `abandoned`

Each agent has a goal (text + context path + plan) and reports status with confidence, sentiment, summary, and reasoning fields.

---

## Route: Login (`/login`)

Authentication page. Register or login with email/password.

**Layout:**
- Centered card with augmented-ui border
- Toggle between login and register forms
- On success: stores JWT token, redirects to `/`

**State:** `useAuthStore` — manages token and user info.

---

## Route: Dashboard (`/`)

Main workspace. Two states based on whether a project is selected.

### No Project Selected

Centered landing with:
- Agentobox logo (augmented-ui clipped box with "A")
- "Create a project to get started" message
- `ProjectSelector` component

### Project Selected — Split Layout

Full-height flex layout: `CommandPanel` (left sidebar) + main agent grid (right).

#### CommandPanel (Left Sidebar)

Persistent sidebar with two tabs:

1. **Chat Tab** — Send messages to agents
   - Agent selector dropdown
   - Message input
   - Chat history with `ChatBubble` components

2. **Events Tab** — Real-time event feed
   - `EventFeed` component showing agent state changes
   - Each event: timestamp, agent name badge, status, message
   - Auto-scrolls on new events

**Top of sidebar:** `ProjectSelector` for switching/creating projects.

#### Main Area (Right)

**Header row:**
- Agent count: "N agents deployed"
- "+ Deploy Agent" button (augmented-ui styled) → opens `DeployModal`

**Agent Grid:**
- Responsive: 1 column default, 2 columns on XL screens
- Each agent rendered as `AgentCard`

**Empty state:** "No agents deployed yet" centered message.

---

## Components

### AgentCard

Displays a single agent with:
- Agent name + status badge (`StatusBadge`)
- VNC stream thumbnail (live desktop view via `vncUrl`)
- Goal text and plan
- Confidence/sentiment indicators
- Summary and reasoning text
- Action buttons: send message, kill agent

**Status colors (CSS custom properties):**
- `working` → `--agent-active`
- `conversing` → `--agent-conversing`
- `needs_info` → `--agent-needs-info`
- `blocked` → `--agent-blocked`
- `completed` → `--agent-completed`
- `goal_changed` → `--agent-goal-changed`
- `dead` → `--agent-dead`

### StatusBadge

Color-coded badge showing agent status. Maps status enum to color token and display label.

### ProjectSelector

Dropdown for selecting existing projects or creating new ones. Uses `useProjectsStore`.

### DeployModal

Form for deploying a new agent:
- Name (text input)
- Goal text (textarea)
- Context path (text input)
- Runtime: currently hardcoded to "modal"

On submit: calls `CREATE_AGENT_MUTATION`, shows toast with deploy progress.

### EventFeed

Scrollable list of `AgentEvent` entries for the current project. Events arrive via `NEW_EVENT_SUBSCRIPTION`.

### ChatBubble

Individual message in the chat panel. Shows sender, message text, timestamp.

---

## Data Flow

### GraphQL Operations

**Queries:**
- `ME_QUERY` — current user
- `PROJECTS_QUERY` — user's projects
- `AGENTS_QUERY` — agents for a project
- `GOALS_QUERY` — goals for a project

**Mutations:**
- `LOGIN_MUTATION`, `REGISTER_MUTATION` — auth
- `CREATE_PROJECT_MUTATION` — new project
- `CREATE_AGENT_MUTATION` — deploy agent
- `KILL_AGENT_MUTATION` — terminate agent
- `SEND_MESSAGE_MUTATION` — message an agent

**Subscriptions:**
- `AGENT_UPDATED_SUBSCRIPTION` — real-time agent state changes
- `NEW_EVENT_SUBSCRIPTION` — real-time event feed

### State Management (Zustand)

- `useAuthStore` — token, user, login/logout
- `useProjectsStore` — projects list, current project ID
- `useAgentsStore` — agents indexed by project ID, upsert on subscription
- `useEventsStore` — events indexed by project ID, append on subscription

---

## Theme

- Augmented-ui for cyberpunk clipped borders on cards, buttons, panels
- Light/dark theme support
- Monospace font for status text and metadata
- Muted foreground for secondary text
- Accent color for primary actions and highlights
