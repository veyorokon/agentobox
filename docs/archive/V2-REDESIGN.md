# V2 Redesign

A clean-slate rethinking of agentobox. What we'd build if we started over today, informed by everything we learned building v1.

This is not a migration plan. It's a target architecture — the system we wish we'd built.

## Lessons from V1

### What worked

1. **The UI aesthetic.** augmented-ui + theme sync to the container desktop created a distinctive, memorable identity. The design language felt intentional — not another gray dashboard.

2. **The UX spec.** The information density ladder (L0-L3), cognitive dimensions (perceiving/thinking/saying/doing), and the bento box metaphor are sound. The spec is thorough and the interaction counts are well-reasoned. Keep the spec, rebuild the implementation.

3. **Service isolation in the backend.** Services are cleanly separated by domain (lifecycle, provisioning, comms, stream, broadcast) with no circular dependencies. Pure functions where possible (feed_transform). This pattern scales.

4. **Hook interception for distributed spawning.** Intercepting `Task(team_name=...)` via PreToolUse hook to spawn real containers instead of local tmux panes is elegant. The alternative (forking Claude Code) would be much worse.

5. **The feed-as-conversation paradigm.** Treating agent activity as a chat thread (not a log viewer) is the right framing. ActionBubbles, TextBubbles, ErrorBubbles — the messaging metaphor makes agent monitoring feel natural.

6. **Zustand stores.** Small, focused, single-responsibility. The store design itself is good — the problem was not committing to it fully.

### What didn't work

1. **Building the agent runtime from scratch.** The relay process, container image (s6-overlay + AwesomeWM + Firefox + noVNC), provisioning pipeline (CLAUDE.md + settings.json + .mcp.json + team config + secrets), hook scripts — this is ~2,000 lines of infrastructure code solving problems that open-source tools already solve. The unique value is the teaming layer and dashboard, not the container runtime.

2. **Split state ownership between urql and Zustand.** State lived in three places: urql's document cache, Zustand stores, and component-local state. The sync hook (`use-sync-server-data.ts`) existed purely to bridge urql to Zustand, with gates (`feedInitLoaded`, `agentsInitLoaded`) to work around urql's cache invalidation refiring queries and overwriting store state. The scroll jitter bug was a direct consequence — urql refired a query, overwrote the feed store, Virtuoso lost scroll position.

3. **Subscriptions as refetch signals instead of data carriers.** The data flow: subscription fires (no data) -> 500ms debounce -> imperative refetch (network-only) -> `mergeLatest` into store. Five moving parts where one would do. If subscriptions carried the actual new items, the entire sync hook collapses.

4. **Two feed transforms.** Backend: `Messages + Events -> FeedItemType` (564 lines in `feed_transform.py`). Frontend: `FeedItemType -> MockFeedItem` (264 lines in `feed-adapter.ts`). 828 lines of transformation across two languages for the same data. The frontend adapter exists because the backend's shape doesn't match what components need — so the backend should just send the right shape.

5. **Agent model as god object.** The Agent model holds identity, runtime config, relay state, team membership, and communication queues (pending_input, pending_inbox, pending_signal). Five concerns in one table. The pending queue fields are particularly problematic — they're append-only JSON arrays that require row-level locking for atomicity.

6. **The piggyback pattern for message delivery.** The relay POSTs event batches and reads pending messages from the HTTP response. Message delivery latency depends on event frequency — if the agent is idle, messages wait for the next heartbeat (up to 2s, but still polling). A WebSocket would deliver instantly and eliminate the queue fields entirely.

7. **System messages modeled as Messages.** PR #61 showed this clearly. Treating transient notifications as conversation turns created: feed filtering logic, `response_policy` with three values where two behave the same and the third doesn't work, async ORM issues from `asyncio.create_task()`, and a message-before-restart race condition. The notification just needs to reach the relay — fire and forget via Redis.

8. **Mock type names leaked everywhere.** `MockFeedItem`, `MockAgent`, `TimelineTask` — leftover from prototyping but now the production types used across 20+ files. Misleading and confusing.

---

## Design Principles

Derived from v1 lessons. When in doubt, defer to these.

1. **Extend an existing agent runtime, don't build one.** The unique value is teaming + dashboard + observability. The container image, session management, tool execution, and stream processing are solved problems. Fork/extend an open-source Claude Code wrapper (e.g., OpenClaw) and focus on what's novel.

2. **One source of truth for frontend state.** All state flows through Zustand stores. The transport layer (GraphQL, WebSocket, fetch) is a dumb pipe — it pushes data into stores, nothing else. No competing caches. Centralized middleware for telemetry, logging, and optimistic updates.

3. **Subscriptions carry data.** When something changes, the backend pushes the actual data, not a signal to refetch. The frontend appends it to the store. One step, not five.

4. **One transform, one shape.** The backend sends data in the exact shape the frontend renders. No adapter layer. If the frontend needs a different shape, change the backend's output — don't add a translation layer.

5. **Separate identity from session.** An Agent is a persistent identity with config. A Session is an ephemeral runtime instance with relay state, heartbeat, and communication channels. Sessions come and go; agents persist.

6. **Notifications are signals, not messages.** System notifications (config changed, teammate joined, secrets rotated) are injected into the relay and optionally recorded as Events. They are never Messages. Messages are conversation turns.

