# V3 Architecture

A clean-slate architecture for agentobox, informed by v1/v2 experience and analysis of five open-source agent platforms (OpenClaw, IronClaw, EdgeClaw, ClawWork, Moltworker).

V2 = what's deployed now. This document is the target for what comes next.

## What We Learned from Analyzing Existing Projects

We evaluated five projects as potential base layers. None fit as a drop-in base, but each contributed specific patterns:

| Project | What it is | LoC | Relevant pattern we lift |
|---------|-----------|-----|--------------------------|
| **OpenClaw** | Personal AI assistant, multi-channel (WhatsApp, Telegram, Slack, etc.) | ~600K TS | Channel library choices (grammy, Baileys, Bolt), plugin registration, session-per-channel routing, A2A messaging primitives |
| **IronClaw** | Rust rewrite of OpenClaw, Docker worker model | ~100K Rust | Per-job token auth with constant-time comparison, WASM capability model, orchestrator/worker architecture |
| **EdgeClaw** | OpenClaw + privacy routing (GuardAgent Protocol) | ~290K TS | 8 hook interception points (message_received through session_end), dual-track history, S1/S2/S3 sensitivity classification |
| **ClawWork** | AI agent economic benchmark | ~16K Python | Token cost tracking via provider wrapper (TrackedProvider pattern) |
| **Moltworker** | Cloudflare Workers wrapper around OpenClaw | ~5.5K TS | Serverless deployment pattern, R2-backed persistence across container restarts |

### Why none of them work as a base

Every project is a **personal AI assistant**. None handle multi-agent teaming. All embed a specific agent runtime (pi-mono, LangChain) rather than wrapping arbitrary agent CLIs. The unique value of agentobox is the coordination layer — teaming, task dispatch, agent-to-agent messaging, observability across a fleet — and none of these projects have that.

The right approach: build the coordination layer ourselves, lift patterns from these projects for channels/security/hooks, and create a pluggable agent adapter that wraps any coding agent.

### IronClaw security audit

We audited IronClaw's security claims in detail. Results:

| Component | Verdict | Notes |
|-----------|---------|-------|
| Encryption at rest (AES-256-GCM) | Real | Proper HKDF, per-secret salts, authenticated encryption |
| WASM tool sandbox | Real | Capability-based, resource-limited, URL allowlisting |
| Per-job token auth | Real | Constant-time comparison, scoped to job, revoked on cleanup |
| Container secret injection | **Broken** | Secrets passed as env vars — any process can `env \| grep TOKEN` |
| Prompt injection defense | Cosmetic | Regex blocklists, trivially bypassed by rephrasing |
| Leak detection | Partial | Catches literal patterns, bypassed by base64 encoding |
| Policy enforcement | Advisory | Only "Block" severity prevents execution; Warn/Review just log |

**Key takeaway:** Architecture ideas worth lifting, implementation not trustworthy for production secrets. We must solve secret injection properly (relay-based, not env vars).

---

## Design Principles

Carried forward from v2 analysis, expanded with v3 learnings.

1. **Model-agnostic agent runtime.** The platform runs any coding agent — Claude Code, Codex, Aider, custom. The agent adapter normalizes them to a common interface. The unique value is teaming + dashboard + observability, not the agent runtime.

2. **Multi-channel input.** Users interact via web, WhatsApp, Telegram, Slack, email. Channels are input surfaces that route to teams/agents. Use existing libraries (grammy, Baileys, Bolt, nodemailer), don't build channel integrations.

3. **One source of truth for frontend state.** Zustand stores. Transport is a dumb pipe. No competing caches. Centralized middleware.

4. **Subscriptions carry data.** Backend pushes actual data, not refetch signals.

5. **One transform, one shape.** Backend sends render-ready data. No frontend adapter.

6. **Separate identity from session.** Agent = persistent config. Session = ephemeral runtime.

7. **Notifications are signals, not messages.** Fire-and-forget via relay + Events for audit trail.

8. **Secrets never touch environment variables.** Injected via relay WebSocket, held in memory for one use, never persisted in the container.

9. **Eight interception points.** Hooks cover the full agent lifecycle (message in, model selection, tool call, tool result, persistence, session end, message out, agent start).

10. **Keep the design language.** augmented-ui, theme sync, information density ladder, cognitive dimensions. The UX spec is the blueprint.

---

## Architecture Overview

Three-layer architecture: Gateway (channels + real-time), Backend (coordination + persistence), Agent Containers (pluggable runtimes).

```
Users
  │
  ├── Web dashboard
  ├── WhatsApp (Baileys)
  ├── Telegram (grammy)
  ├── Slack (Bolt)
  ├── Discord (discord.js)
  ├── Email (nodemailer + IMAP)
  │
  ▼
┌──────────────────────────────────────┐
│           Gateway (Node.js)          │
│                                      │
│  Channel adapters                    │
│  WebSocket hub (dashboard + relays)  │
│  Auth (JWT + channel-specific)       │
│  Message routing                     │
│  Connection health tracking          │
└──────────────────┬───────────────────┘
                   │
            Internal API
                   │
┌──────────────────▼───────────────────┐
│        Backend (Python/Django)        │
│                                       │
│  Models: Agent, Session, Event,       │
│    Message, AgentTask, SessionResult  │
│  Services: lifecycle, comms, feed,    │
│    broadcast, secrets                 │
│  Coordination: teaming, task mgmt    │
│  GraphQL API (Strawberry)            │
│  Secret vault (AES-256-GCM)          │
└──────────────────┬────────────────────┘
                   │
        Container management
        + WebSocket relay
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Agent A  │  │ Agent B  │  │ Agent C  │
│ (Claude) │  │ (Codex)  │  │ (Aider)  │
│          │  │          │  │          │
│ Adapter  │  │ Adapter  │  │ Adapter  │
│ Relay WS │  │ Relay WS │  │ Relay WS │
│ VNC      │  │ VNC      │  │ VNC      │
│ Hooks    │  │ Hooks    │  │ Hooks    │
│ Desktop  │  │ Desktop  │  │ Desktop  │
└─────────┘  └─────────┘  └─────────┘
```

### Why Gateway is separate from Backend

| Concern | Gateway (Node.js) | Backend (Python/Django) |
|---------|-------------------|------------------------|
| Long-lived connections | WebSocket hub, SSE, channel clients | N/A |
| Real-time routing | Message routing, relay proxying | N/A |
| Persistence | None — stateless relay | Models, migrations, ORM |
| Auth | JWT validation, channel-specific auth | User management, token issuance |
| Event loop model | Single-threaded async (ideal for I/O) | Request/response + async tasks |

Node.js is better for managing hundreds of concurrent WebSocket connections (relay per agent, dashboard per user, channel clients). Django is better for models, migrations, and business logic. They talk over an internal API (HTTP or gRPC).

### What's different from v2

| Concern | V2 (current) | V3 |
|---------|-------------|-----|
| Agent runtime | Claude Code only | Pluggable — any coding agent CLI |
| Input channels | Web dashboard only | Web + WhatsApp + Telegram + Slack + email |
| Gateway | Django handles everything | Separate Node.js gateway for channels + WS |
| Secret handling | env vars / tmpfs | Relay-injected, in-memory only |
| Hook system | 2 hooks (PreToolUse, stream observation) | 8 interception points |
| Agent adapter | Hardcoded Claude Code relay | Pluggable adapter per agent type |

---

## The Agent Adapter

The key new abstraction. Every supported agent runtime gets an adapter that normalizes its behavior to a common interface.

### Interface

