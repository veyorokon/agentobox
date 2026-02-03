# AgentBox Dashboard Architecture

## Overview

The dashboard is a Next.js application for observing and controlling AgentBox agents. Users create **bentos** (projects), each containing one **Agento** (orchestrator) and multiple **boxes** (worker agents). Each box runs inside an isolated Linux desktop container with browser and GUI tools.

## Stack

| Layer | Tech | Purpose |
|-------|------|---------|
| Framework | Next.js 16 (App Router) | Pages, API routes, WebSocket proxies |
| UI | React 19 | Components |
| Styling | Tailwind CSS 4 + shadcn/ui | Design system (lifted from existing mockups) |
| State | Zustand | Agent state, events, chat, projects |
| Real-time | SSE | Live event stream from callback server |
| Desktop streams | noVNC + WebSocket proxy | Live VNC per agent |
| Terminal | xterm.js + WebSocket proxy | Live tmux output per agent |
| Sprites | fal.ai | Generate pixel art from agent status messages |

## Naming Convention (Bento Theme)

| Concept | Name | Description |
|---------|------|-------------|
| Project | **Bento** | A complete agent workspace |
| Worker agent | **Box** | Individual compartment in the bento |
| Orchestrator | **Agento** | The coordinator that manages boxes |
| Agent grid | **Bento Grid** | Tiled view of all boxes |
| Agent detail | **Box Detail** | Expanded view of a single box |

## Routes

```
/                           # Bento list (all projects)
/bento/[id]                 # Project view (agent grid + agento chat)
/bento/[id]/events          # Event feed for project
/bento/[id]/[name]          # Box detail (VNC + terminal + controls)
```

## API Routes

```
/api/agents                 # Proxy to agent-manager (list, create, kill, send)
/api/events/stream          # SSE endpoint — streams events from callback server
/api/vnc/[name]             # WebSocket proxy → agent's VNC (port 6901)
/api/terminal/[name]        # WebSocket proxy → agent's tmux output
/api/sprites/[hash]         # Cached sprite images
```

## Folder Structure

```
dashboard/
├── app/
│   ├── layout.tsx                    # Root layout (providers, nav)
│   ├── page.tsx                      # / → Bento list
│   ├── bento/
│   │   └── [id]/
│   │       ├── layout.tsx            # Project layout (agento chat persists)
│   │       ├── page.tsx              # Bento grid (all boxes)
│   │       ├── events/
│   │       │   └── page.tsx          # Event feed
│   │       └── [name]/
│   │           └── page.tsx          # Box detail
│   └── api/
│       ├── agents/
│       │   └── route.ts              # Proxy to agent-manager
│       ├── events/
│       │   └── stream/
│       │       └── route.ts          # SSE from callback server
│       ├── vnc/
│       │   └── [name]/
│       │       └── route.ts          # WebSocket → VNC
│       └── terminal/
│           └── [name]/
│               └── route.ts          # WebSocket → tmux
│
├── components/
│   ├── ui/                           # shadcn/ui primitives (lifted)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   └── ...
│   │
│   ├── bento/                        # Project-level components
│   │   ├── bento-card.tsx            # Project card for list view
│   │   ├── bento-grid.tsx            # Grid layout wrapper
│   │   └── create-bento-modal.tsx    # New project modal
│   │
│   ├── box/                          # Agent-level components
│   │   ├── box-card.tsx              # Agent card (sprite + state + msg)
│   │   ├── box-desktop.tsx           # noVNC iframe wrapper
│   │   ├── box-terminal.tsx          # xterm.js wrapper
│   │   ├── box-controls.tsx          # Kill, send message buttons
│   │   ├── box-info.tsx              # State, uptime, metadata
│   │   └── box-sprite.tsx            # Pixel art display
│   │
│   ├── agento/                       # Orchestrator components
│   │   ├── agento-chat.tsx           # Chat sidebar
│   │   └── agento-status.tsx         # Online/offline indicator
│   │
│   ├── events/                       # Event feed components
│   │   ├── event-row.tsx             # Single event line
│   │   ├── event-feed.tsx            # Scrollable list
│   │   └── event-filters.tsx         # State/agent filters
│   │
│   └── layout/                       # Shell components
│       ├── nav.tsx                   # Top nav bar
│       ├── sidebar.tsx               # Agento chat sidebar wrapper
│       └── breadcrumb.tsx
│
├── stores/
│   ├── agents.ts                     # Agent state (per project)
│   ├── events.ts                     # Event stream
│   ├── projects.ts                   # Project/bento list
│   └── chat.ts                       # Agento chat messages
│
├── hooks/
│   ├── use-event-stream.ts           # SSE subscription
│   ├── use-agent.ts                  # Single agent selector
│   ├── use-agents.ts                 # All agents for project
│   └── use-mobile.ts                 # Responsive helper
│
├── lib/
│   ├── utils.ts                      # cn() helper
│   ├── api.ts                        # Fetch helpers
│   └── constants.ts                  # State colors, config
│
└── types/
    ├── agent.ts                      # AgentState, AgentEvent, AgentStatus
    ├── project.ts                    # Bento types
    └── events.ts                     # SSE event types
```

