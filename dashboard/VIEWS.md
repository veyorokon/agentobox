# Dashboard Views

Design brief for the agentobox dashboard. Single-page app with two routes: `/login` and `/` (main dashboard). Uses augmented-ui for cyberpunk-style clipped borders, shadcn/ui components, and Tailwind.

## Context

Agentobox is a multi-agent orchestration system. Users create **projects**, each containing multiple **agents**. Each agent is a Claude Code instance in an isolated Linux desktop container with browser access and VNC streaming.

**Agent statuses:** `deploying`, `running`, `idle`, `stopped`, `error`

Each agent streams structured messages (text, tool_use, tool_result) via the stream-json relay and reports session cost.

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

Persistent sidebar with chat interface:

- Agent selector dropdown
- Message input with send button
- Chat history with `ChatView` component (stream-json messages)
- Messages rendered as typed content parts: text, tool_use, tool_result

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
- Agent name + status dot (color-coded)
- Animated spinner word when running
- Session cost badge
- VNC stream thumbnail (live desktop view via `vncUrl`)
- Action buttons: refresh VNC, pause/resume, kill agent
- Kill confirmation modal

**Status colors (CSS custom properties):**
- `deploying` → `--agent-deploying`
- `running` → `--agent-active`
- `idle` → `--agent-active` (dimmed)
- `stopped` → `--muted-foreground`
- `error` → `--agent-dead`

### StatusBadge

Color-coded badge showing agent status. Maps status enum to color token and display label.

### ProjectSelector

Dropdown for selecting existing projects or creating new ones. Uses `useProjectsStore`.

### DeployModal

Form for deploying a new agent:
- Name (text input)
- Instructions (textarea)
- Workspace path (text input)
- MCP servers (JSON input)
- Runtime selector

On submit: calls `CREATE_AGENT_MUTATION`, shows toast with deploy progress.

### VncFrame

Iframe wrapper for noVNC stream. Exposes refresh callback via ref.

### ChatView

Renders stream-json messages as typed content parts. User messages show as outbound bubbles, assistant messages as inbound with text/tool blocks.

### ConfirmModal

Reusable confirmation dialog with destructive variant for kill operations.

---

## Data Flow

### GraphQL Operations

**Queries:**
- `ME_QUERY` — current user
- `PROJECTS_QUERY` — user's projects
- `AGENTS_QUERY` — agents for a project
- `AGENT_MESSAGES_QUERY` — stream messages + session result for an agent

**Mutations:**
- `LOGIN_MUTATION`, `REGISTER_MUTATION` — auth
- `CREATE_PROJECT_MUTATION` — new project
- `CREATE_AGENT_MUTATION` — deploy agent
- `KILL_AGENT_MUTATION` — terminate agent
- `SEND_MESSAGE_MUTATION` — message an agent
- `INTERRUPT_AGENT_MUTATION` — pause an agent

**Subscriptions:**
- `AGENT_UPDATED_SUBSCRIPTION` — real-time agent state changes
- `MESSAGE_RECEIVED_SUBSCRIPTION` — real-time stream messages

### State Management (Zustand)

- `useAuthStore` — token, user, login/logout
- `useProjectsStore` — projects list, current project ID
- `useAgentsStore` — agents indexed by project ID, upsert on subscription

---

## Theme

- Augmented-ui for cyberpunk clipped borders on cards, buttons, panels
- Light/dark theme support
- Monospace font for status text and metadata
- Muted foreground for secondary text
- Accent color for primary actions and highlights