7. **Keep the design language.** The augmented-ui aesthetic, theme sync, cognitive dimensions, and information density ladder are good. The UX spec is the blueprint — the implementation is what needs rebuilding.

---

## Architecture Overview

```
                        ┌─────────────────────────┐
                        │      Dashboard          │
                        │  (Next.js + Zustand)    │
                        │                         │
                        │  Stores ← WebSocket     │
                        │  Stores ← fetch (init)  │
                        │  Actions → mutations    │
                        └────────────┬────────────┘
                                     │
                              GraphQL / WS
                                     │
                        ┌────────────▼────────────┐
                        │      Backend            │
                        │  (Django + Strawberry)  │
                        │                         │
                        │  Models: Agent, Session, │
                        │    Event, Message        │
                        │  Services: lifecycle,    │
                        │    comms, feed, broadcast│
                        └────────────┬────────────┘
                                     │
                          Container management
                          + WebSocket relay
                                     │
               ┌─────────────────────▼─────────────────────┐
               │            Agent Containers               │
               │  (Extended from open-source runtime)      │
               │                                           │
               │  Claude Code + teaming hooks              │
               │  WebSocket connection to backend          │
               │  Shared workspace volume                  │
               └───────────────────────────────────────────┘
```

### What's different from v1

| Concern | V1 | V2 |
|---------|----|----|
| Agent runtime | Built from scratch (relay, hooks, s6-overlay, container image) | Extended from open-source project, thin hook layer |
| Relay transport | HTTP POST + piggyback responses | WebSocket (persistent, bidirectional) |
| Frontend state | urql cache + Zustand + component state | Zustand only, transport is a pipe |
| Data push | Subscription (signal) -> refetch -> merge | Subscription carries data -> store.append |
| Feed transform | Backend (564 lines) + frontend adapter (264 lines) | Backend only, sends final shape |
| Agent model | God object (identity + config + relay + queues) | Agent (identity + config) + Session (runtime state) |
| System notifications | Persisted as Messages, filtered from feed | Fire-and-forget injection + Events for audit trail |
| Message queues | JSON arrays on Agent model with row locking | WebSocket push (no queuing needed) |

---

## Frontend

### State Architecture

Everything flows through Zustand. No exceptions.

```
Transport (dumb pipe)              Stores (source of truth)           Components (render)
─────────────────────              ──────────────────────             ──────────────────

fetch('/graphql')  ──────────────→ agentsStore.setAgents()
                                   feedStore.setItems()
                                   projectsStore.setProject()

WebSocket subscription ──────────→ agentsStore.updateAgent()
                                   feedStore.appendItems()

User action ─→ mutation ─────────→ agentsStore.optimisticUpdate()
              (fire & forget)      └─ middleware: telemetry, logging

                                   agentsStore ─────────────────────→ AgentList, StatusBar
                                   feedStore ───────────────────────→ SummaryFeed, SwimLanes
                                   dashboardStore ─────────────────→ Layout, Navigation
                                   projectsStore ──────────────────→ ProjectSwitcher
```

**No urql.** The GraphQL client is a thin wrapper around `fetch` for queries/mutations and a WebSocket client for subscriptions. No document cache, no normalized cache, no request policies. The store IS the cache.

```typescript
// Transport layer — ~50 lines total
const gqlFetch = async (query: string, variables?: Record<string, unknown>) => {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

// WebSocket for subscriptions — pushes directly into stores
const ws = new WebSocket(wsUrl);
ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  switch (type) {
    case 'agent_updated': agentsStore.getState().updateAgent(payload); break;
    case 'feed_items':    feedStore.getState().appendItems(payload); break;
    case 'agent_event':   feedStore.getState().appendEvent(payload); break;
  }
};
```

### Store Design

```
stores/
├── agents.ts      — Agent map, sorted array, color assignment, stats, CRUD
├── feed.ts        — Feed items (already in render shape), timeline, scroll state
├── dashboard.ts   — Selected agent, active panel, view mode, composer state
├── projects.ts    — Current project, project list
├── auth.ts        — Token, user info
└── middleware.ts   — Telemetry, logging, devtools (applied to all stores)
```

**Key change:** Stores own derived state that v1 computed in components or hooks:

```typescript
// agents.ts
interface AgentsState {
  agents: Record<string, Agent>;
  sortedAgents: Agent[];       // derived, updated on mutation
  agentColors: Record<string, string>; // derived
  stats: {                     // derived — powers L0 StatusBar
    running: number;
    error: number;
    idle: number;
    deploying: number;
    totalCost: number;
    burnRate: number;
  };

  // Actions
  setAgents: (agents: Agent[]) => void;
  updateAgent: (agent: Partial<Agent> & { id: string }) => void;
  removeAgent: (id: string) => void;
}
```

```typescript
// feed.ts
interface FeedState {
  items: FeedItem[];           // already in render shape — no adapter

  // Actions
  setItems: (items: FeedItem[]) => void;
  appendItems: (items: FeedItem[]) => void;  // dedup by id, append new
  appendEvent: (event: AgentEvent) => void;  // converts to FeedItem, appends
}
```

### Middleware

Centralized middleware applied to all stores — the payoff for single source of truth.