## Data Flow

### Events (Server → Client)

```
Callback Server (port 9900)
  → GET /events/stream (SSE)
  → Dashboard API route
  → SSE to browser
  → Zustand store update
  → React re-render
```

### Agent Commands (Client → Server)

```
User action (create, kill, send message)
  → Zustand action
  → POST /api/agents
  → Proxy to agent-manager MCP (via Agento's callback server or direct)
  → Docker container action
```

### VNC Streams (parallel WebSockets)

```
Browser opens N WebSocket connections (one per visible agent):
  ws://app/api/vnc/scout      → proxy → abox-scout:6901
  ws://app/api/vnc/researcher → proxy → abox-researcher:6901
  ...

Each connection is independent. KasmVNC encodes frames per-agent.
Grid view shows up to 4 simultaneous streams (configurable).
Inactive agents show sprite instead of live desktop.
```

### Terminal Streams

```
Same pattern as VNC:
  ws://app/api/terminal/[name] → proxy → docker exec tmux capture
```

## Agent States

| State | Color | Description |
|-------|-------|-------------|
| `idle` | Gray | Ready for tasks |
| `working` | Blue | Executing task, msg describes activity |
| `completed` | Green | Finished task |
| `blocked` | Orange/Yellow | Needs help, msg explains why |
| `dead` | Red | Session/container lost |

## Views

### 1. Bento List (`/`)

Grid of project cards. Each card shows:
- Project name
- Agent count
- Agento status (online/offline)
- Summary: working/blocked/completed counts
- Last activity

Actions: Create new bento

### 2. Bento Grid (`/bento/[id]`)

Main workspace. Two areas:

**Left sidebar (~350px): Agento Chat**
- Persistent across grid and events views
- User ↔ Agento conversation
- Event messages filtered out (clean chat)

**Main area: Box Grid**
- Cards for all agents in this bento
- Each card: sprite, name, state badge, status message
- Click to navigate to box detail
- Toggle: sprite view vs desktop tile view (4 max VNC streams)

Actions: Create new agent

### 3. Box Detail (`/bento/[id]/[name]`)

Full agent view. Split layout:

**Top (~60%): Desktop + Terminal**
- noVNC iframe (live desktop, full resolution)
- Terminal panel (xterm.js, tmux output)
- Resizable split

**Bottom: Info + Controls**
- Agent info: name, state, message, uptime, created
- Controls: Send message, Kill agent
- Recent events for this agent

### 4. Event Feed (`/bento/[id]/events`)

Activity log. Chronological timeline:
- Timestamp
- Agent name (badge)
- State
- Message

Filters:
- By agent (multi-select)
- By state (toggles)

## Production Considerations

### VNC Bandwidth

Each VNC stream: 1-5 Mbps depending on activity.
Grid view caps at 4 simultaneous streams.
Inactive/idle agents show sprite instead of live stream.
KasmVNC supports quality/resize params for compact tiles.

### WebSocket Limits

Browser allows 255 WebSockets per domain (Chrome).
4-6 VNC + terminal streams is well within limits.
Connections are lazy: mount = connect, unmount = disconnect.

### Deployment

Dashboard runs as a service in docker-compose alongside Agento.
Single domain, single port — API routes proxy to backend services.
In K8s/Modal: service discovery replaces docker port mapping.