```
┌─────────────── Agent Container ───────────────┐
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │         Agent Adapter                     │  │
│  │                                           │  │
│  │  Common interface:                        │  │
│  │    receive(text, sender, context) → void  │  │
│  │    events → EventStream                   │  │
│  │    hooks → HookChain                      │  │
│  │    status → AgentStatus                   │  │
│  │                                           │  │
│  │  Implementations:                         │  │
│  │    ClaudeCodeAdapter                      │  │
│  │    CodexAdapter                           │  │
│  │    AiderAdapter                           │  │
│  │    GenericCliAdapter                      │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐  │
│  │  Relay   │  │   VNC   │  │  Workspace   │  │
│  │  (WS)    │  │  (noVNC)│  │  (mounted)   │  │
│  └─────────┘  └─────────┘  └──────────────┘  │
└────────────────────────────────────────────────┘
```

### What each adapter does

```python
class AgentAdapter(Protocol):
    """Common interface for all agent runtimes."""

    async def start(self, config: AgentConfig) -> None:
        """Launch the agent process."""
        ...

    async def send_message(self, text: str, sender: str) -> None:
        """Inject a message into the agent's input stream."""
        ...

    async def events(self) -> AsyncIterator[AgentEvent]:
        """Stream of normalized events (tool calls, messages, status changes)."""
        ...

    async def stop(self) -> None:
        """Gracefully stop the agent process."""
        ...

    @property
    def status(self) -> AgentStatus:
        """Current agent status (running, idle, error, stopped)."""
        ...
```

### Adapter implementations

**ClaudeCodeAdapter** (~200 lines)
- Launches `claude` CLI in headless/stream-json mode
- Parses stream-json stdout into normalized `AgentEvent`s
- Sends messages via stdin (stream-json user input format)
- Hooks via `.claude/hooks/` (PreToolUse, PostToolUse, etc.)
- Supports team mode natively (TeamCreate, SendMessage, TaskList)

**CodexAdapter** (~150 lines)
- Launches `codex` CLI
- Parses stdout into normalized events
- Sends messages via stdin
- No native teaming — adapter simulates team primitives via message formatting

**AiderAdapter** (~150 lines)
- Launches `aider` with `--no-auto-commits`
- Parses `/chat` mode output into events
- Sends messages via stdin
- File change events from aider's output parser

**GenericCliAdapter** (~100 lines)
- Wraps any CLI that accepts stdin text and produces stdout text
- Minimal event normalization (raw text in/out)
- Fallback for unsupported agents

### Normalized event format

```typescript
interface AgentEvent {
  type: 'tool_call' | 'tool_result' | 'message' | 'file_change'
      | 'status_change' | 'error' | 'cost_update' | 'task_update';
  timestamp: string;
  agentId: string;

  // Content — varies by type
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  text?: string;
  filePath?: string;
  status?: AgentStatus;
  error?: string;
  cost?: { usd: number; model: string; inputTokens: number; outputTokens: number };
  task?: { id: string; subject: string; status: string; owner: string };
}
```

Every adapter transforms its agent's native output format into this shape. The relay sends these to the gateway/backend. The backend converts them to FeedItems. The frontend renders FeedItems. One pipeline, any agent.

---

## Channels

Multi-channel input using proven libraries. Each channel is an adapter that normalizes platform-specific messages into a common format.

### Channel libraries

| Channel | Library | Notes |
|---------|---------|-------|
| Web | Native WebSocket | Dashboard's existing composer |
| WhatsApp | `@whiskeysockets/baileys` | Same library OpenClaw uses. Headless, no business API required |
| Telegram | `grammy` | Mature, well-documented, webhook + polling modes |
| Slack | `@slack/bolt` | Official SDK, handles OAuth, slash commands, events |
| Discord | `discord.js` | Official SDK, slash commands, message events |
| Email | `nodemailer` + `node-imap` | Send via SMTP, receive via IMAP IDLE |

### Channel adapter interface

```typescript
interface ChannelAdapter {
  name: string;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Inbound: channel → gateway
  onMessage(handler: (msg: InboundMessage) => void): void;

  // Outbound: gateway → channel
  send(channelId: string, text: string, options?: SendOptions): Promise<void>;
}

interface InboundMessage {
  channelType: 'web' | 'whatsapp' | 'telegram' | 'slack' | 'discord' | 'email';
  channelId: string;       // unique identifier for the conversation
  senderId: string;        // user identifier within the channel
  text: string;
  attachments?: Attachment[];
  replyTo?: string;        // message being replied to
  metadata?: Record<string, unknown>;  // channel-specific data
}
```

### Routing

Messages flow: Channel → Gateway → Backend (routing decision) → Agent relay.

```
InboundMessage arrives at Gateway
  │
  ├── Gateway looks up routing config:
  │   - channelId → projectId + agentId mapping
  │   - default: route to team lead
  │   - configurable per channel per project
  │
  ├── Gateway forwards to Backend via internal API:
  │   POST /internal/messages
  │   { projectId, agentId, text, sender, channel }
  │
  ├── Backend creates Message record
  ├── Backend pushes to agent via relay WebSocket
  ├── Agent responds → events flow back → Backend creates FeedItems
  │
  └── Backend pushes response back to Gateway
      Gateway sends via the originating channel adapter
```

Users can interact with their team from any channel. The same message that appears in the web dashboard's composer can come from WhatsApp. Agent responses route back to the originating channel.

### Channel config

Per-project, stored in the backend:

```python
class ChannelBinding(models.Model):
    """Routes a channel conversation to a specific agent or team."""
    project = models.ForeignKey(Project, on_delete=models.CASCADE)

    channel_type = models.CharField(max_length=20)  # 'whatsapp', 'telegram', etc.
    channel_id = models.CharField(max_length=200)    # chat ID, channel ID, etc.

    # Route to specific agent or team lead
    target_agent = models.ForeignKey(Agent, null=True, on_delete=models.SET_NULL)

    # Or route by pattern
    route_pattern = models.CharField(max_length=100, blank=True)  # e.g., '/backend *' → backend agent

    enabled = models.BooleanField(default=True)
```

---

## Hook System

Eight interception points, learned from EdgeClaw's GuardAgent Protocol. Hooks fire at well-defined moments in the agent lifecycle.

### Hook points

| # | Hook | When | Use case |
|---|------|------|----------|
| 1 | `message_received` | User/channel message arrives at agent | Logging, sensitivity detection, rate limiting |
| 2 | `before_model_call` | Before LLM inference | Model routing, cost budgeting, context injection |
| 3 | `before_tool_call` | Before tool execution | Team routing (`Task(team_name=...)`), secret injection, permission checks |
| 4 | `after_tool_call` | After tool execution | Leak detection, result sanitization, cost tracking |
| 5 | `before_message_send` | Before inter-agent message dispatch | Content filtering, routing validation |
| 6 | `tool_result_persist` | Before result is persisted/streamed | Dual-track history (redact sensitive data from dashboard feed) |
| 7 | `session_end` | Agent session terminates | Cleanup, summary generation, cost finalization |
| 8 | `before_agent_start` | Before agent process launches | Config injection, workspace setup, CLAUDE.md generation |

### Hook interface

```python
class HookResult:
    action: Literal['pass', 'modify', 'block']
    data: Any = None        # modified content (when action='modify')
    reason: str = ''        # explanation (when action='block')

class Hook(Protocol):
    point: str              # which hook point
    priority: int = 100     # lower = runs first

    async def execute(self, context: HookContext) -> HookResult:
        ...
```

### Critical hooks for agentobox

**`before_tool_call` — Team routing** (the v1 hook that carries forward)
```python
async def execute(self, ctx: HookContext) -> HookResult:
    if ctx.tool_name == 'Task' and ctx.tool_input.get('team_name'):
        # Redirect to backend — spawn a real container agent
        await backend_api.spawn_agent(
            project_id=ctx.project_id,
            name=ctx.tool_input['name'],
            prompt=ctx.tool_input['prompt'],
            team_name=ctx.tool_input['team_name'],
        )
        return HookResult(action='block', reason='Routed to platform')
    return HookResult(action='pass')
```