```typescript
// middleware.ts
const telemetryMiddleware = (config) => (set, get, api) =>
  config(
    (...args) => {
      const before = get();
      set(...args);
      const after = get();
      // Track state transitions, measure update frequency, report to backend
      trackStateChange(before, after);
    },
    get,
    api
  );

const loggingMiddleware = (config) => (set, get, api) =>
  config(
    (...args) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[store]', args);
      }
      set(...args);
    },
    get,
    api
  );
```

This gives you: centralized performance tracking, debug logging in dev, optimistic update rollback, and undo support — all without touching individual components.

### Data Shape

The backend sends `FeedItem` in the exact shape the frontend renders. No `MockFeedItem`, no adapter, no second transform.

```typescript
// types/feed.ts — shared between backend output and frontend consumption
interface FeedItem {
  id: string;
  kind: FeedItemKind;
  agentId: string;
  timestamp: string;

  // Content — varies by kind, but always present in render-ready form
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  errorMessage?: string;
  targetAgentIds?: string[];

  // Display hints — computed by backend
  isCollapsed?: boolean;
  collapseCount?: number;
}
```

### Component Hierarchy

The UX spec's component tree is still the target. What changes is how components get data:

```
<DashboardShell>
  ├── <StatusBar />           ← reads agentsStore.stats (derived, always current)
  ├── <AgentListPanel>        ← reads agentsStore.sortedAgents
  │     └── <AgentListItem /> ← reads single agent by id (selector)
  ├── <ContentPane>
  │     ├── <SummaryFeed />   ← reads feedStore.items (already render-ready)
  │     └── <SwimLanes />     ← reads feedStore.items (grouped by agent)
  └── <Composer />            ← reads dashboardStore for target, dispatches mutation
```

Every component uses a store selector. No props drilling beyond one level. No useEffect for data fetching. No sync hooks.

### Scroll Behavior

The v1 scroll solution works — keep it. `totalListHeightChanged` + `requestAnimationFrame` + `wheel`/`touchend` for pinned tracking + reset on filter change. This pattern is proven.

---

## Backend

### Models

Split the god object. Agent is identity + config. Session is runtime state.

```python
class Agent(models.Model):
    """Persistent identity and configuration. Survives restarts."""
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=20, default='worker')  # 'lead' or 'worker'

    # Config (what the user sets)
    model = models.CharField(max_length=100, default='claude-sonnet-4-6')
    instructions = models.TextField(blank=True)
    mcp_servers = models.JSONField(default=list)
    workspace_path = models.CharField(max_length=500, blank=True)

    # Lifecycle
    status = models.CharField(max_length=20, default='stopped')
    config_snapshot = models.JSONField(null=True)  # for restart

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Session(models.Model):
    """Ephemeral runtime state. Created on deploy, destroyed on stop."""
    agent = models.OneToOneField(Agent, on_delete=models.CASCADE, related_name='session')

    # Runtime identifiers
    container_id = models.CharField(max_length=200)
    sandbox_id = models.CharField(max_length=200, blank=True)
    session_id = models.CharField(max_length=100, blank=True)  # Claude's session id
    relay_token = models.CharField(max_length=100)

    # Health
    last_heartbeat_at = models.DateTimeField(null=True)

    # Cost
    session_cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)

    # Capabilities (from system/init event)
    capabilities = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)


class SessionResult(models.Model):
    """Per-turn cost/usage snapshot. One row per conversation turn."""
    session = models.ForeignKey(Session, on_delete=models.CASCADE)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)

    total_cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    duration_ms = models.IntegerField(default=0)
    duration_api_ms = models.IntegerField(default=0)
    num_turns = models.IntegerField(default=0)
    model_usage = models.JSONField(default=dict)  # per-model cost/token breakdown

    created_at = models.DateTimeField(auto_now_add=True)


class AgentTask(models.Model):
    """Synced from stream observation when agents call TaskCreate/TaskUpdate."""
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)
    project = models.ForeignKey(Project, on_delete=models.CASCADE)

    task_id = models.CharField(max_length=100)  # Claude's internal task ID
    subject = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, default='pending')  # pending/in_progress/completed
    owner = models.CharField(max_length=100, blank=True)  # which agent owns the task

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

**What's gone:** `pending_input`, `pending_inbox`, `pending_signal` — eliminated by WebSocket relay. No more JSON array queues with row locking.

**What's split:** Container state (`container_id`, `sandbox_id`, `relay_token`, `heartbeat`, `capabilities`, `session_cost`) moves to Session. Agent keeps only what persists across restarts.

**What's preserved:** SessionResult (per-turn cost timeline) and AgentTask (synced from stream observation) — both well-designed in v1 and carry over unchanged, just linked to Session instead of Agent for runtime-specific data.

### Messages

Unchanged from v1 — this model is well-designed. Messages are conversation turns (user/assistant), stored with typed content parts matching the Anthropic API format.

### Events

Events replace both `AgentEvent` (v1) and the proposed system messages (PR #61):

```python
class Event(models.Model):
    """Platform-level occurrence. Not a conversation turn."""
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)

    kind = models.CharField(max_length=50)  # 'created', 'stopped', 'errored',
                                             # 'config_changed', 'teammate_joined',
                                             # 'teammate_left', 'secrets_rotated'
    summary = models.CharField(max_length=200)
    data = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
