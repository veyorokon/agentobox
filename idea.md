# AgentBox

A multi-agent system where Claude Code instances collaborate through isolated desktop containers, orchestrated by a manager agent, with a visual dashboard for observation and control.

## Core Concept

Every agent is a Claude Code instance. No custom brain, no special LLM loop. The difference between agents is their MCP toolset:

- **Worker agents** get a `computer-use` MCP connected to their own desktop container (browser, GUI apps, filesystem)
- **Agento** (the manager) gets an `agent-manager` MCP for spawning, messaging, and monitoring other agents
- The **user** can talk to Agento or directly to any worker agent

## Architecture

```
User (chat interface)
  │
  ├── Talk to Agento ──────────────────────────────────┐
  │     "spin up Rizzie and have her research           │
  │      competitor pricing on Amazon"                  │
  │                                                     │
  └── Talk to Rizzie directly ─────────┐               │
        "go to amazon.com and search                    │
         for wireless keyboards"        │               │
                                        │               │
                                        ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                        AgentBox System                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Agento (manager)                                    │    │
│  │ Claude Code + agent-manager MCP                     │    │
│  │                                                     │    │
│  │ Tools:                                              │    │
│  │   create_agent(name, task)                          │    │
│  │   kill_agent(name)                                  │    │
│  │   send_message(name, message)                       │    │
│  │   read_output(name)                                 │    │
│  │   screenshot_terminal(name)                         │    │
│  │   list_agents()                                     │    │
│  └──────┬──────────────┬──────────────┬────────────────┘    │
│         │              │              │                      │
│    ┌────▼────┐   ┌─────▼────┐   ┌────▼────┐                │
│    │ Rizzie  │   │ Agent B  │   │ Agent C │                │
│    │Claude   │   │Claude    │   │Claude   │                │
│    │Code     │   │Code      │   │Code     │                │
│    │         │   │          │   │         │                │
│    │MCP:     │   │MCP:      │   │MCP:     │                │
│    │computer │   │computer  │   │computer │                │
│    │-use     │   │-use      │   │-use     │                │
│    └────┬────┘   └────┬─────┘   └────┬────┘                │
│         │             │              │                      │
│    ┌────▼────┐   ┌────▼─────┐   ┌───▼─────┐               │
│    │Container│   │Container │   │Container│               │
│    │Desktop 1│   │Desktop 2 │   │Desktop 3│               │
│    │:8808    │   │:8809     │   │:8810    │               │
│    │:6901    │   │:6902     │   │:6903    │               │
│    └─────────┘   └──────────┘   └─────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Dashboard (web UI)                                          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│ │ Rizzie   │ │ Agent B  │ │ Agent C  │                     │
│ │ ● active │ │ ◌ idle   │ │ ● active │                     │
│ │ [stream] │ │ [stream] │ │ [stream] │                     │
│ └──────────┘ └──────────┘ └──────────┘                     │
│                                                             │
│ Click any → full desktop + terminal + chat                  │
│ Take control at any time (mouse, keyboard)                  │
└─────────────────────────────────────────────────────────────┘
```

## Agents

### Agento (manager)

A Claude Code instance with the `agent-manager` MCP. Agento:

- Spawns worker agents on demand (each gets a container + Claude Code process)
- Relays messages between the user and workers
- Monitors worker output and terminal state (via screenshots)
- Reviews worker plans before execution
- Handles failures — restarts stuck agents, reassigns tasks
- Coordinates multi-agent workflows ("Rizzie researches, Agent B compiles results")

Agento does NOT have a desktop container. It operates purely through terminal/MCP tools.

### Worker Agents

Each worker is a Claude Code instance with a `computer-use` MCP pointed at its own container. Workers:

- Have a full desktop environment (Kasm/XFCE with Chrome, Firefox, etc.)
- Control the desktop via MCP (mouse, keyboard, screenshots)
- Are isolated from each other (separate containers, separate filesystems)
- Can be talked to directly by the user or through Agento

### User Interaction

The user can:

1. **Talk to Agento**: "Create an agent called Rizzie and have her fill out this job application"
2. **Talk to a worker directly**: "Rizzie, open Chrome and go to linkedin.com"
3. **Watch via dashboard**: See all agent desktops as live VNC streams
4. **Take control**: Click into any agent's desktop and use mouse/keyboard directly
5. **Escalation**: Agents can request human help (e.g., CAPTCHA) through the dashboard

## Components

### 1. Container Image (done)

Kasm desktop with computer-use MCP server, exposed over HTTP.

- Base: `kasmweb/desktop:1.18.0` (linux/amd64, runs via Rosetta on Apple Silicon)
- MCP server on port 8808 (HTTP, StreamableHTTPServerTransport)
- VNC desktop on port 6901 (KasmVNC, no auth)
- Tools: mouse, keyboard, screenshots, find_element, scroll_to, page_map, multi_click

Each container is identical. The orchestrator assigns unique port mappings per agent.

### 2. Agent Manager MCP (to build)

An MCP server that Agento uses to manage worker agents. Wraps Docker SDK + tmux.

**Tools:**