**`after_tool_call` — Leak detection**
```python
async def execute(self, ctx: HookContext) -> HookResult:
    if contains_secret_pattern(ctx.tool_result):
        return HookResult(
            action='modify',
            data=redact_secrets(ctx.tool_result),
            reason='Secret pattern detected in tool output'
        )
    return HookResult(action='pass')
```

**`before_model_call` — Cost budgeting**
```python
async def execute(self, ctx: HookContext) -> HookResult:
    session = await get_session(ctx.agent_id)
    if session.session_cost_usd > ctx.budget_limit:
        return HookResult(action='block', reason=f'Session budget exceeded (${session.session_cost_usd})')
    return HookResult(action='pass')
```

---

## Secret Management

Secrets never touch environment variables. Injected via relay WebSocket, held in memory, never persisted in the container.

### Why env vars are broken

IronClaw's approach (and most container platforms): secrets as `ENV` vars.

```bash
# Any process in the container can do:
env | grep TOKEN
cat /proc/self/environ
python -c "import os; print(os.environ['GITHUB_TOKEN'])"
```

A compromised tool, a prompt injection, or even a debug log statement can exfiltrate every secret in the container.

### The relay injection pattern

```
Backend (has secrets, encrypted at rest)
  │
  │  Agent requests a secret via relay WS:
  │  { "type": "secret_request", "name": "GITHUB_TOKEN", "scope": "tool:gh" }
  │
  ├── Backend validates:
  │   1. Agent has a grant for this secret (configured in project settings)
  │   2. Requested scope matches the grant scope
  │   3. Session is active and authenticated
  │
  ├── Backend decrypts secret (AES-256-GCM, per-secret salt)
  │
  ├── Backend sends over encrypted WS:
  │   { "type": "secret_value", "name": "GITHUB_TOKEN", "value": "ghp_...", "ttl": 60 }
  │
  └── Agent adapter receives and:
      1. Holds in memory (not written to disk, not set as env var)
      2. Injects into the specific tool call that needs it
      3. Zeroes the memory after TTL expires or tool call completes
```

### What this prevents

- `env | grep` — secret is never in the environment
- `/proc/self/environ` — same
- Disk forensics — secret is never written to disk
- Log exfiltration — adapter doesn't log secret values
- Scope creep — secret is only available to the specific tool that needs it

### Secret model

```python
class ProjectSecret(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)         # e.g., 'GITHUB_TOKEN'
    encrypted_value = models.BinaryField()           # AES-256-GCM ciphertext
    salt = models.BinaryField()                      # per-secret HKDF salt
    scope = models.CharField(max_length=100)         # e.g., 'tool:gh', 'mcp:playwright', '*'

    created_at = models.DateTimeField(auto_now_add=True)
    rotated_at = models.DateTimeField(auto_now=True)
    key_version = models.IntegerField(default=1)     # for key rotation

class SecretGrant(models.Model):
    """Which agents can access which secrets."""
    secret = models.ForeignKey(ProjectSecret, on_delete=models.CASCADE)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)
    granted_scope = models.CharField(max_length=100)  # may be narrower than secret's scope
```

### Key rotation

Unlike IronClaw (no rotation), v3 supports key rotation:

1. New master key generated
2. All secrets re-encrypted with new key, `key_version` incremented
3. Old key retained for `migration_window` (default 24h)
4. After migration window, old key deleted
5. Decryption tries current key first, falls back to previous version during window

---

## Teaming

Multi-agent coordination lifted from Claude Code's own patterns, abstracted to work with any agent runtime.

### Team primitives