```

Events are: recorded for audit trail, pushed to dashboard via subscription (as FeedItems), and optionally injected into the agent's context via the relay WebSocket. One model, three uses.

### Feed Transform (Backend Only)

One transform. The backend sends `FeedItem` in the exact shape the frontend renders.

```python
def build_feed(project_id: str) -> list[FeedItem]:
    """
    Merge Messages + Events into a single feed,
    ordered by timestamp, collapsed where appropriate.
    Returns render-ready FeedItems — no frontend adapter needed.
    """
    messages = Message.objects.filter(agent__project_id=project_id).order_by('created_at')
    events = Event.objects.filter(agent__project_id=project_id).order_by('created_at')

    items = []
    for msg in messages:
        items.extend(_message_to_feed_items(msg))
    for evt in events:
        items.append(_event_to_feed_item(evt))

    items.sort(key=lambda i: i.timestamp)
    return _collapse_adjacent(items)
```

The frontend receives `FeedItem[]` and renders it. No `GqlFeedItem -> MockFeedItem` translation. The 264-line `feed-adapter.ts` disappears.

### Subscriptions That Carry Data

```python
@strawberry.type
class Subscription:
    @strawberry.subscription
    async def feed_updates(self, project_id: str) -> AsyncGenerator[list[FeedItem], None]:
        """Push new feed items as they arrive. Frontend appends to store."""
        async for items in feed_channel.subscribe(project_id):
            yield items

    @strawberry.subscription
    async def agent_updated(self, project_id: str) -> AsyncGenerator[Agent, None]:
        """Push agent state changes. Frontend updates agent in store."""
        async for agent in agent_channel.subscribe(project_id):
            yield agent
```

When a stream event arrives, the backend processes it, creates/updates the relevant records, builds the new FeedItems, and pushes them through the subscription channel. The frontend does `feedStore.appendItems(payload)`. Done.

### Notifications

System notifications are not Messages. They're a two-step process:

```python
async def notify_agent(agent: Agent, text: str):
    """
    Inject a system notification into the agent's Claude Code session.
    Fire and forget — no persistence as a Message.
    """
    wrapped = f"<system-reminder>\n{escape(text)}\n</system-reminder>"
    await relay_ws.send(agent.session.relay_token, wrapped)

async def notify_and_record(agent: Agent, text: str, event_kind: str):
    """
    Notify the agent AND record an Event for the dashboard.
    Use for state changes the human should see (config changed, teammate joined).
    """
    await notify_agent(agent, text)
    event = await Event.objects.acreate(
        agent=agent,
        kind=event_kind,
        summary=text[:200],
    )
    await broadcast_feed_item(_event_to_feed_item(event))
```

No `response_policy`. No feed filtering. No `_system_meta`. The notification reaches the agent. The event shows in the dashboard. Two lines each.

### Services

Same domain isolation as v1, but thinner:

| Service | V1 Lines | V2 Estimate | What changed |
|---------|----------|-------------|--------------|
| `lifecycle.py` | 634 | ~400 | Session model simplifies state management |
| `provision.py` | 821 | ~300 | Most provisioning delegated to base runtime |
| `feed.py` | 564 | ~400 | Same transform, but only one (no frontend adapter) |
| `comms.py` | 398 | ~150 | WebSocket push replaces queue management |
| `stream.py` | 280 | ~200 | Simpler with Session model |
| `interagent.py` | 252 | ~150 | WebSocket delivery replaces atomic enqueue |
| `broadcast.py` | 166 | ~100 | Channel-based push |
| `notifications.py` | 0 (PR #61: ~200) | ~30 | Two functions, no Message persistence |

**Estimated total: ~1,730 lines** (v1: ~3,468). Roughly half.

---

## Agent Runtime

### The Build vs. Extend Decision

V1 built from scratch:
- Custom Alpine image with s6-overlay, AwesomeWM, Firefox, noVNC
- Custom relay process (~300 lines Python)
- Custom hook scripts (~180 lines Python)
- Custom provisioning pipeline (CLAUDE.md, settings.json, .mcp.json, team config, secrets)
- Custom security hardening (apiKeyHelper, scoped sudo)

This is ~2,000 lines of infrastructure solving problems that projects like OpenClaw already solve: running Claude Code in a container, managing sessions, streaming output, providing a desktop environment.

### What to extend

Find an open-source Claude Code runtime that provides:
- Containerized Claude Code execution
- Stream-json output processing
- Desktop environment (X11/VNC) for computer-use agents
- Session lifecycle management

Then add the thin layer that makes agentobox unique:
- **Teaming hooks**: PreToolUse on `Task(team_name=...)` to redirect to backend
- **WebSocket relay**: Persistent connection for bidirectional communication
- **Team config provisioning**: CLAUDE.md with team roster, shared task directory
- **Inter-agent message routing**: Backend-mediated SendMessage delivery

### What the hook layer looks like

The entire custom layer on top of the base runtime:

```
hooks/
├── pre-tool-use.py    — Intercept Task(team_name=...), redirect to backend (~50 lines)
└── websocket-relay.py — Persistent WS connection, replaces HTTP relay (~100 lines)

