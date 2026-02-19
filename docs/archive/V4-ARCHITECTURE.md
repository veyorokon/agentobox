# V4 Architecture: OpenClaw Runtime + Management Plane

V3 assumed we build the agent runtime — CC bridge, WS protocol, provider abstraction, session persistence, rate limiting, hooks, relay. ~15,000 lines of infrastructure.

Discovery: OpenClaw IS the agent runtime. Real people already run multi-agent teams on it (15+ agents, 3 machines, 1 Discord server). The coordination mechanism is simple: shared filesystem + chat channel routing + cron.

Agentobox's value isn't a better agent runtime. It's the **management plane**: dashboard, provisioning, observability, VNC, multi-user auth, cost tracking. The difference between "SSH into my VPS and configure agents manually" and "click a button and a team spins up."

---

## Evidence

Real-world multi-agent teams already running on OpenClaw:

| Who | Setup | Coordination |
|-----|-------|--------------|
| Trebuh (@iamtrebuh) | 4 agents on VPS: Milo (strategy lead), Josh (business), marketing, dev | Single Telegram group, @-mention routing, shared GOALS.md / DECISIONS.md / PROJECT_STATUS.md, cron schedules |
| @jdrhyne | 15+ agents, 3 machines | 1 Discord server. "IT built most of this, just by chatting" |
| @danpeguine | 2 OpenClaw instances | Same WhatsApp group, collaborating on shared codebase |
| @nateliason | Multi-model pipeline | Prototype → summarize → optimize → implement → repeat, different models at each stage |

