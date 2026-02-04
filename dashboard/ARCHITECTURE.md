# agentobox Architecture

## Overview

agentobox is a full-stack Next.js application for orchestrating and observing AI agents. Users chat with **agento** (the orchestrator), which deploys and manages **agents** — each running inside an isolated Linux desktop container with browser and GUI tools.

The app serves as both the dashboard and the backend. It embeds the agent manager as a shared library and exposes an MCP endpoint, so the same codebase works locally or deployed.

```
┌──────────────────────────────────────────────────┐
│               agentobox (Next.js)                │
│                                                  │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  Dashboard   │  │      API Routes          │  │
│  │  (React)     │  │                          │  │
│  │             ─┼──▶ /api/agents              │  │
│  │ command panel│  │ /api/agents/:id/events   │  │
│  │ agent grid   │  │ /api/chat                │  │
│  │ vnc streams  │  │ /api/mcp  ← MCP endpoint │  │
│  └─────────────┘  └────────────┬─────────────┘  │
│                                 │                 │
│                  ┌──────────────▼──────────────┐  │
│                  │  Agent Manager Library       │  │
│                  │                              │  │
│                  │  state registry (agents)     │  │
│                  │  event store (history)       │  │
│                  │  docker management           │  │
│                  │  id generation               │  │
│                  └──────────────┬──────────────┘  │
│                                 │                 │
└─────────────────────────────────┼─────────────────┘
                                  │
                        Docker API (local or remote)
                                  │
                  ┌───────────────▼───────────────┐
                  │      Docker Containers         │
                  │  ┌────────┐  ┌────────┐       │
                  │  │ scout  │  │ writer │  ...  │
                  │  │ claude │  │ claude │       │
                  │  │ + vnc  │  │ + vnc  │       │
                  │  └────────┘  └────────┘       │
                  └────────────────────────────────┘
```

## Local vs Cloud

Same app, same code. The only difference is configuration.

| | Local | Cloud |
|---|---|---|
| Dashboard | `http://localhost:3000` | `https://agentobox.example.com` |
| MCP endpoint | `http://localhost:3000/api/mcp` | `https://agentobox.example.com/api/mcp` |
| Docker | localhost | remote host / k8s |
| Install | `npx agentobox` | deploy Next.js app |

Claude Code MCP config (either environment):
```json
{
  "mcpServers": {
    "agentobox": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

## Stack

| Layer | Tech | Purpose |
|-------|------|---------|
| Framework | Next.js 16 (App Router) | Pages, API routes, MCP endpoint |
| UI | React 19 | Components |
| Styling | Tailwind CSS 4 + augmented-ui | Geometric themed design system |
| Themes | CSS custom properties | Cyberpunk (dark) and Retro themes via `[data-theme]` |
| State | Zustand | Agent state, events, chat |
| Desktop streams | KasmVNC iframe | Live VNC per agent |
| Agent runtime | Docker + Claude Code + tmux | Isolated agent containers |

## Current State (what's built)

### Dashboard UI
- **Left command panel** (380px): branding, agent roster badges, agento chat with augmented-ui bubbles, chat input with `>` prompt
- **Right agent grid**: agent cards with status, activity message, pause/stop controls, live VNC iframe (4:3, 1024x768)
- **Theme system**: semantic CSS tokens, components reference tokens only (no theme conditionals). Cyberpunk and retro themes swap values via `[data-theme]` attribute
- **VNC embedding**: iframe with auto-retry on error, `autoconnect=1&resize=scale`

### Stores (Zustand)
- `agents.ts` — agent registry per bento, CRUD operations
- `events.ts` — event store per bento, syncs latest event state to agent store
- `chat.ts` — chat messages per bento
- `bentos.ts` — project list

### Agent Manager MCP (separate process, to be merged)
- In-memory agent registry with status tracking
- Event store (up to 50 events per agent)
- HTTP callback server (port 9900) for agent completion signals
- Claude Code Stop hook → `POST /event` on agent session end
- Docker container lifecycle (create, exec, stop, rm)
- tmux session management (send keys, read output)
- VNC port allocation (starting at 6902)

## Target Architecture (next steps)

### 1. Agent Manager as Shared Library
Extract core logic from `mcps/agent-manager/src/` into a library importable by:
- Next.js API routes (dashboard backend)
- MCP handler (Claude Code integration)

Core modules: state registry, event store, Docker management, tmux control, port allocation.

### 2. API Routes
```
/api/agents              GET    list agents with status
/api/agents              POST   create agent
/api/agents/:id          DELETE kill agent
/api/agents/:id/events   GET    events for agent
/api/agents/:id/message  POST   send message to agent
/api/chat                POST   send message to agento
/api/mcp                 POST   MCP endpoint (streamable HTTP)
```

### 3. Dashboard Polling
Replace mock data with polling loop that fetches from `/api/agents` and pushes into Zustand stores. Events sync to agent status automatically (already wired).

### 4. Agent Status Reporting
Agents report status via Claude Code hooks:
- **Stop hook**: fires on session end → `POST /event` with `state: completed`
- **PreToolUse hook** (future): fires before tool calls → `state: working` with tool context

## Data Flow

### Events (Agent → Dashboard)
```
Agent completes task
  → Claude Code Stop hook fires
  → POST /api/agents/:id/events
  → Agent manager library updates state + event store
  → Dashboard polls /api/agents
  → Zustand store update
  → React re-render
```

### Commands (User → Agent)
```
User sends message in command panel
  → POST /api/chat
  → Agento (orchestrator) processes with LLM
  → Calls agent manager library (create, send keys, etc.)
  → Docker container action
  → Response streamed back to chat
```

### VNC Streams
```
Each agent card embeds KasmVNC iframe:
  https://host:PORT/?autoconnect=1&resize=scale&password=...

Containers expose VNC on port 6901, mapped to host ports 6902+.
Resolution: 1024x768 (4:3 aspect ratio).
```

## Agent States

| State | Color Token | Description |
|-------|-------------|-------------|
| `idle` | `--agent-idle` | Ready for tasks |
| `working` | `--agent-active` | Executing task |
| `completed` | `--agent-completed` | Finished task |
| `blocked` | `--agent-blocked` | Needs help |
| `dead` | `--agent-dead` | Session/container lost |

## File Structure (current)

```
dashboard/
├── app/
│   ├── layout.tsx              # Root layout (providers, fonts)
│   ├── page.tsx                # Main page (command panel + agent grid)
│   └── globals.css             # Theme tokens, scrollbar utilities
├── components/
│   ├── providers.tsx           # Store initialization, hydration guard
│   └── theme-provider.tsx      # next-themes wrapper
├── stores/
│   ├── index.ts                # Re-exports
│   ├── agents.ts               # Agent state per bento
│   ├── events.ts               # Events, syncs to agent status
│   ├── chat.ts                 # Chat messages
│   └── bentos.ts               # Project list
├── lib/
│   └── mock-data.ts            # Seed data (to be replaced by API)
├── types/
│   └── index.ts                # Agent, Bento, AgentEvent, ChatMessage
└── ARCHITECTURE.md
```