provisioning/
├── claude_md.py       — Generate CLAUDE.md with team context (~150 lines)
└── team_config.py     — Write config.json, inboxes, task dirs (~80 lines)
```

~380 lines of custom code vs. ~2,000 in v1. The rest is inherited.

### WebSocket Relay

Replace the HTTP piggyback pattern with a persistent WebSocket:

```
Container                              Backend
┌───────────────────────┐            ┌──────────────────┐
│ Claude Code           │            │                  │
│   stdout → relay      │            │                  │
│   relay ←→ WebSocket ←──────────→  │  WS endpoint     │
│   relay writes stdin  │            │                  │
│                       │            │  Push: messages,  │
│ Events flow out →     │            │    signals,       │
│ Messages flow in ←    │            │    notifications  │
│ Signals flow in ←     │            │                  │
└───────────────────────┘            └──────────────────┘
```

**Benefits:**
- Instant message delivery (no polling, no heartbeat dependency)
- Bidirectional — backend can push at any time
- No `pending_input`/`pending_inbox`/`pending_signal` fields on the model
- Connection state IS liveness — no heartbeat timeout heuristics needed
- Simpler relay code — no batch queue, no piggyback parsing

**Tradeoff:** Connection management (reconnection, authentication). But the dashboard already manages WebSocket connections for subscriptions — same pattern, same infrastructure.

### CLAUDE.md Generation

The CLAUDE.md is the agent's entire orientation — a brand-new agent has zero context. Sections are composed from templates, conditionally included by role:

| # | Section | Lead | Worker | Content |
|---|---------|------|--------|---------|
| 1 | Identity | Y | Y | Project name, agent name, role description |
| 2 | Platform | Y | Y | What agentobox is, container lifecycle, relay/hooks explanation |
| 3 | Workspace | Y | Y | Mount path, shared volume, stay-in-bounds |
| 4 | Responsibilities | Y | Y | User-provided `instructions` field |
| 5 | Team | Y | Y | Roster of teammates with roles |
| 6 | Communication | Y | Y | SendMessage syntax, how messages arrive as user turns |
| 7 | Coordination | Y | N | Task management + spawning teammates (`Task(team_name=...)`) |
| 8 | Tasks | N | Y | Worker task workflow: claim, update, report |
| 9 | MCP Tools | Y | Y | Per-MCP instructions from registry |
| 10 | Security | Y | Y | Don't leak secrets, restricted paths |

The `claude_md.py` module composes these sections based on role and available data. No section is rendered if its data is empty (e.g., no Team section if solo agent, no MCP section if no MCPs configured).

### Inter-Agent Messaging

The distributed bridge problem remains: Claude Code's file-based SendMessage doesn't work across containers. The solution is the same as v1 (stream observation + backend routing) but the delivery mechanism changes from JSON queue to WebSocket push.

```
Agent A calls SendMessage(recipient="backend", content="hello")
  │
  ├─ Claude writes to local inbox file (harmless no-op, same as v1)
  │
  ├─ assistant event with SendMessage tool_use flows to backend via relay WS
  │
  ├─ stream.py → _handle_assistant → route_inter_agent_messages()
  │   └─ Extracts recipient + content from tool_use input
  │   └─ Finds target Agent by name in same project
  │   └─ Formats as stream-json user input
  │
  ├─ Backend pushes formatted message over target agent's relay WebSocket
  │   (instant — no queue, no polling, no heartbeat dependency)
  │
  └─ Target relay writes to Claude's stdin → Agent B receives message
```

Same stream observation pattern as v1. The only difference is the delivery step: WebSocket push instead of `pending_input` queue + piggyback response. Message latency drops from "up to 2s" to "instant."

TaskCreate/TaskUpdate observation also stays the same — scan assistant events for these tool calls, sync to AgentTask records.

### Security

Security model carries over from v1 with minor simplification:

**API key delivery:** `apiKeyHelper` pattern — key stored in tmpfs (`/run/secrets/anthropic_key`, root:root 0400), read by a helper script referenced in settings.json. Not in shell environment, not readable by the agent process directly.

**Scoped sudo:** Agents can only `sudo apt-get/apt/dpkg`. Cannot `sudo cat`, `sudo bash`, etc. Configured via sudoers.d.

**Relay auth:** Per-session `relay_token` generated at provisioning. WebSocket connection authenticated on handshake (token in query string or first message). Invalid token = connection rejected.

**Secrets:** Project secrets encrypted at rest (Fernet). Injected into MCP server env blocks at provisioning. Agents access secrets through MCP tools, not through environment variables directly.

**CLAUDE.md security section:** Instructions to never output secrets, never read `/run/secrets/`.

**What changes:** Relay token moves from Agent model to Session model. WebSocket auth replaces per-POST token validation. Otherwise identical.

### Runtimes

V1's runtime abstraction (protocol with `create`, `terminate`, `exec`, `write_file`) is well-designed and carries over:

```python
class RuntimeProtocol(Protocol):
    async def create(self, config: ContainerConfig) -> str: ...  # returns container_id
    async def terminate(self, container_id: str) -> None: ...
    async def exec(self, container_id: str, cmd: list[str]) -> ExecResult: ...
    async def write_file(self, container_id: str, path: str, content: str) -> None: ...