Source: [awesome-openclaw-usecases](https://github.com/hesamsheikh/awesome-openclaw-usecases), [OpenClaw Showcase](https://openclaw.ai/showcase)

**What they all have in common:**
- OpenClaw handles per-agent runtime (CC process, session persistence, LLM routing)
- Coordination is simple (shared files + chat channels + cron)
- No custom backend, no custom dashboard
- Manual setup, single-user

**What they lack (our product):**
- Automated provisioning
- Fleet dashboard with real-time observability
- VNC agent observation
- Multi-user auth and RBAC
- Aggregated cost tracking
- Structured event streams
- One-click team deployment

---

## What OpenClaw Provides (Per-Agent)

Everything the LIFT-MAP was going to build for per-agent mechanics:

| Capability | OpenClaw implementation | LIFT-MAP equivalent |
|-----------|----------------------|-------------------|
| CC bridge | Spawns `claude` with stream-json, parses NDJSON, manages stdin/stdout | Section 1 (WebSocket relay) |
| Session persistence | Built-in session management, resume on restart | Section 5 (session state) |
| Provider abstraction | pi-ai supporting 15+ LLM providers, LiteLLM optional | Section 11 (provider config) |
| Rate limiting | Per-provider token/request rate limits | Section 11 (LiteLLM Proxy) |
| Channel adapters | WhatsApp (Baileys), Telegram (grammy), Slack (Bolt), Discord, Email | Section 4 (channels) — deferred in V3 |
| Hook system | 18 lifecycle hooks (message_received through error) | Section 8 (8 hooks) |
| Error handling | Retry with backoff, circuit breaker | Section 12 (resilience) |
| Cost tracking | Per-model cost lookup, token counting | Section 13 (cost tracking) |
| Plugin system | Extensible plugin architecture | N/A |
| Cross-agent messaging | sessions_spawn / sessions_send | Section 8a (team routing) |
| Scheduled tasks | HEARTBEAT.md / cron-based task execution | N/A |
| SOUL.md / CLAUDE.md | Per-agent personality and instructions | CLAUDE.md generation |

**What this eliminates from our build:**
- Custom WS protocol (~800 lines)
- Custom CC bridge / relay (~500 lines)
- Provider abstraction layer (~400 lines)
- Session persistence service (~300 lines)
- Rate limiting infrastructure (~200 lines)
- Error handling / retry logic (~200 lines)
- ~2,400 lines of infrastructure we don't write

---

## What Agentobox Builds

Four components. Everything else is OpenClaw.

### 1. Dashboard (~7,000 lines)

The product. Real-time fleet management UI.

Carries forward from V2/V3 unchanged:
- augmented-ui + theme system (cyberpunk visual identity)
- Feed item renderers (15 specialized components)
- Scroll behavior (totalListHeightChanged + rAF + pinned tracking)
- Zustand store patterns (single source of truth)
- Information density ladder (L0 overview → L1 scan → L2 focus → L3 deep dive)
- Design tokens (full schema from LIFT-MAP section 16)

New in V4:
- OpenClaw event format → FeedItem transform (replaces custom relay event format)
- Agent provisioning UI (name, role, instructions, model → createAgent)
- Team-level views (roster, task board, inter-agent message flow)
- Cost dashboard (aggregated from OpenClaw's per-agent cost data)

### 2. Django Backend (~3,500 lines)

Coordination layer. Agent CRUD, event aggregation, auth, cost tracking.

| Service | Responsibility | Lines |
|---------|---------------|-------|
| Lifecycle | Agent CRUD, container provisioning, status management | ~600 |
| Comms | Inter-agent message routing, message persistence | ~400 |
| Feed | Event → FeedItem transform, subscription broadcast | ~500 |
| Provisioning | Container image config, CLAUDE.md generation, workspace mount | ~400 |
| Cost | Aggregate per-agent costs, budget enforcement | ~200 |
| Auth | User management, JWT, RBAC | ~300 |
| GraphQL schema | Queries, mutations, subscriptions | ~600 |
| Runtime adapters | Docker + Modal container management | ~500 |

Models (carried forward, simplified):
```python
class Agent(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=20, default='worker')
    model = models.CharField(max_length=100, default='claude-sonnet-4-6')
    instructions = models.TextField(blank=True)
    workspace_path = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, default='stopped')
    mcp_servers = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class Session(models.Model):
    agent = models.OneToOneField(Agent, on_delete=models.CASCADE, related_name='session')
    container_id = models.CharField(max_length=200)
    sandbox_id = models.CharField(max_length=200, blank=True)
    relay_token = models.CharField(max_length=100)
    last_heartbeat_at = models.DateTimeField(null=True)
    session_cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

class AgentTask(models.Model):
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

**Removed from V3:** Team, TeamMembership, ChannelBinding, ProjectSecret, SecretGrant. OpenClaw handles channels and sessions natively. Team membership is implicit (agents in the same project = same team). Secrets are managed through OpenClaw's own mechanism or env var injection at container level (not ideal, but pragmatic for V4 — proper secret injection is a V5 concern).

### 3. Container Image

OpenClaw + VNC + event bridge + workspace mount.

```
┌─────────────────── Agent Container ───────────────┐
│                                                     │
│  OpenClaw (as-is)                                   │
│  ├── Claude Code process (stream-json)              │
│  ├── Session management                             │
│  ├── LLM provider routing                           │
│  ├── Hook system                                    │
│  └── Local API / WS server                          │
│                                                     │
│  VNC stack                                          │
│  ├── Xvfb :99                                       │
│  ├── AwesomeWM (window manager)                     │
│  ├── x11vnc                                         │
│  └── websockify (noVNC bridge)                      │
│                                                     │
│  Event bridge (~200 lines)                          │
│  └── OpenClaw events → POST to backend              │
│                                                     │
│  Workspace                                          │
│  └── /home/agent/workspace (bind mount from host)   │
│                                                     │
│  Config                                             │
│  ├── SOUL.md (agent identity + instructions)        │
│  ├── OpenClaw config (model, provider, API keys)    │
│  └── Hook overrides (team routing)                  │
└─────────────────────────────────────────────────────┘
```

```dockerfile
FROM node:22-alpine

# OpenClaw
RUN npm install -g openclaw

# Desktop environment (for VNC observation)
RUN apk add --no-cache \
    xvfb x11vnc openbox xterm firefox-esr novnc websockify

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Event bridge
COPY event-bridge/ /opt/agentobox/bridge/

# s6-overlay for process supervision
ADD s6-overlay.tar.gz /
COPY rootfs/ /

ENTRYPOINT ["/init"]
```

Process tree:
```
/init (s6-overlay)
├── openclaw           — manages Claude Code, sessions, hooks
├── event-bridge       — subscribes to OpenClaw events, POSTs to backend
├── Xvfb :99           — virtual framebuffer
├── openbox            — window manager
├── x11vnc             — VNC server
└── websockify         — WebSocket proxy for noVNC
```

### 4. Event Bridge (~200 lines)

The thinnest possible connection between OpenClaw and our backend. Subscribes to OpenClaw's local event stream, normalizes to our format, POSTs to backend.

```python
"""
Event bridge: OpenClaw → agentobox backend.

Subscribes to OpenClaw's WebSocket event stream (localhost),
normalizes events, POSTs batches to the backend.
"""

import asyncio
import json
import aiohttp

OPENCLAW_WS = "ws://localhost:3000/ws"   # OpenClaw's local WS
BACKEND_URL = os.environ["AGENTOBOX_BACKEND_URL"]
AGENT_ID = os.environ["AGENTOBOX_AGENT_ID"]
RELAY_TOKEN = os.environ["AGENTOBOX_RELAY_TOKEN"]
BATCH_INTERVAL = 2.0  # seconds

async def bridge():
    batch = []

    async with aiohttp.ClientSession() as http:
        async with http.ws_connect(OPENCLAW_WS) as ws:
            async def flush():
                while True:
                    await asyncio.sleep(BATCH_INTERVAL)
                    if batch:
                        events, batch[:] = batch[:], []
                        await http.post(
                            f"{BACKEND_URL}/agents/{AGENT_ID}/stream",
                            json={"events": events},
                            headers={"Authorization": f"Bearer {RELAY_TOKEN}"},
                        )

            flusher = asyncio.create_task(flush())

            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    event = json.loads(msg.data)
                    normalized = normalize_event(event)
                    if normalized:
                        batch.append(normalized)

            flusher.cancel()


def normalize_event(raw: dict) -> dict | None:
    """Map OpenClaw event types to agentobox event format."""
    event_type = raw.get("type")

    if event_type == "assistant":
        return {
            "type": "assistant",
            "content": raw.get("message", {}),
            "timestamp": raw.get("timestamp"),
        }
    elif event_type == "tool_use":
        return {
            "type": "tool_use",
            "name": raw.get("name"),
            "input": raw.get("input"),
            "timestamp": raw.get("timestamp"),
        }
    elif event_type == "tool_result":
        return {
            "type": "tool_result",
            "tool_use_id": raw.get("tool_use_id"),
            "content": raw.get("content"),
            "timestamp": raw.get("timestamp"),
        }
    elif event_type == "result":
        return {
            "type": "result",
            "cost_usd": raw.get("cost_usd", 0),
            "input_tokens": raw.get("input_tokens", 0),
            "output_tokens": raw.get("output_tokens", 0),
            "duration_ms": raw.get("duration_ms", 0),
            "session_id": raw.get("session_id"),
        }
    return None
```

This replaces:
- The entire abox-relay (~150 lines) from V2
- The entire custom WS protocol from V3
- The entire Redis Streams infrastructure from LIFT-MAP

The bridge has one job: subscribe to OpenClaw's local events, batch them, POST to our backend. The backend's `process_stream_events()` logic stays the same — it just receives events from the bridge instead of the old relay.

---

## Architecture Diagram

```
Users
  │
  ├── Web Dashboard (Next.js)
  │     ↕ GraphQL (queries, mutations, subscriptions)
  │
  ▼
┌──────────────────────────────────────────┐
│          Backend (Django/Daphne)          │
│                                          │
│  Agent CRUD        Cost aggregation      │
│  Event processing  Budget enforcement    │
│  Feed broadcast    GraphQL API           │
│  Container mgmt    User auth / RBAC      │
│  Inter-agent       Task sync             │
│  message routing                         │
└────────────┬─────────────────────────────┘
             │
    Container management
    (Docker API / Modal API)
             │
     ┌───────┼───────┐
     ▼       ▼       ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Agent A  │ │ Agent B  │ │ Agent C  │
│          │ │          │ │          │
│ OpenClaw │ │ OpenClaw │ │ OpenClaw │
│ CC proc  │ │ CC proc  │ │ CC proc  │
│ VNC      │ │ VNC      │ │ VNC      │
│ Bridge   │ │ Bridge   │ │ Bridge   │
│ Mount    │ │ Mount    │ │ Mount    │
└─────────┘ └─────────┘ └─────────┘
     │           │           │
     └───────────┴───────────┘
       shared workspace (bind mount)
```

**Key difference from V3:** No separate Gateway service. No Node.js. Backend handles everything — it already runs Daphne (ASGI) which supports WebSocket natively. OpenClaw inside each container handles channels if needed (a container can have its own Telegram/Slack connection configured through OpenClaw).

**Why no Gateway anymore:** V3's Gateway existed to manage channel adapters (WhatsApp, Telegram, etc.) and hundreds of WS connections. With OpenClaw handling channels per-container, the Gateway has no purpose. Dashboard WS connections go directly to Django/Daphne. Event bridges POST directly to backend. Inter-agent routing is backend-internal.

---

## Team Coordination

How agents work together. Three layers, each building on the prior.

### Layer 1: Shared Filesystem (free, works today)

All agents mount the same workspace directory. File changes are immediately visible to all.

```
/home/agent/workspace/
├── src/                    # shared codebase
├── GOALS.md                # team priorities (all agents read/write)
├── DECISIONS.md            # key decisions log
├── PROJECT_STATUS.md       # current state
└── .agent-notes/
    ├── backend/            # backend agent's private notes
    ├── frontend/           # frontend agent's private notes
    └── qa/                 # QA agent's private notes
```

This is exactly what the multi-agent teams on OpenClaw already do. It works because agents are LLMs — they read markdown files naturally.

### Layer 2: Inter-Agent Messaging (backend-routed)

For real-time coordination beyond file sharing. Backend routes messages between agents.

```
Agent A calls SendMessage(recipient="frontend", message="PR #42 is ready for review")
  → CC hook intercepts
  → POST to backend
  → Backend looks up "frontend" agent in same project
  → Backend pushes message to Agent B's OpenClaw instance (via API or stdin injection)
  → Agent B receives as a user turn: "[backend] PR #42 is ready for review"
```

OpenClaw's `sessions_send` handles this per-container. Our backend adds fleet-level routing — it knows which container hosts which agent.

### Layer 3: Task Management (stream observation)

Tasks are CC's native feature. Agents create/update tasks using TaskCreate/TaskUpdate tools. Our backend observes the event stream and syncs task state to the database for dashboard display.

```
Agent calls TaskCreate(subject="Fix login redirect", owner="frontend")
  → Event bridge captures tool_use event
  → Backend creates AgentTask record
  → Dashboard subscription pushes task update
  → Dashboard shows task in team task board
```

No custom task system needed. CC's task tools work natively. We just observe and mirror.

---

## SOUL.md / CLAUDE.md Generation

OpenClaw uses SOUL.md for agent personality. CC uses CLAUDE.md for agent instructions. We generate both at provisioning time.

**SOUL.md** (OpenClaw reads this):
```markdown
You are {agent_name}, {role_description} on the {project_name} project.

{user_provided_instructions}
```

**CLAUDE.md** (CC reads this):
Same section structure from the V3 plan (identity, platform, workspace, responsibilities, team roster, communication, coordination/tasks, security). The only change: platform section describes OpenClaw instead of raw agentobox containers.

The existing `_build_claude_md()` in `backend/agents/services/provision.py` carries forward with minimal changes.

---

## Data Flow

### Agent does something

```
1. CC calls a tool
2. OpenClaw captures stream-json event
3. Event bridge normalizes → batch
4. Bridge POSTs batch to backend
5. Backend:
   a. Upserts Message (append content part)
   b. Builds FeedItem
   c. Updates AgentTask if task-related
   d. Pushes FeedItem via GraphQL subscription
6. Dashboard renders
```

### User sends message (via dashboard)

```
1. User types in dashboard composer
2. GraphQL mutation: sendMessage(agentId, text)
3. Backend:
   a. Creates Message record
   b. Pushes to agent container (OpenClaw API or direct stdin)
   c. Builds FeedItem for sent message
   d. Pushes via subscription
4. OpenClaw delivers to CC as user turn
5. CC responds → triggers "agent does something" flow
```

### Agent spawns teammate (lead only)

```
1. Lead calls Task(team_name="project", name="frontend", prompt="...")
2. CC hook intercepts (team_name present)
3. Hook POSTs to backend
4. Backend:
   a. Creates Agent record
   b. Creates Session record
   c. Provisions new container (OpenClaw + VNC + bridge)
   d. Generates SOUL.md + CLAUDE.md
   e. Mounts same workspace
   f. Starts event bridge
   g. Creates Event + FeedItem ("frontend joined the team")
   h. Notifies existing agents
5. Dashboard updates via subscription
6. New agent boots in ~30-60 seconds
```

---

## What Carries Forward

### From V2 (current implementation)
- Backend service architecture (lifecycle, comms, feed, provisioning)
- GraphQL schema (Strawberry)
- Docker + Modal runtime adapters
- Hook interception pattern (PreToolUse for Task(team_name=...))
- Stream observation → AgentTask sync

### From V3 (spec, not built)
- CLAUDE.md section template system (identity, platform, workspace, etc.)
- Semantic design token schema (section 16 of LIFT-MAP)
- AgentAdapter interface concept (becomes our escape hatch — see below)

### From LIFT-MAP (reference patterns)
- IronClaw per-job token auth → relay_token validation (`secrets.compare_digest`)
- IronClaw CC bridge event types → event bridge normalize_event()
- ClawWork TrackedProvider → cost tracking from event stream
- Crush/OpenClaw design tokens → dashboard theme system
- EdgeClaw dual-track history → `tool_result_persist` hook for redaction

### From UX Spec (DASHBOARD-UX-SPEC.md)
- Information density ladder
- Feature inventory with level classification
- Feed scroll behavior
- augmented-ui visual identity
- Cognitive dimension analysis

---

## What Gets Eliminated

LIFT-MAP sections no longer needed:

| Section | Why eliminated |
|---------|--------------|
| 1. WebSocket relay protocol | OpenClaw handles CC bridge internally |
| 4. Channel adapters | OpenClaw has native channel support |
| 5. Redis Streams event replay | Event bridge POSTs directly, no replay needed |
| 6. Database event persistence | Simplified — backend processes bridge POSTs |
| 8. Hook system implementation | OpenClaw has 18 hooks, we just configure them |
| 11. Provider abstraction | OpenClaw's pi-ai + LiteLLM |
| 12. Resilience (retry, circuit breaker) | OpenClaw handles per-agent |
| 13. Cost tracking implementation | OpenClaw tracks per-session, we aggregate |

**V3 components eliminated:**
- Gateway (Node.js) — no longer needed, OpenClaw handles channels per-container
- Agent Adapter interface — simplified, OpenClaw is the only runtime initially
- Channel adapter implementations — OpenClaw
- Custom relay process — replaced by ~200 line event bridge
- Secret management (AES-256-GCM vault, SecretGrant, relay injection) — deferred, OpenClaw + env vars for now

---

## The Escape Hatch: AgentRuntime Interface

OpenClaw is a 600K LoC dependency maintained by a third party. If they break their API or abandon the project, we need to swap runtimes.

The escape hatch: design the event bridge against an abstract interface.

```python
class AgentRuntime(Protocol):
    """Interface between agentobox backend and the per-agent runtime."""

    async def connect(self) -> None:
        """Establish connection to the agent runtime."""
        ...

    async def send_message(self, text: str, sender: str) -> None:
        """Inject a message into the agent's input stream."""
        ...

    async def subscribe_events(self) -> AsyncIterator[dict]:
        """Stream of normalized events from the agent."""
        ...

    async def get_session_info(self) -> dict:
        """Current session state (cost, tokens, status)."""
        ...


class OpenClawRuntime(AgentRuntime):
    """V4: Use OpenClaw as the agent runtime."""
    # Connects to OpenClaw's local WS API
    # Normalizes OpenClaw events to our format
    # Sends messages via OpenClaw's API
    ...


class DirectCCRuntime(AgentRuntime):
    """Future: Direct Claude Code integration (if we ever need it)."""
    # The LIFT-MAP becomes the implementation spec for this class
    # Spawns claude with stream-json
    # Parses NDJSON directly
    # Manages session state ourselves
    ...
```

**The LIFT-MAP doesn't get deleted — it becomes the spec for `DirectCCRuntime`.** If OpenClaw dies, we build sections 1, 5, 8, 11, 12, 13 behind this interface. The dashboard and backend never know the difference.

Cost of the escape hatch: ~50 lines of interface definition + keeping normalize_event() clean and well-typed. Minimal overhead.

---

## Scope Comparison

| Dimension | V2 (current) | V3 (planned) | V4 (this doc) |
|-----------|-------------|-------------|--------------|
| Agent runtime | Custom relay | Custom adapter per agent type | OpenClaw |
| Input channels | Web only | Web + 5 channels (Gateway) | Web + OpenClaw channels |
| Architecture | Django monolith | Gateway (Node.js) + Backend (Django) | Backend (Django) only |
| New services | 0 | Gateway (~2,000 lines) | 0 |
| Container custom code | ~2,000 lines (relay) | ~960 lines (adapters + relay) | ~200 lines (event bridge) |
| Backend services | ~3,468 lines | ~3,500 lines | ~3,500 lines |
| Frontend | ~8,000 lines | ~7,000 lines | ~7,000 lines |
| Total custom LoC | ~13,500 | ~18,000-22,000 | ~10,700 |
| 3rd party runtime dep | None | None | OpenClaw (~600K LoC) |
| Container image size | ~500MB | ~500MB | ~800MB (+OpenClaw) |
| Provider agnosticism | CC only | LiteLLM Proxy | OpenClaw pi-ai + LiteLLM |
| Agent types | CC only | CC, Codex, Aider, generic | CC via OpenClaw (others via adapter interface later) |
| Secret management | tmpfs + env vars | AES-256-GCM vault + relay injection | Env vars (deferred) |
| Time to MVP | Shipped | Longest | Shortest |

**Net delta from V2 to V4:**
- Replace custom relay with event bridge: -1,800 lines + 200 lines = -1,600
- Add CLAUDE.md template system: +200 lines
- Add team coordination improvements: +300 lines
- Dashboard polish (design tokens, team views): +500 lines
- Total: ~600 fewer lines than V2, but with OpenClaw handling the heavy lifting

---

## Risks

### 1. OpenClaw coupling (HIGH)

**Risk:** OpenClaw changes API, drops features, or gets abandoned. We're stuck.

**Mitigation:** AgentRuntime interface. Event bridge normalizes everything. Backend never talks to OpenClaw directly — only through the bridge. If OpenClaw breaks, we implement DirectCCRuntime behind the same interface.

**Detection:** Pin OpenClaw version in Dockerfile. Monitor their releases. If they go 6 months without a release or make breaking API changes, begin DirectCCRuntime work.

### 2. Container size (MEDIUM)

**Risk:** OpenClaw adds ~300MB to each container. At 10+ agents, that's 3GB+ of redundant OpenClaw installations.

**Mitigation:** Docker layer caching — OpenClaw layer is shared across all containers on the same host. Only the config layer differs. For Modal, pre-bake the image.

### 3. OpenClaw features we don't need (LOW)

**Risk:** OpenClaw includes a Lit.js web UI, channel adapters, user management — things we handle ourselves. Unnecessary complexity in the container.

**Mitigation:** Configure OpenClaw in headless/API-only mode. Don't expose its UI. Only use it as a CC management layer. Most unused features are inert if not configured.

### 4. Event format stability (MEDIUM)

**Risk:** OpenClaw changes its event format between versions. Our normalize_event() breaks silently.

**Mitigation:** Type the normalized event format strictly. Add a version check at bridge startup — if OpenClaw version doesn't match expected, log a warning. The normalize_event() function has explicit fallthrough (`return None` for unknown types), so new event types don't crash, they just get dropped until we add support.

### 5. Debugging complexity (MEDIUM)

**Risk:** When something breaks, the debugging path is: dashboard → backend → bridge → OpenClaw → CC. That's 4 layers. V2 had 3 (dashboard → backend → relay → CC).

**Mitigation:** The bridge is ~200 lines with clear logging. OpenClaw has its own logging. The additional layer is thin enough that it doesn't materially increase debugging difficulty. The real debugging happens in CC (model behavior) or the dashboard (rendering), neither of which changes.

### 6. Secret management deferred (MEDIUM)

**Risk:** V4 uses env var injection for secrets (same as V2). This is the broken pattern IronClaw uses — any process in the container can read env vars.

**Mitigation:** Acceptable for beta/dogfooding where the threat model is low (we control the agents). For production multi-tenant, implement relay-based secret injection as a V5 upgrade. The AgentRuntime interface supports this — add a `request_secret()` method.

---

## Open Questions

1. **OpenClaw headless mode.** Does OpenClaw support running without its web UI? Can we configure it as purely a CC management daemon? Need to verify before committing.

2. **OpenClaw event format.** We assume OpenClaw exposes a local WS with structured events. Need to verify the exact event schema and whether it's stable/documented.

3. **Message injection.** How do we push messages INTO an OpenClaw-managed CC session? Via OpenClaw API? Direct stdin? sessions_send? The bridge needs bidirectional flow, not just event observation.

4. **OpenClaw per-container vs shared.** Could we run one OpenClaw instance managing multiple CC sessions instead of one per container? Would reduce overhead but increase blast radius.

5. **Hook interception.** Our `Task(team_name=...)` hook currently runs inside the container as a CC PreToolUse hook that POSTs to the backend. Does OpenClaw's hook system support the same pattern, or do we need to configure it differently?

6. **Cost data access.** Does OpenClaw expose per-session cost data via API? Or do we need to parse it from the event stream? The bridge needs cost data for budget enforcement.

7. **Version pinning strategy.** Pin to a specific OpenClaw release? Follow latest? Use a fork? The coupling risk makes this a critical operational decision.

---

## Immediate Next Steps

1. **Verify OpenClaw's API surface.** Install OpenClaw locally, run it, inspect the event stream format, message injection API, and headless configuration options. This validates or invalidates the entire V4 approach.

2. **Build the event bridge.** ~200 lines. Subscribe to OpenClaw's events, normalize, POST to backend. This is the only new component.

3. **Update container image.** Add OpenClaw to the Dockerfile, configure s6 services, test the full process tree.

4. **Test team coordination.** Deploy 2 agents, verify: shared filesystem works, inter-agent messaging routes correctly, task sync mirrors to dashboard.

5. **Dashboard polish.** Design token migration, team views, cost display. Carries forward regardless of runtime choice.

---

## Relationship to Other Docs

| Document | Status | Relationship to V4 |
|----------|--------|-------------------|
| `ARCHITECTURE.md` | Current (V2) | What's deployed now. V4 replaces the relay and adds OpenClaw. |
| `V2-REDESIGN.md` | Historical | V2 design decisions. Many carry forward (service isolation, Zustand, GraphQL). |
| `V3-ARCHITECTURE.md` | Superseded by V4 | The "build everything" approach. Gateway, Agent Adapter, Channels, 8 hooks, Secret vault — all superseded by OpenClaw. Remains as reference for DirectCCRuntime escape hatch. |
| `LIFT-MAP.md` | Reference | The "steal patterns" research. Becomes the implementation spec for DirectCCRuntime if OpenClaw fails. Design tokens (section 16) and execution risks still apply. |
| `DASHBOARD-UX-SPEC.md` | Active | Unchanged. The UX spec is runtime-agnostic. |
| `FOUNDATIONS.md` | Active | Product axioms and principles. Unchanged. |