These are the coordination primitives the platform provides. Agent-runtime-specific implementations (CC's native TeamCreate vs simulated teaming for Codex) are handled by the adapter layer.

| Primitive | What it does | Implementation |
|-----------|-------------|----------------|
| **Create team** | Initialize a team with a name and lead agent | Backend creates team record, provisions lead |
| **Spawn teammate** | Add a new agent to an existing team | `before_tool_call` hook intercepts, backend creates container |
| **Send message** | DM from one agent to another | Backend routes via relay WebSocket |
| **Broadcast** | Message all agents on a team | Backend sends to all relay WebSockets |
| **Task create** | Create a task for the team | Stream observation → AgentTask record |
| **Task update** | Update task status/owner | Stream observation → AgentTask update |
| **Task list** | View all tasks | Stream observation provides data; dashboard reads AgentTask |
| **Shutdown** | Request an agent to stop | Backend sends shutdown signal via relay |

### How teaming works per agent type

**Claude Code** — Native support
- TeamCreate, SendMessage, TaskList, TaskUpdate are built-in tools
- `before_tool_call` hook intercepts `Task(team_name=...)` and routes to backend
- Messages arrive as user turns (backend pushes via relay)
- No simulation needed — CC's teaming works natively

**Codex / Aider / Other** — Simulated teaming
- Agent doesn't have native team tools
- Adapter exposes teaming via injected system context:
  ```
  You are part of a team. Available commands:
  /message <agent> <text> — send a message to a teammate
  /task <subject> — create a task
  /tasks — list current tasks
  ```
- Adapter parses these commands from agent output and routes to backend
- Messages from teammates arrive as injected context (adapter prepends sender name)
- Less elegant than native teaming but functional

### Team model

```python
class Team(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    lead = models.ForeignKey(Agent, on_delete=models.SET_NULL, null=True, related_name='led_teams')
    created_at = models.DateTimeField(auto_now_add=True)

class TeamMembership(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['team', 'agent']
```

---

## Backend Models

Evolved from v2 redesign, with additions for channels, teams, and secrets.

### Core models

```python
class Agent(models.Model):
    """Persistent identity and configuration. Survives restarts."""
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=20, default='worker')

    # Runtime selection
    agent_type = models.CharField(max_length=50, default='claude-code')  # 'claude-code', 'codex', 'aider', 'generic'
    model = models.CharField(max_length=100, default='claude-sonnet-4-6')
    instructions = models.TextField(blank=True)
    mcp_servers = models.JSONField(default=list)
    workspace_path = models.CharField(max_length=500, blank=True)

    # Lifecycle
    status = models.CharField(max_length=20, default='stopped')
    config_snapshot = models.JSONField(null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Session(models.Model):
    """Ephemeral runtime state. Created on deploy, destroyed on stop."""
    agent = models.OneToOneField(Agent, on_delete=models.CASCADE, related_name='session')

    container_id = models.CharField(max_length=200)
    sandbox_id = models.CharField(max_length=200, blank=True)
    session_id = models.CharField(max_length=100, blank=True)
    relay_token = models.CharField(max_length=100)

    last_heartbeat_at = models.DateTimeField(null=True)
    session_cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    capabilities = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)


class SessionResult(models.Model):
    """Per-turn cost/usage snapshot."""
    session = models.ForeignKey(Session, on_delete=models.CASCADE)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)

    total_cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    duration_ms = models.IntegerField(default=0)
    num_turns = models.IntegerField(default=0)
    model_usage = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)


class AgentTask(models.Model):
    """Synced from stream observation."""
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)
    project = models.ForeignKey(Project, on_delete=models.CASCADE)

    task_id = models.CharField(max_length=100)
    subject = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, default='pending')
    owner = models.CharField(max_length=100, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

### New in v3

```python
class Team(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    lead = models.ForeignKey(Agent, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

class TeamMembership(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = ['team', 'agent']

class ChannelBinding(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    channel_type = models.CharField(max_length=20)
    channel_id = models.CharField(max_length=200)
    target_agent = models.ForeignKey(Agent, null=True, on_delete=models.SET_NULL)
    route_pattern = models.CharField(max_length=100, blank=True)
    enabled = models.BooleanField(default=True)

class ProjectSecret(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    encrypted_value = models.BinaryField()
    salt = models.BinaryField()
    scope = models.CharField(max_length=100)
    key_version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    rotated_at = models.DateTimeField(auto_now=True)

class SecretGrant(models.Model):
    secret = models.ForeignKey(ProjectSecret, on_delete=models.CASCADE)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE)
    granted_scope = models.CharField(max_length=100)
```

---

## Frontend

Carries forward from v2 redesign — Zustand as single source of truth, no urql, subscriptions carry data, one feed transform, schema-first codegen.

### What's new in v3

**Channel-aware composer.** The composer shows which channel a message will be sent through. Responses from agents route back to the originating channel.

```
stores/
├── agents.ts       — Agent map, sorted array, color assignment, stats
├── feed.ts         — Feed items (render-ready), cursor pagination
├── dashboard.ts    — Selected agent, active panel, view mode
├── projects.ts     — Current project, project list
├── teams.ts        — Team membership, task list        ← new
├── channels.ts     — Channel bindings, connection status ← new
├── auth.ts         — Token, user info
└── middleware.ts   — Telemetry, logging, devtools
```

**Multi-agent-type indicators.** Agent cards show which runtime is running (Claude, Codex, Aider) with distinct visual treatment. The adapter type is visible at L1 (scan level).

**Channel status in L0 bar.** Connected channels show as small icons with green/amber/red status dots.

Everything else (scroll behavior, feed renderers, augmented-ui, theme system, information density ladder) carries forward unchanged from the v2 spec.

---

## Gateway

The Gateway is a new component in v3 — a Node.js service that handles channels and real-time connections.

### Responsibilities

1. **Channel management** — Start/stop channel adapters, handle auth per platform
2. **WebSocket hub** — Manage connections for dashboard clients and agent relays
3. **Message routing** — Route inbound messages to the right agent via the backend
4. **Connection health** — Track which agents/channels are connected, expose to dashboard
5. **Response routing** — Route agent responses back to the originating channel

### What it does NOT do

- Persistence (no database access)
- Business logic (no agent lifecycle, no task management)
- Auth token issuance (backend does this)
- Feed transforms (backend does this)

### Internal API

The gateway and backend communicate over an internal API:

```
Gateway → Backend:
  POST /internal/messages          — route an inbound message to an agent
  POST /internal/relay-events      — forward agent events from relay WS
  GET  /internal/channel-bindings  — get routing config for a project

Backend → Gateway (via WS):
  { type: "send_to_agent", agentId, text }      — push message to agent relay
  { type: "send_to_channel", channelId, text }   — push response to channel
  { type: "agent_connected", agentId }            — relay connection established
  { type: "agent_disconnected", agentId }         — relay connection lost
```

### Tech stack

```json
{
  "dependencies": {
    "hono": "^4.x",           // HTTP framework (lightweight, WS-friendly)
    "@whiskeysockets/baileys": "^7.x",  // WhatsApp
    "grammy": "^1.x",         // Telegram
    "@slack/bolt": "^4.x",    // Slack
    "discord.js": "^14.x",    // Discord
    "nodemailer": "^6.x",     // Email (outbound)
    "node-imap": "^0.9.x",    // Email (inbound)
    "ws": "^8.x"              // WebSocket
  }
}
```

### Estimated size

~1,500-2,000 lines:
- Channel adapters: ~150 lines each x 5 = ~750
- WebSocket hub: ~300 lines
- Message routing: ~200 lines
- Internal API client: ~150 lines
- Config + startup: ~100 lines

---

## Container Image

Lean base image with pluggable agent runtimes. Desktop environment for VNC observation.

### Base image

```dockerfile
FROM alpine:3.21

# Desktop environment (for VNC observation)
RUN apk add --no-cache \
    xvfb \
    x11vnc \
    openbox \              # lightweight WM (simpler than AwesomeWM)
    xterm \
    firefox-esr \
    novnc \
    websockify

# Common tools
RUN apk add --no-cache \
    git curl wget jq \
    python3 py3-pip \
    nodejs npm \
    bash

# Agent runtimes (installed based on agent_type at provision time)
# Claude Code: npm install -g @anthropic-ai/claude-code
# Codex CLI:   npm install -g @openai/codex
# Aider:       pip install aider-chat
# Generic:     no additional install

# Relay + adapter
COPY relay/ /opt/agentobox/relay/
COPY adapters/ /opt/agentobox/adapters/

# s6-overlay for process supervision
ADD s6-overlay.tar.gz /
COPY rootfs/ /

ENTRYPOINT ["/init"]
```

### What's provisioned at deploy time

1. **Agent runtime** — installed based on `agent_type` (or pre-baked in specialized images)
2. **Adapter config** — which adapter to use, agent-specific settings
3. **Relay config** — WebSocket URL, relay token, backend endpoint
4. **CLAUDE.md** (for Claude Code agents) — team context, responsibilities, hook instructions
5. **Workspace mount** — host directory bind-mounted to `/home/agent/workspace`
6. **VNC config** — resolution, port, password

### Process tree (inside container)

```
/init (s6-overlay)
├── relay-ws          — WebSocket connection to gateway, event streaming
├── agent-adapter     — wraps the agent CLI, normalizes events
│   └── claude / codex / aider / ...
├── Xvfb :99          — virtual framebuffer
├── openbox           — window manager
├── x11vnc            — VNC server
└── websockify        — WebSocket proxy for noVNC
```

### Estimated custom code in container

```
relay/
├── ws-client.py         — WebSocket connection to gateway (~100 lines)
└── event-normalizer.py  — common event format (~50 lines)

adapters/
├── claude_code.py    — Claude Code adapter (~200 lines)
├── codex.py          — Codex adapter (~150 lines)
├── aider.py          — Aider adapter (~150 lines)
├── generic.py        — Generic CLI adapter (~100 lines)
└── base.py           — Shared adapter interface (~50 lines)

hooks/
├── team_routing.py   — Intercept Task(team_name=...) (~50 lines)
├── leak_detection.py — Scan tool output for secret patterns (~80 lines)
└── cost_budget.py    — Block model calls over budget (~30 lines)
```

~960 lines of custom code in the container. Everything else is the base image + installed agent runtime.

---

## CLAUDE.md Generation

For Claude Code agents, the CLAUDE.md is the agent's entire orientation. Sections composed from templates, conditionally included by role. Unchanged from v2 spec:

| # | Section | Lead | Worker | Content |
|---|---------|------|--------|---------|
| 1 | Identity | Y | Y | Project name, agent name, role |
| 2 | Platform | Y | Y | What agentobox is, container lifecycle, relay/hooks |
| 3 | Workspace | Y | Y | Mount path, shared volume |
| 4 | Responsibilities | Y | Y | User-provided instructions |
| 5 | Team | Y | Y | Roster of teammates with roles and agent types |
| 6 | Communication | Y | Y | SendMessage syntax, how messages arrive |
| 7 | Coordination | Y | N | Task management + spawning teammates |
| 8 | Tasks | N | Y | Worker task workflow |
| 9 | MCP Tools | Y | Y | Per-MCP instructions |
| 10 | Security | Y | Y | Don't leak secrets, restricted paths |

**V3 addition to Team section:** Agent types are listed so agents know which teammates are Claude Code vs Codex vs Aider. This affects how they communicate (CC agents can use SendMessage natively; others receive messages as injected context).

---

## Data Flow

### Agent does something

```
1. Agent calls a tool (any agent type)
2. Adapter normalizes output → AgentEvent
3. Relay sends AgentEvent over WebSocket → Gateway
4. Gateway forwards to Backend via internal API
5. Backend:
   a. Upserts Message (append content part)
   b. Builds FeedItem from new content
   c. Pushes FeedItem through subscription channel
6. Gateway pushes to Dashboard WebSocket
7. feedStore.appendItems([item])
8. Component re-renders
```

### User sends a message (from any channel)

```
1. User types in WhatsApp / Telegram / Slack / Web / Email
2. Channel adapter normalizes → InboundMessage
3. Gateway looks up routing (ChannelBinding)
4. Gateway forwards to Backend
5. Backend:
   a. Creates Message record
   b. Pushes to agent via relay WebSocket (through Gateway)
   c. Builds FeedItem, pushes through subscription
6. Agent receives as input → responds → triggers "Agent does something" flow
7. Backend pushes response back to Gateway
8. Gateway sends response via originating channel
```

### Agent spawns a teammate

```
1. Lead agent calls Task(team_name="project", name="frontend", prompt="...")
2. before_tool_call hook intercepts (team_name present)
3. Hook sends spawn request to Backend
4. Backend:
   a. Creates Agent record (agent_type from config or default)
   b. Creates Session record
   c. Provisions container (installs agent runtime based on agent_type)
   d. Generates CLAUDE.md (if Claude Code agent)
   e. Starts relay WebSocket
   f. Creates Event + FeedItem
   g. Notifies existing agents: "frontend joined the team"
5. Dashboard updates via subscription
6. New agent begins working
```

### Secret injection for tool call

```
1. Agent needs GITHUB_TOKEN for gh CLI
2. Adapter sends secret_request over relay WS
3. Gateway forwards to Backend
4. Backend validates:
   a. SecretGrant exists for this agent + secret
   b. Requested scope matches grant scope
   c. Session is active
5. Backend decrypts secret (AES-256-GCM)
6. Backend sends secret_value over relay WS (via Gateway)
7. Adapter receives, holds in memory
8. Adapter injects into tool environment for single call
9. After tool completes, adapter zeroes the memory
```

---

## What Carries Forward

From v1/v2, unchanged:

1. **UX spec** — Information density ladder, cognitive dimensions, feature inventory
2. **augmented-ui + theme system** — Visual identity, theme sync
3. **Feed item renderers** — 15 specialized components
4. **Scroll behavior** — totalListHeightChanged + rAF + pinned tracking
5. **Zustand store patterns** — Single source of truth, middleware
6. **Backend service isolation** — Domain-separated, no circular deps
7. **Strawberry GraphQL** — Type-safe Python schema
8. **Hook interception pattern** — PreToolUse for Task(team_name=...)
9. **Runtime protocol** — Docker + Modal implementations
10. **Casebase readiness** — Raw data preserved for future indexing

---

## Summary

| Dimension | V2 (current) | V3 (target) |
|-----------|-------------|-------------|
| Agent runtime | Claude Code only | Pluggable — Claude Code, Codex, Aider, any CLI |
| Input channels | Web dashboard only | Web + WhatsApp + Telegram + Slack + Discord + Email |
| Architecture | Monolithic (Django handles everything) | Gateway (Node.js) + Backend (Django) + Containers |
| Secret handling | env vars / tmpfs | Relay-injected, in-memory only, scoped grants |
| Hook system | 2 hooks (PreToolUse, stream observation) | 8 interception points with pass/modify/block |
| Teaming | Claude Code native only | Model-agnostic — native (CC) or simulated (others) |
| Key new abstraction | None | Agent Adapter (normalizes any agent CLI) |
| Container image | Custom (s6 + AwesomeWM + Firefox + Claude Code) | Lean base + pluggable runtime install |
| Channel routing | N/A | ChannelBinding model, per-project config |
| Secret rotation | No | Key versioning with migration window |
| Team model | Implicit (via Claude Code's team mode) | Explicit Team + TeamMembership models |
| Estimated custom LoC | ~26,500 | ~18,000-22,000 |
| Gateway LoC | 0 (doesn't exist) | ~1,500-2,000 |
| Container custom LoC | ~2,000 | ~960 |
| Backend services | ~3,468 | ~2,000 |
| Frontend | ~8,000 | ~7,000 (less adapter code, more channel/team UI) |

The system does more (multi-channel, multi-agent-type, proper secrets, richer hooks) with comparable or less code, because the agent adapter abstraction eliminates per-runtime-specific code paths in the platform layer.

---

## What to Lift from Where

Concrete patterns, types, and interfaces from analyzed projects mapped to agentobox v3 components. These are not theoretical — they're actual working implementations we can reference or port.

### From OpenClaw (~600K LoC TypeScript)

**Provider abstraction** — model-agnostic LLM calls with per-model cost/capability metadata.

```typescript
// OpenClaw's ModelApi enum — every supported LLM protocol
enum ModelApi {
  OpenaiCompletions = "openai-completions",
  AnthropicMessages = "anthropic-messages",
  GoogleGenerativeAi = "google-generative-ai",
  Bedrock = "bedrock",
  Ollama = "ollama",
}

// Per-model cost and capability definition
interface ModelDefinitionConfig {
  id: string;                    // "claude-sonnet-4-6"
  name: string;                  // "Claude Sonnet 4.6"
  api: ModelApi;                 // which protocol to use
  reasoning?: boolean;           // extended thinking capable
  inputTypes?: string[];         // ["text", "image", "pdf"]
  cost: {
    input: number;               // $/1M tokens
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow: number;
  maxTokens: number;
  compat: {
    computerUse?: boolean;
    promptCaching?: boolean;
    streaming?: boolean;
  };
}

// Provider config — endpoint, auth, available models
interface ModelProviderConfig {
  id: string;                    // "anthropic"
  baseUrl: string;
  apiKey?: string;
  authMode?: "bearer" | "api-key" | "none";
  customHeaders?: Record<string, string>;
  models: ModelDefinitionConfig[];
}
```

**Lift for v3:** Our `Agent.model` field is a bare string. Replace with a model registry that stores cost/capability metadata per model. Enables cost tracking without hardcoding prices. Use LiteLLM for inference (per global config), but store the metadata structure above for cost budgeting and UI display.

**Channel plugin interface** — how OpenClaw normalizes multi-platform messaging.

```typescript
interface ChannelPlugin {
  id: string;                              // "whatsapp"
  meta: { name: string; description: string };
  capabilities: {
    streaming: boolean;
    threading: boolean;
    attachments: string[];                 // ["image", "document", "audio"]
    maxMessageLength: number;
  };

  // Adapters
  configAdapter: (raw: any) => ChannelConfig;
  outboundAdapter: (msg: OutboundMessage) => PlatformMessage;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  send(channelId: string, msg: PlatformMessage): Promise<void>;
}
```

**Lift for v3:** Our ChannelAdapter interface (already in this doc) is close. Add the `capabilities` field — the dashboard needs to know what each channel supports (can it stream? thread? accept attachments?) to render the composer correctly.

**18 lifecycle hooks** — more comprehensive than our 8.

```
OpenClaw hooks (18):
  gateway_start, gateway_stop,
  message_received, message_sending,
  llm_input, llm_output,
  before_tool_call, after_tool_call,
  tool_result_persist,
  before_agent_start, agent_started,
  session_start, session_end,
  before_compaction, after_compaction,
  before_message_write, after_message_write,
  error

Our hooks (8):
  message_received, before_model_call, before_tool_call,
  after_tool_call, before_message_send, tool_result_persist,
  session_end, before_agent_start
```

**Lift for v3:** Consider adding `before_compaction` / `after_compaction` (useful for preserving important context during long sessions), `error` (global error hook for alerting), and `agent_started` (distinct from `before_agent_start` — fires after boot completes, useful for "agent ready" notifications in the dashboard). Brings us to 11 hooks.

**CSS semantic tokens** — OpenClaw's design token structure.

```css
/* OpenClaw ui/src/styles/base.css */
:root {
  /* Backgrounds — 4 levels */
  --bg:          #1a1a2e;    /* base surface */
  --bg-accent:   #16213e;    /* secondary surface */
  --bg-elevated: #0f3460;    /* cards, panels */
  --bg-hover:    #1a1a3e;    /* interactive hover */
  --bg-muted:    #2a2a4e;    /* disabled, subtle */

  /* Card surface */
  --card:        #1e1e3e;

  /* Text — 3 levels */
  --text:        #e0e0e0;    /* primary */
  --text-strong: #ffffff;    /* emphasis */
  --muted:       #a0a0c0;    /* secondary */

  /* Accent */
  --accent:      #e94560;
  --accent-hover:#ff6b6b;
  --accent-glow: rgba(233, 69, 96, 0.3);

  /* Status */
  --ok:          #4ade80;
  --warn:        #fbbf24;
  --danger:      #ef4444;
  --info:        #60a5fa;

  /* Shadows — 4 levels + glow */
  --shadow-sm:   0 1px 2px rgba(0,0,0,0.3);
  --shadow-md:   0 4px 6px rgba(0,0,0,0.3);
  --shadow-lg:   0 10px 15px rgba(0,0,0,0.3);
  --shadow-xl:   0 20px 25px rgba(0,0,0,0.3);
  --shadow-glow: 0 0 20px var(--accent-glow);

  /* Radii — 5 levels */
  --radius-sm:   0.25rem;
  --radius-md:   0.5rem;
  --radius-lg:   0.75rem;
  --radius-xl:   1rem;
  --radius-full: 9999px;

  /* Motion — 3 durations x 3 easings */
  --duration-fast:   100ms;
  --duration-normal: 200ms;
  --duration-slow:   300ms;
  --ease-out:    cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Typography */
  --mono:         'JetBrains Mono', monospace;
  --font-body:    'Space Grotesk', sans-serif;
  --font-display: var(--font-body);
}
```

### From IronClaw (~100K LoC Rust)

**Per-job token auth** — ephemeral, scoped, constant-time validated.

```rust
// IronClaw's TokenStore — in-memory per-job token management
struct TokenStore {
    tokens: DashMap<String, JobToken>,  // job_id → token
}

struct JobToken {
    token_hash: Vec<u8>,    // SHA-256 of random 32-byte token
    job_id: String,
    created_at: Instant,
    credentials: Vec<CredentialGrant>,
}

impl TokenStore {
    fn generate(&self, job_id: &str) -> String {
        let token_bytes: [u8; 32] = rand::random();
        let token = hex::encode(token_bytes);
        let hash = Sha256::digest(token.as_bytes()).to_vec();
        self.tokens.insert(job_id.to_string(), JobToken {
            token_hash: hash,
            job_id: job_id.to_string(),
            created_at: Instant::now(),
            credentials: vec![],
        });
        token
    }

    fn validate(&self, job_id: &str, token: &str) -> bool {
        let hash = Sha256::digest(token.as_bytes());
        self.tokens.get(job_id)
            .map(|t| t.token_hash.ct_eq(&hash).into())  // constant-time comparison
            .unwrap_or(false)
    }

    fn revoke(&self, job_id: &str) {
        self.tokens.remove(job_id);
    }
}
```

**Lift for v3:** Port this pattern to Python for relay token auth. Our current `Session.relay_token` is a bare string stored in plaintext. Replace with hashed storage + constant-time validation. The pattern is simple enough to port directly — `secrets.compare_digest()` is Python's constant-time compare.

**Claude Code bridge** — NDJSON stream parsing from `claude` CLI.

```rust
// IronClaw spawns claude with stream-json output
let child = Command::new("claude")
    .args(["--output-format", "stream-json", "--verbose"])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()?;

// Parse NDJSON events from stdout
enum ClaudeStreamEvent {
    System { session_id: String, tools: Vec<String> },
    Assistant { message: ContentBlock },
    User { message: ContentBlock },
    Result {
        result: String,
        cost_usd: f64,
        input_tokens: u64,
        output_tokens: u64,
        duration_ms: u64,
        session_id: String,
    },
}

// Normalizer: raw events → platform-standard payloads
fn stream_event_to_payloads(event: ClaudeStreamEvent) -> Vec<JobEventPayload> {
    match event {
        ClaudeStreamEvent::Assistant { message } => match message {
            ContentBlock::Text { text } => vec![JobEventPayload::Message { text }],
            ContentBlock::ToolUse { id, name, input } =>
                vec![JobEventPayload::ToolUse { id, name, input }],
            ContentBlock::ToolResult { tool_use_id, content } =>
                vec![JobEventPayload::ToolResult { tool_use_id, content }],
            _ => vec![],
        },
        ClaudeStreamEvent::Result { cost_usd, input_tokens, output_tokens, .. } =>
            vec![JobEventPayload::CostUpdate { cost_usd, input_tokens, output_tokens }],
        _ => vec![],
    }
}
```

**Lift for v3:** This is exactly what our ClaudeCodeAdapter needs to do. The event types and normalization logic port directly to Python. Our existing relay already does some of this — the bridge pattern makes it systematic.

**WASM capability model** — zero-trust permission grants.

```rust
// IronClaw's per-agent capability specification
struct Capabilities {
    workspace_read: WorkspaceAccess {
        allowed_prefixes: Vec<PathBuf>,    // ["/home/agent/workspace"]
    },
    http: HttpAccess {
        allowlist: Vec<EndpointRule>,       // URL pattern matching
        credentials: Vec<CredentialRef>,
        rate_limit: RateLimit { max_per_minute: u32 },
        max_response_bytes: usize,
        timeout_ms: u64,
    },
    tool_invoke: ToolAccess {
        aliases: HashMap<String, ToolConfig>,
        rate_limit: RateLimit,
    },
    secrets: SecretAccess {
        allowed_names: Vec<GlobPattern>,   // ["GITHUB_*", "NPM_TOKEN"]
    },
}
```

**Lift for v3:** The capability struct maps cleanly to our `Session.capabilities` JSON field. Rather than a flat JSON blob, define a typed schema that the backend validates on secret_request. The glob pattern matching for secret names is particularly useful — lets you grant `GITHUB_*` instead of enumerating every GitHub token.

**Hook trait** — typed hook interface with failure modes.

```rust
enum HookPoint {
    MessageReceived, BeforeModelCall, BeforeToolCall,
    AfterToolCall, BeforeMessageSend, SessionEnd,
}

enum HookOutcome {
    Continue(Option<ModifiedData>),  // pass or modify
    Reject(String),                  // block with reason
}

enum HookFailureMode {
    FailOpen,   // hook error → proceed anyway
    FailClosed, // hook error → block
}

#[async_trait]
trait Hook: Send + Sync {
    fn point(&self) -> HookPoint;
    fn priority(&self) -> i32;
    fn failure_mode(&self) -> HookFailureMode;
    fn timeout(&self) -> Duration;

    async fn execute(&self, event: HookEvent) -> Result<HookOutcome, HookError>;
}
```

**Lift for v3:** Add `failure_mode` and `timeout` to our hook interface. Critical hooks (secret injection, team routing) should be `FailClosed` — if the hook errors, block the action. Non-critical hooks (cost logging, telemetry) should be `FailOpen`.

**Cost tracking** — per-model cost lookup with provider normalization.

```rust
fn model_cost(model: &str) -> (Decimal, Decimal) {
    // Normalize: strip provider prefix, handle aliases
    let normalized = model
        .strip_prefix("anthropic/").or(model.strip_prefix("openai/"))
        .unwrap_or(model);

    match normalized {
        "claude-sonnet-4-6"  => (dec!(3.0), dec!(15.0)),   // $/M tokens
        "claude-haiku-4-5"   => (dec!(0.80), dec!(4.0)),
        "gpt-4o"             => (dec!(2.50), dec!(10.0)),
        _ if is_local(model) => (dec!(0), dec!(0)),
        _ => (dec!(0), dec!(0)),  // unknown = free (safe default)
    }
}
```

**Lift for v3:** Replace with a model registry (see OpenClaw's ModelDefinitionConfig above). Hardcoded cost tables rot quickly. The registry approach lets us update costs without code changes — store in DB or config file, seed from OpenClaw's model list.

### From EdgeClaw (~290K LoC TypeScript)

**8 hook interception points** — the actual hook architecture we based ours on.

```
EdgeClaw hooks:
  message_received, resolve_model, before_tool_call, after_tool_call,
  tool_result_persist, session_end, message_sending, before_agent_start
```

**Lift for v3:** Already incorporated. EdgeClaw's `resolve_model` hook is interesting — it lets the system dynamically pick a model per-request based on sensitivity classification. We should support this as a `before_model_call` hook that can modify the model selection.

**Dual-track history** — what the local model sees vs what the cloud model sees.

```
sessions/full/   → complete history (local model, trusted)
sessions/clean/  → redacted history (cloud model, untrusted)
```

**Lift for v3:** Useful pattern for our `tool_result_persist` hook. Dashboard feed shows full tool output; if a customer has sensitivity requirements, the persist hook can redact before writing to the database while keeping full output in the container's local session.

### From ClawWork (~16K LoC Python)

**TrackedProvider** — wraps any LLM provider for cost tracking.

```python
class TrackedProvider:
    """Wraps an LLM provider, intercepts every chat() call."""
    def __init__(self, provider, cost_tracker):
        self.provider = provider
        self.cost_tracker = cost_tracker

    async def chat(self, messages, **kwargs):
        result = await self.provider.chat(messages, **kwargs)
        self.cost_tracker.record(
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
        )
        return result
```

**Lift for v3:** This is our `before_model_call` / cost budgeting hook pattern. Rather than wrapping the provider directly (we don't control the agent's LLM calls), we observe cost from the agent's event stream. The ClaudeStreamEvent.Result carries cost data; for non-CC agents, the adapter estimates from token counts.

---

## Design System

### Current state — 23% token coverage

Our current theming (42 tokens across 4 themes) covers color only. No typography, spacing, shadow, motion, or opacity tokens.

| Category | Current tokens | Target (from analysis) | Gap |
|----------|---------------|----------------------|-----|
| **Background** | 8 (background, foreground, card, popover, muted, primary, secondary, accent) | 5 levels (base, accent, elevated, hover, muted) | Overlapping names, no hierarchy |
| **Foreground/Text** | 4 (foreground, card-foreground, muted-foreground, accent-foreground) | 4 levels (primary, emphasis, muted, subtle) | Close — rename for clarity |
| **Status** | 2 (destructive, destructive-foreground) | 4 pairs (ok, warn, danger, info) | Missing ok, warn, info |
| **Border** | 2 (border, input, ring) | 3 (default, subtle, focus) | Close |
| **Shadow** | 0 | 4 levels + glow (sm, md, lg, xl, glow) | Fully missing |
| **Radius** | 1 (radius) | 5 levels (sm, md, lg, xl, full) | 4 missing |
| **Typography** | 0 | 3 families + sizes (mono, body, display) | Fully missing |
| **Spacing** | 0 | Scale (0.5–16 in rem) | Fully missing |
| **Motion** | 0 | 3 durations + 3 easings | Fully missing |
| **Opacity** | 0 | 4 levels (subtle, muted, half, overlay) | Fully missing |

**Installed fonts:** Geist (body) + Geist Mono (code). No display font.

**Theme mechanism:** `data-theme` attribute on `<html>`, 4 themes defined in `globals.css`, Tailwind v4 `@theme` block. augmented-ui v2.0.0 for corner clipping.

### Target — semantic token schema

Abstracted from Crush's centralized Styles structure + OpenClaw's CSS token hierarchy. The schema defines the complete set of semantic slots a theme must fill. Plugging in different color palettes produces different themes without touching component code.

```css
:root {
  /* ── Backgrounds — 5 levels ── */
  --bg-base:      ;    /* page background */
  --bg-surface:   ;    /* cards, panels */
  --bg-elevated:  ;    /* popovers, dropdowns */
  --bg-hover:     ;    /* interactive hover state */
  --bg-muted:     ;    /* disabled surfaces, subtle fills */

  /* ── Foreground / Text — 4 levels ── */
  --fg-default:   ;    /* primary text */
  --fg-emphasis:  ;    /* headings, strong text */
  --fg-muted:     ;    /* secondary text, labels */
  --fg-subtle:    ;    /* placeholder, disabled text */

  /* ── Accent — primary interactive color ── */
  --accent:       ;    /* buttons, links, active states */
  --accent-hover: ;    /* accent on hover */
  --accent-glow:  ;    /* accent halo / focus ring glow */
  --accent-fg:    ;    /* text on accent background */

  /* ── Status — 4 semantic categories ── */
  --ok:           ;    /* success, healthy, completed */
  --ok-fg:        ;
  --warn:         ;    /* warning, degraded, in-progress */
  --warn-fg:      ;
  --danger:       ;    /* error, failed, destructive */
  --danger-fg:    ;
  --info:         ;    /* informational, neutral highlight */
  --info-fg:      ;

  /* ── Border ── */
  --border-default: ;  /* standard borders */
  --border-subtle:  ;  /* light dividers */
  --border-focus:   ;  /* focus rings */

  /* ── Shadow — 4 levels + glow ── */
  --shadow-sm:    ;
  --shadow-md:    ;
  --shadow-lg:    ;
  --shadow-xl:    ;
  --shadow-glow:  ;    /* accent-colored halo */

  /* ── Radius — 5 levels ── */
  --radius-sm:    0.25rem;
  --radius-md:    0.5rem;
  --radius-lg:    0.75rem;
  --radius-xl:    1rem;
  --radius-full:  9999px;

  /* ── Motion — durations + easings ── */
  --duration-fast:    100ms;
  --duration-normal:  200ms;
  --duration-slow:    300ms;
  --ease-out:     cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in-out:  cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);

  /* ── Typography ── */
  --font-mono:    'Geist Mono', monospace;
  --font-body:    'Geist', sans-serif;
  --font-display: var(--font-body);

  --text-xs:      0.75rem;
  --text-sm:      0.875rem;
  --text-base:    1rem;
  --text-lg:      1.125rem;
  --text-xl:      1.25rem;
  --text-2xl:     1.5rem;

  /* ── Opacity ── */
  --opacity-subtle:  0.1;
  --opacity-muted:   0.3;
  --opacity-half:    0.5;
  --opacity-overlay: 0.7;

  /* ── Spacing (reference scale) ── */
  --space-1:  0.25rem;   /* 4px */
  --space-2:  0.5rem;    /* 8px */
  --space-3:  0.75rem;   /* 12px */
  --space-4:  1rem;      /* 16px */
  --space-6:  1.5rem;    /* 24px */
  --space-8:  2rem;      /* 32px */
  --space-12: 3rem;      /* 48px */
  --space-16: 4rem;      /* 64px */
}
```

### How themes plug in

A theme only needs to define the color slots. Structure tokens (radius, spacing, motion, typography) stay constant across themes. This is the Crush pattern — one centralized structure, swap the palette.

```css
/* cyberpunk theme */
[data-theme="cyberpunk"] {
  --bg-base:      #0a0a12;
  --bg-surface:   #12121e;
  --bg-elevated:  #1a1a2e;
  --bg-hover:     #1e1e30;
  --bg-muted:     #2a2a3e;

  --fg-default:   #e0e0e8;
  --fg-emphasis:  #ffffff;
  --fg-muted:     #8888a0;
  --fg-subtle:    #555570;

  --accent:       #00ffcc;
  --accent-hover: #33ffd6;
  --accent-glow:  rgba(0, 255, 204, 0.25);
  --accent-fg:    #0a0a12;

  --ok:     #4ade80;  --ok-fg:     #0a0a12;
  --warn:   #fbbf24;  --warn-fg:   #0a0a12;
  --danger: #ef4444;  --danger-fg: #ffffff;
  --info:   #60a5fa;  --info-fg:   #0a0a12;

  --border-default: rgba(255, 255, 255, 0.1);
  --border-subtle:  rgba(255, 255, 255, 0.05);
  --border-focus:   var(--accent);

  --shadow-sm:   0 1px 2px rgba(0,0,0,0.5);
  --shadow-md:   0 4px 8px rgba(0,0,0,0.5);
  --shadow-lg:   0 10px 20px rgba(0,0,0,0.5);
  --shadow-xl:   0 20px 40px rgba(0,0,0,0.5);
  --shadow-glow: 0 0 20px var(--accent-glow);
}
```

Adding a new theme = defining ~25 color values. Everything else (components, spacing, radius, motion) just works.

### Focus/blur variants (from Crush)

Crush uses focus/blur styling for interactive elements — thicker borders, brighter text when focused. This is directly applicable to our augmented-ui clipped panels:

```css
/* Normal state */
.aug-card {
  border-color: var(--border-subtle);
  color: var(--fg-muted);
}

/* Focused / selected state */
.aug-card[data-selected] {
  border-color: var(--accent);
  color: var(--fg-default);
  box-shadow: var(--shadow-glow);
}
```

### CLI-like aesthetic (from Crush)

The dashboard should "FEEL like a more interactive CLI." Key patterns from Crush:

- **Icon + color for status** — `●` (pending/amber), `✓` (success/green), `×` (error/red), `⟳` (running/blue). No text labels needed.
- **Monospace-first hierarchy** — Typography hierarchy through color weight, not font size. Body text and code use the same family (Geist Mono). Headings differentiate via `--fg-emphasis` + font-weight, not size.
- **Dense information packing** — Narrow vertical spacing (Crush uses 2-char grid). Our feed items should be compact by default.
- **Subtle animation** — Ellipsis cycling for "thinking" states, gentle color transitions on hover. No bouncing, no sliding — terminal-like restraint.

---

## Our Actual Delta

After analyzing 5 agent platforms and a CLI design system, the picture is clear: most of what agentobox needs already exists in some form. Our unique contribution is narrow and well-defined.

### What already exists (lift, don't build)

| Capability | Source | Estimated port effort |
|-----------|--------|----------------------|
| Provider abstraction (model registry, cost/capability metadata) | OpenClaw | Port TypeScript types to Python models, ~200 lines |
| Channel adapters (WhatsApp, Telegram, Slack, Discord, Email) | OpenClaw | Already uses proven libraries (Baileys, grammy, Bolt). Channel interface design is validated. |
| Hook system (lifecycle interception with pass/modify/block) | EdgeClaw + IronClaw | 8 hooks already designed, add 3 from OpenClaw analysis. ~300 lines |
| Claude Code bridge (NDJSON stream parsing, event normalization) | IronClaw | Port Rust → Python. Pattern is clear, ~200 lines |
| Per-job token auth (constant-time, scoped, ephemeral) | IronClaw | Port to Python with `secrets.compare_digest()`, ~100 lines |
| Capability model (typed permission grants with glob matching) | IronClaw | JSON schema + validation, ~150 lines |
| Cost tracking (per-model lookup, provider normalization) | IronClaw + ClawWork | Model registry replaces hardcoded table, ~100 lines |
| Semantic design tokens (backgrounds, text, status, shadows, motion) | OpenClaw + Crush | CSS token schema defined above, ~150 lines of CSS |
| CLI-like UI patterns (icon+color status, dense packing, monospace) | Crush | Design patterns, not code to port |

### What we actually build (our delta)

Only two things don't exist in any project we analyzed:

**1. Multi-agent teaming coordination**

No analyzed project handles teams of agents. This is our core IP:
- Team primitives (create, join, message, broadcast, task assign)
- `before_tool_call` hook intercepting `Task(team_name=...)` → container spawn
- Native teaming for CC + simulated teaming for non-CC agents
- Task model synced from agent stream observation
- Team-aware CLAUDE.md generation
- Dashboard team visualization (roster, task board, inter-agent message flow)

Source of patterns: Claude Code's own teaming primitives (TeamCreate, SendMessage, TaskList, TaskUpdate). We're lifting the interaction design and abstracting it to work platform-side with any agent.

**2. Design system / visual identity**

The semantic token structure is lifted from OpenClaw/Crush. What's ours:
- augmented-ui integration (corner clipping, sci-fi panels)
- Theme palettes (cyberpunk, retro, rose-pine, hyper)
- Information density ladder implementation
- Feed item renderers (15 specialized components)
- Agent color assignment system
- VNC observation panel

### What this means for scope

```
Total estimated v3 codebase:  ~18,000-22,000 lines

Lifted patterns (port/adapt):     ~1,200 lines  (7%)
Teaming coordination (new):       ~3,000 lines  (15%)
Design system (new + lifted):     ~2,000 lines  (10%)
Carried forward from v2:          ~12,000 lines (63%)
Gateway (new, using OpenClaw libs): ~1,500 lines (8%)
```

The majority of v3 is either carried forward from v2 or ported from existing projects. The genuinely new engineering is teaming coordination — everything else is integration, adaptation, and visual polish.

---

## Open Questions

1. **Gateway language.** Node.js is proposed for WS/channel handling. Alternative: keep everything in Python (Django Channels handles WS natively). Tradeoff: Node.js is better for I/O-heavy WS management, but adding a second service adds operational complexity.

2. **Adapter hosting.** Do adapters run inside the container (current proposal) or as a sidecar? In-container is simpler but couples adapter code to the agent process. Sidecar isolates them but adds networking complexity.

3. **Channel auth.** Each channel has its own auth model (WhatsApp QR pairing, Telegram bot token, Slack OAuth). How much of this do we manage vs delegate to the user? IronClaw's approach: wizard-guided setup per channel. OpenClaw's approach: config file with tokens.

4. **Agent type marketplace.** Should users be able to add custom agent types (bring their own CLI agent)? The GenericCliAdapter supports this in theory, but the adapter quality matters — a bad adapter produces garbled events.

5. **Cross-agent-type teaming quality.** Native CC teaming is smooth. Simulated teaming for Codex/Aider will be rougher — commands parsed from stdout, messages injected as context. Is the quality gap acceptable, or do we need a richer simulation layer?

6. **Gateway deployment.** Same Docker Compose stack? Separate service? The gateway needs to be always-on for channel connections (WhatsApp disconnects if the client goes offline). Backend can restart without losing channels if gateway is separate.

7. **VNC necessity per agent type.** Claude Code agents rarely need VNC (terminal-first). Codex is terminal-only. Aider is terminal-only. VNC is mainly useful for computer-use agents or browser-based tasks. Should it be opt-in per agent to save resources?

8. **Hook expansion.** Should we go from 8 to 11 hooks (adding `before_compaction`, `after_compaction`, `error`)? More hooks = more interception surface but also more complexity for hook authors. OpenClaw has 18 — is that over-engineered or forward-looking?

9. **Model registry source.** OpenClaw maintains a hardcoded model list with costs. LiteLLM has its own model database. Should we pull from LiteLLM's registry at runtime, maintain our own, or hybrid (LiteLLM for inference, our DB for cost metadata)?

10. **Design token migration.** Current 42 tokens need to be renamed/reorganized to match the new schema (~55 tokens). This touches every component. Do we do it in one migration or incrementally with aliasing?