```

Two implementations:
- **DockerRuntime** — local development, bind-mount workspace from host
- **ModalRuntime** — production, Modal sandboxes with named volumes

The runtime protocol is clean and minimal. If extending an OSS base runtime, the `create` method bootstraps from the base image + applies our hook layer. Everything else stays the same.

---

## GraphQL Schema

### Queries

```graphql
type Query {
  agents(projectId: ID!): [Agent!]!
  agent(id: ID!): Agent
  projectFeed(projectId: ID!): [FeedItem!]!      # full feed, render-ready shape
  agentTasks(projectId: ID!): [AgentTask!]!       # synced task list
  availableModels: [ModelEntry!]!
  mcpRegistry: [McpRegistryEntry!]!
}
```

**Removed from v1:** Separate `events` and `timeline` queries. The feed query returns everything merged. No need to query messages and events separately — that's the backend's job.

### Mutations

```graphql
type Mutation {
  # Auth
  login(input: LoginInput!): AuthPayload!

  # Agent lifecycle
  createAgent(input: CreateAgentInput!): Agent!
  killAgent(id: ID!): Agent!
  restartAgent(id: ID!): Agent!

  # Communication
  sendMessage(input: SendMessageInput!): Boolean!
  broadcastMessage(input: BroadcastInput!): Boolean!

  # Config (all trigger notification to agent + event for dashboard)
  updateAgentInstructions(id: ID!, instructions: String!): Agent!
  updateAgentConfig(id: ID!, input: AgentConfigInput!): Agent!

  # Secrets
  createProjectSecret(input: SecretInput!): ProjectSecret!
  deleteProjectSecret(id: ID!): Boolean!
  rotateProjectSecret(id: ID!, value: String!): ProjectSecret!

  # Feedback
  rateFeedback(agentId: ID!, rating: Int!): Boolean!
}
```

**Removed from v1:** `answerQuestion` (replaced by `sendMessage` — the agent receives it the same way). `updateAgentModel`, `updateAgentMcpServers` (consolidated into `updateAgentConfig`).

### Subscriptions

```graphql
type Subscription {
  agentUpdated(projectId: ID!): Agent!              # carries full agent state
  feedUpdates(projectId: ID!): [FeedItem!]!         # carries new render-ready items
}
```

**Key change from v1:** Two subscriptions instead of four (`agentUpdated`, `messageReceived`, `newEvent`, `timelineStream`). `feedUpdates` carries the actual FeedItems — the frontend does `feedStore.appendItems(payload)`. No refetch signal, no debounce, no merge.

---

## Inter-Agent Communication Patterns

### Direct Message

Agent A → `SendMessage(recipient="backend", content="...")` → backend routes via WebSocket → Agent B receives as user turn.

### Broadcast

Agent A → `SendMessage(type="broadcast", content="...")` → backend sends to all agents in project via their respective WebSocket connections.

### Task Coordination

Agents use Claude Code's native TaskCreate/TaskUpdate/TaskList. The backend observes these in the stream and syncs to AgentTask records. The dashboard displays task state. No custom task protocol needed — observe what agents already produce.

### User to Agent

User types in Composer → `sendMessage` mutation → backend formats as stream-json user input → pushes via relay WebSocket → agent receives as user turn. Response flows back through the normal stream pipeline.

### User to All Agents

User clicks broadcast → `broadcastMessage` mutation → backend pushes to all agent relay WebSockets. Each agent receives it as a user turn from the same "user."

---

## Resilience

### WebSocket Disconnection (Relay)

```
1. Relay detects WS disconnect
2. Exponential backoff reconnect (1s, 2s, 4s, 8s, max 30s)
3. Re-authenticate with relay_token on reconnect
4. Backend marks agent status as 'disconnected' after 10s without connection
5. On reconnect: backend pushes any queued messages accumulated during disconnect
   (small in-memory buffer, not DB — disconnect should be brief)
6. If reconnect fails after 60s: backend marks agent as 'error', creates Event
```

**Key difference from v1:** v1 uses heartbeat timeout (stale > 10s = down). V2 uses connection state directly — the WebSocket either exists or it doesn't. No heuristics.

**Edge case — messages during disconnect:** The backend keeps a small in-memory buffer (last 30s) of messages intended for each agent. On reconnect, buffer is flushed. If the agent was down longer than 30s, missed messages are lost — but the agent was likely restarted anyway, and restarts rebuild context from CLAUDE.md.

### WebSocket Disconnection (Dashboard)

```
1. Dashboard detects WS disconnect
2. StatusBar shows "Reconnecting..." indicator
3. Exponential backoff reconnect
4. On reconnect: re-subscribe to all active subscriptions
5. Fetch full state via queries to resync stores (agents, feed)
6. Stores reconcile: setAgents replaces, feed does full reload
```

The initial-load-via-query path is the same as first page load. Reconnection is just "reload state." No special reconciliation logic needed.

### Container Death

```
1. Container process exits → relay WS closes
2. Backend detects close → marks Session as ended
3. Backend sets Agent status to 'stopped' or 'error' (based on exit code if available)
4. Creates Event (kind: 'stopped' or 'errored')
5. Pushes agent update + event through subscriptions
6. Dashboard updates immediately
```

If the relay WS closes without a clean shutdown, the backend infers the container died. No heartbeat polling needed — the connection closing IS the signal.

### Backend Restart

```
1. All relay WebSockets close (agents lose connection)
2. All dashboard WebSockets close (users see "Reconnecting...")
3. Backend restarts, agents begin reconnecting (exponential backoff)
4. Dashboard reconnects, fetches full state
5. Agents reconnect, resume streaming events
6. Any events that occurred during backend downtime are lost
   (acceptable — backend restarts should be brief)