| Tool | Description |
|------|-------------|
| `create_agent` | Spin up a container + Claude Code process. Assigns name, ports, task. |
| `kill_agent` | Stop and remove a worker's container and process. |
| `send_message` | Send text to a worker's Claude Code via tmux `send-keys`. |
| `read_output` | Read recent terminal output from a worker's tmux session. |
| `screenshot_terminal` | Capture a screenshot of a worker's terminal (for Agento to review). |
| `list_agents` | List all active workers with status, ports, current task. |

Implementation: Node.js or Python MCP server that shells out to `docker` CLI and `tmux` commands.

### 3. Dashboard (to build)

Web UI for observing and controlling agents.

- **Grid view**: Thumbnails of each agent's desktop (VNC streams via noVNC/WebSocket)
- **Detail view**: Full desktop stream + terminal output + chat with the agent
- **Controls**: Take over mouse/keyboard, pause/resume, kill agent
- **Chat**: Message Agento or any worker directly

Tech: Next.js + noVNC for VNC streams + WebSocket for real-time state.

### 4. CLI Mode (to build)

Same system without the dashboard. The user interacts via terminal:

- Talk to Agento in one terminal
- Agento manages workers in tmux sessions
- Open VNC in browser to observe (optional)

This is the local dev experience. Dashboard is the production/web experience.

## How It Works

### Spawning an Agent

```
User → Agento: "Create an agent called Rizzie to research competitor pricing"

Agento uses agent-manager MCP:
  1. create_agent(name="rizzie", task="Research competitor pricing on Amazon")
     → Starts container (ports 8809/6902)
     → Starts Claude Code process with computer-use MCP pointed at :8809
     → Claude Code receives the task as its initial prompt

  2. Rizzie's Claude Code begins working:
     → Takes screenshot of desktop
     → Opens Chrome
     → Navigates to Amazon
     → Searches, clicks, reads results
     → Reports findings back through terminal output

  3. Agento monitors via read_output / screenshot_terminal
     → If Rizzie gets stuck, Agento intervenes or asks the user
```

### Direct Communication

```
User → Rizzie: "Also check Walmart"

Message sent to Rizzie's Claude Code via tmux send-keys.
Rizzie receives it as new input and continues working.
```

### Escalation

```
Rizzie hits a CAPTCHA she can't solve.
Rizzie outputs: "I need human help with a CAPTCHA on amazon.com"

Agento detects this via read_output monitoring.
Agento notifies user via dashboard or terminal.
User clicks into Rizzie's VNC stream, solves CAPTCHA.
Rizzie continues.
```

## Project Structure

```
agentobox/
  container/                # Container image
    Dockerfile
    entrypoint.sh
  mcps/
    computer-use/           # Desktop control MCP (done)
    agent-manager/          # Agent lifecycle MCP (to build)
  dashboard/                # Web UI (to build)
  idea.md                   # This file
  docker-compose.yml        # Local dev: single agent
```

## Deployment

The container image is the same everywhere. The agent-manager MCP is the only piece that changes — it needs a different backend depending on where containers run.

```
agent-manager MCP
  │
  ├── LocalBackend    → docker CLI (docker run, docker stop, ...)
  ├── K8sBackend      → kubectl / k8s API (create pod, delete pod, ...)
  └── ModalBackend    → modal CLI / API (modal run, ...)
```

Each backend implements the same interface: start container, stop container, get container URL, list containers. The MCP tools don't change — `create_agent`, `kill_agent`, etc. work the same regardless of backend.

### Local (Docker Compose)

- Agent-manager uses `LocalBackend` → shells out to `docker run`
- VNC streams accessible at `localhost:690X`
- MCP endpoints at `localhost:880X`
- Good for development and single-user use

### Kubernetes

- Agent-manager uses `K8sBackend` → creates pods via k8s API
- Each agent is a pod with the same container image
- Ingress routes VNC/MCP traffic per agent
- Scales to many agents across nodes

### Modal

- Agent-manager uses `ModalBackend` → spawns Modal sandboxes
- Each agent is a Modal container with GPU optional
- Modal handles networking and scaling
- Good for burst workloads (spin up 20 agents, tear down when done)

### What stays the same everywhere

- Container image (Kasm + computer-use MCP)
- Claude Code as the agent brain (runs on host or in a sidecar)
- Dashboard connects to VNC/MCP URLs regardless of where they come from
- Agento's MCP tools have identical signatures

## Key Properties

- **No custom LLM loop** — every agent is a standard Claude Code instance
- **Observable** — every desktop is a live VNC stream, every terminal is capturable
- **Interruptible** — user can take control of any agent's desktop at any time
- **Isolated** — each agent gets its own container, filesystem, browser profile
- **Composable** — agents can be created, destroyed, and reassigned dynamically
- **Portable** — same image runs locally, on k8s, on Modal, or any container runtime

## Tech Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Container | Kasm Desktop 1.18.0 | KasmVNC + XFCE, linux/amd64 |
| Agent brain | Claude Code | Standard CLI, no modifications |
| Desktop MCP | computer-use-mcp | nut-js for hardware-level input |
| Manager MCP | agent-manager (custom) | Docker/k8s/Modal backends |
| Dashboard | Next.js + noVNC | VNC streams + chat interface |