```

---

## Casebase

The casebase thesis from FOUNDATIONS.md carries over unchanged. It's not part of the v2 rebuild scope — it's a layer added on top once the core platform is stable. But the architecture should not block it.

**What v2 preserves for casebase readiness:**

1. **Messages with full content parts** — the raw conversation data. Stored as-is, indexed later.
2. **Events with structured data** — lifecycle events, config changes, team transitions. Already typed and queryable.
3. **SessionResult per turn** — cost/usage timeline. Enables "how much did this approach cost?" retrieval.
4. **AgentTask sync** — plans and task decompositions. What was planned vs. what was executed.

**What v2 adds:**

5. **Session model** — clean lifecycle boundary. Each Session is a self-contained unit of work with start/end times, cost, and a link to its Agent config. Sessions are the natural unit for casebase indexing.

The pipeline (capture → index → retrieve → deliver) is future work. V2 ensures the raw data is clean and well-structured so the pipeline has good inputs when built.

---

## Data Flow: End to End

### Agent does something

```
1. Claude calls a tool (e.g., Edit file)
2. stream-json event flows to relay
3. Relay sends over WebSocket → backend
4. Backend:
   a. Upserts Message (append content part)
   b. Builds FeedItem from the new content
   c. Pushes FeedItem through subscription channel
5. Dashboard WebSocket receives FeedItem
6. feedStore.appendItems([item])
7. Component re-renders (Virtuoso appends, scroll-lock engages if pinned)
```

One path. No refetch. No debounce. No merge. No gate.

### User sends a message

```
1. User types in Composer, hits send
2. Dashboard fires sendMessage mutation
3. Backend:
   a. Creates Message record
   b. Pushes message content to agent via WebSocket relay
   c. Builds FeedItem, pushes through subscription
4. Agent's Claude receives the message as a user turn
5. Agent responds → triggers "Agent does something" flow above
```

### Agent joins the team

```
1. User clicks Deploy (or lead agent spawns a teammate)
2. Backend:
   a. Creates Agent record (status: deploying)
   b. Creates Session record
   c. Spins up container from base runtime image
   d. Provisions: CLAUDE.md, team config, hooks
   e. Launches relay (WebSocket connection established)
   f. Creates Event (kind: 'created')
   g. Pushes agent update + event through subscriptions
   h. Notifies existing agents: "X joined the team"
3. Dashboard receives agent update → agentsStore.updateAgent()
4. Dashboard receives feed item → feedStore.appendItems()
5. Existing agents receive notification in their Claude context
```

### Config change

```
1. User changes model/instructions/MCPs in config popover
2. Dashboard fires updateAgentConfig mutation
3. Backend:
   a. Updates Agent record
   b. Creates Event (kind: 'config_changed')
   c. Notifies agent via WebSocket: "<system-reminder>Your config changed...</system-reminder>"
   d. Optionally restarts agent (if model changed)
   e. Pushes agent update + event through subscriptions
4. Dashboard updates immediately via subscription
5. Agent receives notification in context (no restart needed for instruction changes)
```

---

## What We Keep

Not everything needs to change. These pieces transfer directly:

1. **UX spec** — Information density ladder, cognitive dimensions, feature inventory, component hierarchy, interaction counts. The blueprint is sound.

2. **augmented-ui + theme system** — The visual identity. Theme sync between dashboard and container desktop. CSS custom properties for theming.

3. **Feed item renderers** — 15 specialized components, 20-100 lines each. Right granularity, right abstraction level. They just consume a different (simpler) prop shape.

4. **Scroll behavior** — `totalListHeightChanged` + `requestAnimationFrame` + `wheel`/`touchend` pinned tracking. Proven solution.

5. **Zustand store patterns** — The stores themselves are well-designed. They just need to be the ONLY state owner, with middleware added.

6. **Backend service isolation** — Domain-separated services with no circular dependencies. Same pattern, thinner implementations.

7. **Strawberry GraphQL** — Type-safe, Python-native, good Django integration. No reason to change.

8. **Hook interception pattern** — PreToolUse for `Task(team_name=...)`. The mechanism is right; the implementation just gets thinner.

9. **GraphQL subscription infrastructure** — Django Channels + Strawberry subscriptions over WebSocket. Already works. Just push data through them instead of using them as signals.

---

## Patterns V1 Didn't Have

Things we should adopt in v2 that weren't present in v1.

### Schema-First Type Sharing

V1 has separate type definitions in Python (Strawberry) and TypeScript (hand-written interfaces). They drift. The frontend `MockFeedItem` type doesn't exactly match the backend `FeedItemType` — the adapter exists partly to bridge this gap.

V2: export the GraphQL schema (`make schema`), run codegen to generate TypeScript types. One source of truth. The backend defines the shape, the frontend consumes generated types. No hand-written interfaces for API data.

```bash
# Backend exports schema
strawberry export-schema backend.schema > schema.graphql

# Frontend generates types
npx graphql-codegen --config codegen.yml
```

This catches shape mismatches at build time, not at runtime.

### Optimistic Updates

The store-centric architecture enables optimistic updates naturally:

```typescript
// Example: kill agent
const killAgent = async (id: string) => {
  // Optimistic: update store immediately
  agentsStore.getState().updateAgent({ id, status: 'stopping' });

  try {
    await gqlMutation(KILL_AGENT, { id });
    // Subscription will push the real state
  } catch (e) {
    // Rollback: restore previous state
    agentsStore.getState().updateAgent({ id, status: previousStatus });
    toast.error('Failed to stop agent');
  }
};
```

In v1, this wasn't possible because urql's cache and the store were competing for ownership. With one source of truth, optimistic updates are trivial.

### Cursor-Based Feed Pagination

V1 loads the entire feed on initial page load (382+ items in the console logs). This works at small scale but doesn't scale.

V2: initial load fetches the last N items (e.g., 100). Scrolling up triggers cursor-based pagination to load older items. New items arrive via subscription and append to the bottom.

```graphql
type Query {
  projectFeed(
    projectId: ID!
    before: String        # cursor for backward pagination
    limit: Int = 100
  ): FeedConnection!
}

type FeedConnection {
  items: [FeedItem!]!
  pageInfo: PageInfo!     # hasPreviousPage, startCursor
}
```

Virtuoso already supports prepending items. The feed store tracks cursors. Pagination is transparent to the user.

### Connection Health Indicator

V1 has no visible indicator when the WebSocket connection drops. The user sees stale data without knowing it's stale.

V2: a subtle StatusBar indicator — green dot when connected, amber "Reconnecting..." when disconnected. The user always knows if what they're seeing is live.

### Undo via Store Snapshots

The UX spec calls for 8-second undo on destructive actions (kill, config change). With stores as single source of truth, undo is a store snapshot:

```typescript
const undoStack: Array<{ store: string; snapshot: unknown; timeout: NodeJS.Timeout }> = [];

const withUndo = (storeName: string, action: () => void, rollback: () => void) => {
  const snapshot = stores[storeName].getState();
  action();
  const timeout = setTimeout(() => {
    // Commit — remove from undo stack
    undoStack.shift();
  }, 8000);
  undoStack.push({ store: storeName, snapshot, timeout });
  toast.show('Undo', () => {
    clearTimeout(timeout);
    rollback();
  });
};
```

In v1, undo would require coordinating urql cache, store state, and component state. With one source of truth, it's one snapshot.

---

## Open Questions

Decisions that need to be made before or during v2 implementation.

1. **Which OSS runtime to extend?** OpenClaw is one option. Need to evaluate: does it support stream-json? Does it handle VNC/desktop? How extensible is it? If nothing fits well, the fallback is keeping the v1 container image but replacing the relay with WebSocket.

2. **WebSocket multiplexing.** One WebSocket per agent container, or multiplex all agents through a single connection? Per-agent is simpler (connection = liveness) but doesn't scale to 50+ agents per project. Multiplexing is more efficient but requires message routing in the WS layer.

3. **Feed pagination cutoff.** How many items on initial load? 50? 100? 200? Depends on typical feed size and Virtuoso's rendering performance. Needs measurement.

4. **Event sourcing.** The current design stores Messages and Events as separate models, then merges them in `build_feed()`. An alternative: store everything as an ordered event log and derive the current state. Simpler query model, natural pagination, but requires a mindset shift. Worth evaluating but not a v2 requirement.

5. **GraphQL codegen tool.** Several options: `graphql-codegen`, `gql.tada`, `genql`. Need to evaluate which integrates best with the thin-client approach (no urql, just fetch + generated types).

---

## Summary

| Dimension | V1 | V2 |
|-----------|----|----|
| Agent runtime | ~2,000 lines custom | ~380 lines on top of OSS base |
| Backend services | ~3,468 lines | ~1,730 lines |
| Frontend adapter | 264 lines | 0 lines (codegen types) |
| Sync hook | ~150 lines + gate workarounds | ~50 lines (WebSocket → store) |
| Feed transforms | 2 (backend + frontend) | 1 (backend) |
| State owners | 3 (urql + Zustand + local) | 1 (Zustand) |
| Message delivery | HTTP poll (up to 2s latency) | WebSocket (instant) |
| System notifications | Messages + feed filtering + response_policy | Fire-and-forget + Events |
| Agent model fields | ~17 (including 3 JSON queues) | ~10 (Agent) + ~7 (Session) + supporting models |
| Type safety | Hand-written TS interfaces (drift) | GraphQL codegen (single source) |
| Feed pagination | Load all (382+ items) | Cursor-based (last 100 + scroll-back) |
| Optimistic updates | Not possible (competing caches) | Native (store snapshots) |
| Undo | Not implemented | Store snapshot + 8s rollback |
| Connection health | Invisible to user | StatusBar indicator |
| Total estimated LOC | ~26,500 | ~15,000-18,000 |

The system does the same things with roughly 60-70% of the code, because each piece does exactly one job and state flows in one direction.
