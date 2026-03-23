# Agentobox Backend Reference

> Auto-generated from codebase. Do not edit — regenerate with `make docs`.

## Modules

### app/agents/adapters/__init__.py

Adapter registry — maps agent_type strings to AgentAdapter instances.

Public API:
    get_adapter(agent_type) -> AgentAdapter
    register_adapter(agent_type, adapter) -> None

Auto-registers built-in adapters on import.

To add a new agent type:
    1. Create adapters/<name>/ package implementing AgentAdapter
    2. Import and register here: register_adapter("<name>", <Adapter>())

### app/agents/adapters/base.py

AgentAdapter Protocol — the port in Ports and Adapters.

Adapters translate between our vocabulary and agent-specific formats.
They own two responsibilities:
    1. Read path — extract display fields from agent events/snapshots
    2. Provisioning — build config files in agent-native format

Live runtime commands (set_mode, set_model) are NOT adapter concerns.
The backend sends our vocabulary to the relay; the relay translates
to SDK calls. This keeps the backend-relay protocol stable.

To add a new agent type (e.g. Codex CLI):
    1. Create adapters/codex/ with __init__.py implementing this protocol
    2. Add registries.py with MODELS_REGISTRY, MCP_REGISTRY, etc.
    3. Register in adapters/__init__.py: _REGISTRY["codex"] = CodexAdapter()
    4. Agent.agent_type routes to the right adapter at runtime.
    All services use get_adapter(agent_type) — no service changes needed.

First principles:
    - Raw events are the only source of truth
    - Adapters are pure functions over JSON — no DB access, no side effects
    - Agent-specific vocabulary (e.g. total_cost_usd, permissionMode) exists
      ONLY inside adapter method bodies
    - Everything after the adapter uses our vocabulary (cost, turns, duration)

Adapters may NOT:
    - Import from agents.models or agents.services
    - Perform database queries
    - Mutate the snapshot dict
    - Raise exceptions (return defaults for missing/malformed data)

### app/agents/adapters/claude_code/__init__.py

Claude Code adapter — translates Claude Code stream-json into our vocabulary.

Also owns provisioning config builders: settings.json, CLAUDE.md, .mcp.json,
.claude.json, relay env, and API key delivery. These are CC-specific formats —
other agent types (Gemini, Codex) would have their own adapters with different
file formats and content.

Claude Code snapshot structure:
    {
        "assistant": {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "..."},
                    {"type": "tool_use", "name": "Edit", "id": "...", "input": {...}},
                ]
            }
        },
        "result": {
            "type": "result",
            "duration_ms": 125000,
            "duration_api_ms": 80000,
            "num_turns": 7,
            "total_cost_usd": 0.045,
            "is_error": false,
            "session_id": "...",
            ...
        }
    }

Semantics:
    - New assistant event pops "result" (new turn started)
    - Result event adds "result" (turn complete)
    - live_action checks for "result" key: if present, turn is done -> empty string

### app/agents/adapters/claude_code/registries.py

Claude Code-specific registries — models, MCP servers, team templates, providers.

These are agent-type-specific data that other adapters would replace with
their own equivalents. Kept separate from the adapter class so the data
is easy to find and modify.

### app/agents/admin.py

Django admin registration for agent models.

Registers Agent with list display, filters, and search. Other models
(StreamEvent, SessionResult, etc.) are intentionally excluded — they're
high-volume append-only logs better inspected via GraphQL or shell.

### app/agents/apps.py

Django app configuration for the agents app.

### app/agents/consumers.py

WebSocket consumers: agent relay and VNC proxy.

Replaces the HTTP POST /agents/<id>/stream endpoint + piggyback pattern.
The relay connects via WebSocket and we get a persistent bidirectional channel:

    upstream (relay → backend):  raw stream-json events, one per WS message
    downstream (backend → relay): commands (input, signal, mode change)

This is deliberately a dumb pipe on the transport layer. The relay sends
every line from Claude Code's stdout verbatim — no filtering, no batching,
no transformation. The backend stores every event as a StreamEvent row.
Intelligence lives in the read path (the frontend), not here.

Why no batching: the old relay batched events in 75ms windows to amortize
HTTP overhead. WebSockets have no per-message overhead worth batching for.
Events flow at wire speed.

Why no filtering: every event type Anthropic adds to stream-json is
automatically captured. Thinking, tool progress, rate limits, deltas —
all stored without code changes. The cost is ~1KB/row in Postgres, which
is negligible compared to the value of having complete agent telemetry.

### app/agents/errors.py

Standardized error taxonomy for the agentobox platform.

Every ``except Exception`` block in the codebase must reference an error code
from this module. Codes follow the format ``ERR-<DOMAIN>-<DESCRIPTION>``.

Architecture check ``check_broad_except_has_error_metadata`` enforces that
every broad except in backend/agents/services/ logs with an ``error_code``.

### app/agents/graphql/auth.py

GraphQL authorization helpers for Strawberry resolvers.

Extracts the authenticated user from Strawberry's info context and verifies
project/agent ownership. Two auth paths in priority order:
1. HTTP request.user (TokenAuthMiddleware — Bearer/ApiKey header)
2. WS scope["user"] (AuthMiddlewareStack — session cookies, used by relay/VNC)

Every mutation/query that touches project-scoped data must call
authorize_project or authorize_agent before proceeding. These raise
PermissionError on failure — Strawberry converts that to a GraphQL error.

### app/agents/graphql/mutations.py

GraphQL mutations for agent lifecycle, communication, and configuration.

All mutations require Bearer auth — authorize_project or authorize_agent
checks ownership before any state change. Mutations delegate to service
functions (lifecycle.py, relay.py, feed.py) for the actual work; this
module is the thin GraphQL boundary that handles input parsing, auth,
and response shaping.

Key mutation groups:
- Lifecycle: createAgent, killAgent, removeAgent, hardRestartAgent
- Communication: sendMessage, answerQuestion, interruptAgent, clearAgentSession
- Permissions/Plans: resolvePermission, resolvePlan
- Config: setAgentMode, updateAgentInstructions, updateAgentConfig
- Tasks: createTask, updateTask
- Skills: createSkill, updateSkill, deleteSkill
- Secrets: setSecret, deleteSecret, scopeSecret

### app/agents/graphql/queries.py

Queries: agents, feed, and metadata.

Two feed layers:
    teamFeed    → curated TeamFeedItems for the dashboard (materialized view)
    agentFeed   → raw StreamEvent log for agent detail view (event store)
    projectFeed → raw StreamEvent log for project-wide view (event store)

### app/agents/graphql/types.py

Strawberry GraphQL type definitions for the agents app.

Maps Django models to GraphQL types consumed by the dashboard. AgentType is
the main shape — Strawberry auto-converts snake_case fields to camelCase
(lifecycle_status → lifecycleStatus). Derived fields (lastOutput, liveAction,
cost, duration, turns) delegate to the agent's adapter so the GraphQL layer
stays agent-type-agnostic.

TeamFeedItemType is a flat union matching the frontend's discriminated union —
every field present on every row, null where inapplicable. This avoids
GraphQL union/interface complexity for a feed that the frontend already
handles as a flat discriminated type.

TimelineEntryType wraps raw StreamEvent rows for queries and subscriptions.
The data field is the raw event dict — the frontend decides what to render.

### app/agents/management/commands/ensure_smoke_user.py

Ensure a smoke test user exists for CI.

Usage:
    uv run python manage.py ensure_smoke_user --username demo --password demo

Creates the user if missing, always sets the password. No other data
is created — this is not seed_dev_data. For CI smoke tests only.

### app/agents/management/commands/generate_reference.py

Generate docs/REFERENCE.md from codebase docstrings and annotations.

Walks backend/agents/**/*.py and agent/{runtime,transports}/**/*.py, extracts
module docstrings, test class docstrings (as principles), # intentional:
annotations, and # tech-debt: annotations. Renders a single markdown file
for LLM consumption.

Usage:
    docker compose exec backend uv run python manage.py generate_reference

### app/agents/management/commands/run_triggers.py

Mechanical trigger loop -- evaluates cron triggers and wakes agents.

Local dev: `manage.py run_triggers` (runs once by default)
           `manage.py run_triggers --loop` (continuous, 60s between checks)
Production: Modal cron calls the same evaluate_triggers() function.

Only evaluates agents with status=idle and cron triggers. Sends a message
with source="trigger" metadata so the feed can filter it out.

### app/agents/management/commands/seed_dev_data.py

Seed development data matching the frontend mock data.

Usage:
    docker compose exec backend uv run python manage.py seed_dev_data

Creates:
    - 1 project (owned by test user 'vahid')
    - 7 agents with varied statuses, modes, attention levels, tags, snapshots
    - ~25 TeamFeedItems covering all types
    - 4 ProjectSecrets

### app/agents/models.py

Domain models for the agents app.

Defines the core entities: Agent, StreamEvent, SessionResult, TeamFeedItem,
AgentTask, ProjectSecret, Skill, AgentFeedback. Agent is the central record
tracking a single Claude Code container — its runtime, configuration, session
state, and materialized view fields. StreamEvent is the append-only event log
(INSERT only, never UPDATE) that captures every relay event verbatim.
TeamFeedItem is the curated dashboard feed — a flat union where every row has
all fields, nulled where inapplicable, matching the frontend's discriminated
union type.

Key design decisions:
- Agent config (model, mode, mcp_servers, allowed_tools) is written to the
  shared volume at provisioning time. The relay reads config from volume
  files, not DB fields. DB fields are kept for GraphQL queries and as the
  source of truth for what SHOULD be on the volume.
- SessionResult is INSERT-per-turn (not upserted) so we get a full cost
  timeline, not just latest values.
- config_snapshot captures creation-time config so hard_restart can
  reprovision identically without re-resolving defaults.

### app/agents/runtimes/__init__.py

Runtime registry — maps runtime names to Runtime protocol implementations.

get_runtime("docker") returns DockerRuntime, get_runtime("modal") returns
ModalRuntime. Instances are cached after first creation. Imports are lazy
(inside the match arms) to avoid pulling in docker-py or modal SDK when
only one runtime is used.

### app/agents/runtimes/base.py

Runtime Protocol — the port in Ports and Adapters for container orchestration.

Defines the async interface that all runtimes (Docker, Modal) must implement:
create, exec, write_file, terminate, list_sandboxes, get_status, get_crash_info.
SandboxInstance and VolumeMount are the runtime-agnostic data types that cross
the boundary.

Services never import DockerRuntime or ModalRuntime directly — they call
get_runtime(name) from __init__.py and program against this Protocol. Adding
a new runtime (e.g. Fly.io) means implementing this interface and registering
it in __init__.py; no service code changes.

### app/agents/runtimes/docker.py

Docker runtime — local container orchestration via docker-py.

Implements the Runtime protocol for local development. Containers run on
the host Docker daemon, connected to the shared agentobox_default network
so the backend can reach them by container name DNS (same pattern as
Guacamole/Kasm).

All docker-py calls are blocking, so every method wraps the sync call in
run_in_executor(None, ...) to avoid blocking the async event loop. Resource
limits (4GB RAM, 2 CPU cores, 500 PIDs) prevent fork bombs and runaway
processes.

VNC URLs use container name DNS (http://<container-name>:6080) — resolved
by the backend's VncProxyConsumer, never by the browser directly.

### app/agents/runtimes/modal.py

Modal runtime — serverless container orchestration via Modal Python SDK.

Implements the Runtime protocol for production deployments. Each agent gets
a Modal Sandbox with the agent image pulled from GHCR (authenticated via
ghcr-secret). Volumes use modal.Volume.from_name() with create_if_missing.
VNC is exposed via Modal's encrypted tunnel on port 6080.

Modal Sandbox.create is natively async (.aio suffix), so no executor
wrapping needed unlike DockerRuntime.

### app/agents/schemas.py

Typed internal DTOs for JSONField shapes we own.

These are the shapes WE define and control — NOT raw provider events
(StreamEvent.data, latest_snapshot) which stay raw at the adapter boundary.

Each DTO validates on construction: required fields raise on absence,
optional fields have explicit defaults. Consumed via from_dict() which
parses dicts from JSONField columns.

### app/agents/serializers.py

Canonical serialization for Agent and TeamFeedItem.

Both GraphQL resolvers and WS consumers derive from these views.
This is the single source of truth for field computation — no transport
layer should duplicate task counting, lifecycle fetching, or adapter calls.

WS consumers add transport markers (_t, __typename) on top of these dicts.
GraphQL types delegate computed fields to shared helpers here.

### app/agents/services/auth_relay.py

Relay token authentication -- single implementation for all entry points.

### app/agents/services/broadcast.py

Broadcast agent updates via status events, feed items, and dashboard WebSocket.

    broadcast_agent_update(agent) — detects status changes, creates StreamEvents
    and feed items, and pushes full agent state to the dashboard WebSocket group.

Status change detection works via Agent.from_db() setting _original_status.
Dashboard WS push runs on every call (not just status changes) to cover
phase, attention, snapshot, and other state updates.

### app/agents/services/callbacks.py

Handle SDK callback requests from the relay.

When the SDK fires a callback (can_use_tool, future hooks), the relay
forwards it as a {type: "callback"} event. We create a TeamFeedItem
for the dashboard and let the existing resolve mutation flow handle
the response back to the relay.

The callback_type field is data, not code — adding a new callback type
means adding a handler function here and a renderer in the dashboard.
No transport changes needed.

### app/agents/services/feed.py

TeamFeedItem creation and attention management.

This is the materialized view layer. StreamEvent = raw audit log.
TeamFeedItem = curated dashboard feed items created when feed-worthy events occur.

### app/agents/services/interagent.py

Inter-agent message delivery through the Agentobox backend.

Messages are delivered to target agents via the same durable inbox path
used for user input. The MCP coordination server's teammate_message and
teammate_broadcast tools call into this module directly.

Flow:
    1. Agent calls teammate_message MCP tool
    2. deliver_to_stdin() formats message as stream-json input
    3. StreamEvent created for feed visibility
    4. Input appended to target inbox.jsonl
    5. Relay gets a reload and consumes the inbox

### app/agents/services/lifecycle.py

Agent lifecycle management: create, kill, remove, hard-restart.

Orchestrates the full agent lifecycle from DB record creation through
container provisioning to teardown. create_agent creates the Agent row
immediately (so the dashboard sees it) then spawns _provision_agent as
a monitored background task for the slow container work.

Key invariants:
- _provision_agent runs detached from the HTTP request — all DB writes
  use sync_to_async(thread_sensitive=False) to avoid the dead
  CurrentThreadExecutor problem.
- hard_restart uses select_for_update()+transaction.atomic() to prevent
  concurrent restarts from orphaning containers.
- config_snapshot preserves creation-time config so restarts reprovision
  identically. session_id is captured for --resume context preservation.
- resolve_agent_secrets applies project-level secret scoping: a secret
  goes to an agent if it has no scoped_agents (default-all) or the agent
  is in its scoped set.

Container provisioning sequence:
    create container → symlink .claude to volume → write secrets →
    provision_workspace → write .relay_env → save relay_token →
    relay self-starts (polls for .relay_env) → spawn tmux log tail

### app/agents/services/mcp_coord.py

MCP Coordination Server for agent-to-agent communication.

Tool names and parameter shapes align with Claude Code's native team tools
(SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList). Transport differs
(MCP HTTP → backend routing instead of filesystem), but the interface is
identical so models trained on CC's native schemas work out of the box.

Auth: Each tool call authenticates by extracting the Bearer token from
the Authorization header and looking up the Agent by relay_token.

See: docs/ARCHITECTURE.md, "MCP Coordination Server"

### app/agents/services/mcp_registry.py

Proxy client for the official MCP server registry at registry.modelcontextprotocol.io.

Provides search_registry() which forwards search queries to the upstream
registry API and returns the response. Used by the GraphQL searchMcpRegistry
query so the dashboard can browse available MCP servers without a direct
browser-to-registry connection (avoids CORS and keeps the registry URL
server-side).

### app/agents/services/media.py

S3 media externalization for base64 image content blocks.

Uploads base64-encoded images to S3 (LocalStack in dev, DigitalOcean Spaces in prod)
and returns a public URL. Used by stream.py to swap inline base64 data with URLs
before storing Messages in the database.

### app/agents/services/provision.py

Workspace provisioning — write config files to the agent volume.

Called during _provision_agent (lifecycle.py) after the container is created.
Writes to the shared volume via Volume.write() — no runtime.exec() or
runtime.write_file() needed for config state. The init-volume oneshot
creates symlinks so the container sees these files at their canonical paths.

    1. Instruction file — adapter-determined content (CLAUDE.md)
    2. Settings file — adapter-determined format
    3. MCP config — .mcp.json, skipped if empty
    4. Onboarding state — .claude.json, skipped if empty
    5. Skills — project skills matching agent tags
    6. MCP Gateway config — commands + ports, no secrets
    7. Per-MCP scoped secrets — /run/secrets/mcp-{name}/{KEY}

Security hardening (API key files, scoped sudo) still uses runtime.exec()
because those operate on system paths (/opt/abox/, /etc/sudoers.d/) that
are not on the volume.

Volume path convention (Mirror, Don't Map):
    Volume paths mirror container filesystem paths exactly. A file at
    vol.write("home/agent/.claude/settings.json", ...) appears at
    /home/agent/.claude/settings.json inside the container via symlink.

### app/agents/services/reconcile.py

Background reconciliation loop for agents.

Detects orphaned containers, dead containers, and stuck deploys — then
cleans up. Runs inside the backend process (no extra services).

With the WebSocket relay, heartbeat-based staleness detection is replaced
by WS disconnect events. This loop handles cases where containers die
without a clean disconnect.

NOTE: This runs inside asyncio.create_task() where Django's
CurrentThreadExecutor is unavailable. All ORM calls MUST use
@sync_to_async(thread_sensitive=False) — never async ORM (asave, async for).

### app/agents/services/relay.py

Agent communication: send messages, signals, and mode changes.

Commands are delivered to agents via two paths:

    1. State changes: write to volume → WS reload {"type": "reload", "path": "..."}
       Relay reads the file, applies it, updates status.json.

    2. Ephemeral signals: WS push {"type": "signal", "action": "interrupt|restart|clear"}
       No state — just a control signal. Relay acts immediately.

Messages to agents go through the inbox (volume + reload). Signals
(interrupt, restart, clear) go directly over WS since they're ephemeral
control signals, not state.

### app/agents/services/relay_commands.py

Typed command builders for the backend → agent relay protocol.

Every command the backend sends to an agent relay MUST go through one of
these builders. Raw dicts at the relay boundary are an architectural
violation — they drift silently when the agent protocol changes.

The wire format mirrors agent/transports/agentobox/commands.py exactly.
If the agent protocol changes, update these types and the serializer.
Contract tests (test_relay.py) assert exact wire payloads.

### app/agents/services/runtime_segments.py

Runtime compute segment ledger helpers.

### app/agents/services/secrets.py

Fernet-based encryption for project secrets.

Secrets are stored as individually Fernet-encrypted values in the database.
Decrypted only during agent provisioning (to inject into MCP env blocks
or write to tmpfs).

The encryption key is read from app_config.encryption_key. If not set,
secret creation raises an error rather than silently falling back.

Usage:
    from agents.services.secrets import encrypt_value, decrypt_value

    encrypted = encrypt_value("sk-ant-...")
    plaintext = decrypt_value(encrypted)  # -> "sk-ant-..."

### app/agents/services/stream.py

Process agent events into the append-only StreamEvent log.

Write path: normalize → store → broadcast → side effects.

    1. Normalize: adapter.normalize(raw_event, state) → 0+ CC-format events
       - CC adapter: identity (returns [event])
       - OC adapter: stateful synthesis (accumulates deltas, emits at turn boundaries)
    2. Store each CC event as a StreamEvent row (INSERT, never UPDATE)
    3. Broadcast to dashboard subscribers
    4. Update materialized fields on the Agent model (status, phase, cost, etc.)

No upserts. No row locks. No content part accumulation. No dual-table routing.
Each CC event from normalize() is one INSERT.

Intelligence lives in the read path (the frontend) which reconstructs
logical messages by grouping StreamEvents by message_id.

### app/agents/services/themes.py

Canonical built-in theme registry and runtime theme document helpers.

The source of truth for built-in themes lives in `shared/themes/builtins.json`.
Backend, dashboard, and agent runtime all adapt from that one manifest instead
of carrying separate hard-coded preset registries.

### app/agents/services/utils.py

Shared service utilities -- thin helpers for repeated patterns.

### app/agents/services/volume.py

Volume-based state management for agent containers.

Replaces the three separate sync paths (provision-time file writes, live
WebSocket push, theme-specialized WS handling) with one: filesystem on a
shared volume. Backend writes files, sends a WS reload command. Relay
reads the file and reloads the relevant process.

## Storage hierarchy

    VOLUME_ROOT/                          # e.g. /volumes/ (Docker named volume)
      agents/
        {agent_id}/                       # per-agent isolation boundary
          home/agent/                     # mirrors /home/agent/ in container
            .claude/
              settings.json               # CC settings (mode, model, api_key placeholder)
            .relay_env                    # relay process env vars
            workspace/
              CLAUDE.md                   # project-level instructions
              .claude/.claude.json        # onboarding state
              .mcp.json                   # MCP config
          tmp/abox-theme/                 # mirrors /tmp/abox-theme/
            tokens.json                   # source: backend writes CSS tokens
            theme.css                     # derived: converter writes
            awesome.lua                   # derived: converter writes
            theme.json                    # derived: reference copy
          run/                            # mirrors /run/
            secrets/
              proxy_key                   # API proxy key (0600)
              mcp-{name}/{KEY}            # per-MCP scoped secrets
          mnt/abox-state/                 # mirrors /mnt/abox-state/
            secrets/env                   # shell-sourceable secrets export
          _abox/                          # control plane (NOT mirrored into container)
            state.json                    # {model, mode, allowed_tools}
            status.json                   # runtime status document (agent-owned projection)
            inbox.jsonl                   # messages to agent (backend appends)
            inbox.cursor.json             # durable runtime-owned inbox cursor
            provisioned.ready             # managed bootstrap release sentinel

## From agent perspective (inside container)

    Boot oneshot (init-volume) creates symlinks before any service starts.
    AGENT_ID env var selects the agent's subdir within the shared volume:

        /home/agent/.claude       → /vol/agents/$AGENT_ID/home/agent/.claude
        /home/agent/.relay_env    → /vol/agents/$AGENT_ID/home/agent/.relay_env
        /home/agent/CLAUDE.md     → /vol/agents/$AGENT_ID/home/agent/CLAUDE.md
        /home/agent/.mcp.json     → /vol/agents/$AGENT_ID/home/agent/.mcp.json
        /workspace                → /vol/agents/$AGENT_ID/workspace
        /tmp/abox-theme           → /vol/agents/$AGENT_ID/tmp/abox-theme
        /run/secrets              → /vol/agents/$AGENT_ID/run/secrets
        /mnt/abox-state           → /vol/agents/$AGENT_ID/mnt/abox-state

    The agent sees a normal filesystem. It doesn't know about the volume.
    Backend writes are immediately visible because they're the same files.

## Runtime status

    _abox/status.json remains an agent-owned machine artifact written by the
    runtime. Backend-visible runtime truth is consumed from the control-plane
    projection published by the runtime over relay.

## Delivery guarantee

    Backend appends to inbox.jsonl and sends a reload. The runtime tracks its
    durable read position in _abox/inbox.cursor.json, so unread messages
    survive relay crashes without a backend-visible delivery cursor.

## What's NOT on the volume

    - /workspace (project-shared mount; when bind-mounted from host it is not
      agent-private volume authority)
    - /etc/sudoers.d/ (system file, still written via runtime.exec)
    - /opt/abox/ (image-baked scripts, not agent state)

### app/agents/tests/check_architecture.py

Fast architecture checks — no Django, no DB, no pytest.

Runs as a standalone script for pre-commit hooks. Parses source files
as AST and checks import boundaries, naming conventions, and resolver
discipline. Exits 0 on pass, 1 on failure with details.

Usage:
    python backend/agents/tests/check_architecture.py

### app/agents/tests/conftest.py

Shared test fixtures for agents tests.

### app/agents/tests/test_adapter_cc.py

Claude Code adapter tests — extraction, provisioning, real event parity.

Tests verify:
    1. Extraction correctness — display fields from CC snapshots
    2. Seed data parity — seed_dev_data snapshots match real CC event structure
    3. Real event parity — adapter handles actual CC v2.1.59 stream-json events
    4. Provisioning — config builders produce valid settings.json, CLAUDE.md

### app/agents/tests/test_adapters.py

Shared adapter contract tests — registry, protocol compliance, graceful handling.

Tests that apply to ALL registered adapters live here. Agent-type-specific
tests live in test_adapter_cc.py (Claude Code).

### app/agents/tests/test_architecture.py

Architectural enforcement tests.

These tests catch drift mechanically — import boundaries, naming conventions,
and model field discipline. They read source files as text and check patterns.
No Django ORM needed (except schema contract test which needs Strawberry).

### app/agents/tests/test_auth.py

Tests for agents.graphql.auth authorization helpers.

### app/agents/tests/test_lifecycle.py

Tests for lifecycle state machine and shell escape utility.

Covers:
- Agent lifecycle state machine (VALID_TRANSITIONS, transition_agent_status)
- _shell_escape delegates to shlex.quote(), which wraps values in single
  quotes and handles all shell metacharacters.

### app/agents/tests/test_mcp_coord.py

Contract tests for MCP coordination tools — CC native schema parity.

Verifies that our MCP tools match Claude Code's native team tool schemas
(SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList) in parameter names
and return shapes.

Tests call the tool functions directly with mocked auth to avoid needing
a full MCP server roundtrip.

NOTE: mcp_coord.py uses lazy imports inside functions (to avoid circular
imports), so we patch at the source module (agents.models) not at the
consumer (agents.services.mcp_coord).

### app/agents/tests/test_reconcile.py

Tests for agents.services.reconcile — stuck deploy detection + orphan reaping.

Covers:
- Two-tier timeout logic in _detect_stuck_deploys
- Orphan reaper container matching (sandbox_id + agent.id label)

### app/agents/tests/test_relay.py

Tests for agents.services.relay — content normalization, inbox durability, and wire payloads.

### app/agents/tests/test_resolvers.py

Tests for GraphQL resolver adapter delegation.

Verifies that display field resolvers read from latest_snapshot via adapter,
not from stale model columns.

### app/agents/tests/test_schemas.py

Tests for typed internal DTOs (agents.schemas).

### app/agents/tests/test_stream.py

Tests for stream.py snapshot writes and phase logic.

### app/agents/tests/test_theme_delivery.py

Functional test: change theme → tokens.json on agent volume has new tokens.

This is the test that catches the actual bug: user changes the theme via
the set_project_theme mutation, but the agent container never sees it.

The bug was: mutations.py had a stale _push_theme_for_project() that sent
old {"type": "theme"} WS payloads. The relay only handles {"type": "reload"},
so the theme silently never updated. This test would have caught it because
it checks the ACTUAL FILE on the volume, not the WS message.

Tests:
1. push_theme_to_agents writes tokens.json to every running agent's volume
2. If the function is broken/stale, tokens.json is missing or has wrong content
3. The mutation calls the correct function (not a stale inline one)

### app/agents/tests/test_volume_architecture.py

Volume architecture invariant tests.

Verifies that the volume-based state system maintains its design contracts:
- Atomic writes (no partial reads)
- Mirror, Don't Map (volume paths = container paths)
- Canonical control-plane boot files only
- No orphan state (relay.py only sends reload commands + signals, never raw state)

These are structural tests — they exercise the Volume class directly against
a tmp_path filesystem. No Django ORM, no containers, no network.

### app/agents/views.py

REST endpoints: file uploads and the hook bridge for CC native team tools.

Two concerns live here:

1. File uploads — upload_file (push a file into an agent container) and
   upload_media (upload an image to S3, return public URL). Both require
   Bearer auth and validate ownership.

2. Hook bridge — POST endpoint that CC PreToolUse/PostToolUse hooks call
   with {tool_name, tool_input}. Auth is Bearer relay_token → Agent lookup.
   Read-only tools (TaskList, TaskGet) run as PreToolUse (before CC executes
   the native tool). Mutating tools (SendMessage, TaskCreate, TaskUpdate) run
   as PostToolUse (after CC's native tool, so the hook result arrives as a
   systemMessage). Handlers are lazy-loaded to avoid circular imports.

CC uses camelCase param names; _cc_to_snake() normalizes to Python convention.
Handler dispatch filters params to only those the handler signature accepts,
so adding new CC fields won't break existing handlers.

## Test Principles

### test_adapter_cc.py — TestClaudeCodeExtraction

Principle: adapter extraction is a pure function of the snapshot.

Given a latest_snapshot dict, the adapter returns display fields (last_output,
live_action, cost, duration, turns) deterministically. No DB access, no side
effects, no mutation of the input.

### test_adapter_cc.py — TestSeedDataParity

Verify seed_dev_data snapshots produce correct adapter output.

This is the contract test: if seed snapshot structure drifts from what
the adapter expects (or vice versa), these tests catch it.

### test_adapter_cc.py — TestRealEventParity

Verify adapter handles actual Claude Code v2.1.59 stream-json events.

Fixtures in tests/fixtures/ are sanitized captures from real CC sessions
(solo, tool use, plan mode, team mode). These tests prove our adapter
can extract display fields from events with the FULL real structure,
not just simplified test snapshots.

### test_adapter_cc.py — TestBuildSettings

Verify ClaudeCodeAdapter.build_settings produces correct settings.json.

### test_adapter_cc.py — TestBuildInstructions

Verify ClaudeCodeAdapter.build_instructions produces correct CLAUDE.md.

### test_adapter_cc.py — TestBuildApiKeyFiles

Verify build_api_key_files produces correct file specs per auth path.

### test_adapter_cc.py — TestBuildOnboardingState

Verify build_onboarding_state pre-approves the placeholder key.

### test_adapter_cc.py — TestBuildRelayEnv

Verify build_relay_env uses proxy placeholder and sets ANTHROPIC_BASE_URL.

### test_adapter_cc.py — TestBuildMcpConfig

Verify build_mcp_config handles all config shapes without crashing.

Bug: custom MCP servers passed as dicts (via mcp_custom_servers) may lack
a 'port' key. build_mcp_config did config['port'] → KeyError crash.
This killed the qa agent during provisioning.

### test_adapter_cc.py — TestBuildGatewayConfig

Verify build_gateway_config handles missing fields.

### test_adapters.py — TestRegistry

Principle: the adapter registry is the single lookup point for agent types.

get_adapter(type) returns a cached adapter instance. Unknown types raise
ValueError immediately — no silent fallback to a default adapter.

### test_adapters.py — TestProtocolCompliance

Principle: every registered adapter must satisfy the AgentAdapter protocol.

Runtime isinstance() check ensures all protocol methods exist with correct
signatures. If a new method is added to AgentAdapter, every adapter must
implement it or this test fails.

### test_adapters.py — TestGracefulHandling

Every registered adapter must handle degenerate input without crashing.

### test_architecture.py — TestImportBoundaries

Principle: layer boundaries are enforced by import direction.

Adapters must not import models or services — they're pure functions of
dict input. The stream write path must not import adapters at module level
to stay agent-type-agnostic. Resolvers must use adapters, not raw JSON.

### test_architecture.py — TestNamingConventions

Principle: public API names are self-documenting via verb_entity pattern.

Service functions and mutations follow naming conventions that make the
codebase navigable without reading implementations. Service functions
start with a verb, mutations are verb_entity.

### test_architecture.py — TestModelDiscipline

Principle: Agent model holds state, not presentation.

Display-only fields (last_output, live_action, etc.) belong in adapters,
not on the model. Agent-type-specific vocabulary (Claude Code field names)
must not leak into the Agent model — we use our own vocabulary.

### test_architecture.py — TestVocabularyEnforcement

Catch deprecated terminology before it takes root.

### test_architecture.py — TestAdapterPurity

Adapter read methods must not silently truncate or modify content.

### test_architecture.py — TestObservationLoop

Every state mutation must complete the observation loop.

If the backend changes agent/task/feed state but doesn't broadcast,
the dashboard lies. These tests scan mutation handlers for .asave()
and .acreate() calls and verify a corresponding broadcast call exists
in the same function body.

### test_architecture.py — TestSchemaContract

The checked-in schema.graphql must match what the backend actually serves.

If someone changes a Python type but forgets `make schema`, the frontend
builds against a stale contract. This test catches that drift.

### test_architecture.py — TestCrossBoundaryContracts

The hook bridge and backend must agree on tool names.

The hook bridge (team-bridge.py) intercepts CC native tool calls by name.
The backend (views.py) maps those names to handler functions. If either
side drifts, tools silently stop working — no error, no log, just broken.

### test_architecture.py — TestLogEventNames

Principle: log event names are grep handles, not prose.

Every structlog event name must follow the ``domain.action`` taxonomy:
- Format: ``^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,2}$``
- First segment must be a registered domain in ``_VALID_DOMAINS``
- Vague single-word names are banned

Uses AST parsing to extract literal string event names from log calls.
f-strings and variable references are skipped (they have dynamic parts).

### test_architecture.py — TestExplicitErrorHandling

Principle: Fail loud, never fail silent.

Every broad except (Exception/BaseException/bare) must be annotated with
``# intentional:`` explaining why the broad catch is necessary. Unannotated
blocks are likely silent-failure bugs. This test catches them mechanically.

### test_architecture.py — TestTechDebtAnnotations

Principle: Track technical debt explicitly, not in comments or memory.

Every ``# tech-debt:`` annotation must include a non-empty explanation
describing what the debt is and when/how it can be removed. Bare tags
without explanations are worse than no tag — they signal debt exists but
give no context for resolving it.

This test walks ALL Python files in both backend/agents/ and agent/rootfs/
to ensure tech-debt annotations are well-formed wherever they appear.

### test_architecture.py — TestSyncToAsyncExplicit

Every sync_to_async() call must specify thread_sensitive explicitly.

The default thread_sensitive=True routes work to a single shared thread,
which silently serializes all callers. Non-Django-ORM blocking I/O (S3
uploads, HTTP fetches, cache calls) MUST use thread_sensitive=False.

By requiring the kwarg everywhere, authors are forced to think about
which thread pool the work runs on, preventing accidental serialization.

### test_architecture.py — TestWsSerializerMatchesGraphQL

The canonical serializer must mirror the GraphQL AgentType exactly.

When a field is added to AgentType but not serialize_agent(),
Apollo throws cache miss errors because the WS push is missing keys
that the cache schema expects. This test catches that drift at CI time
instead of waiting for a runtime console error.

Extracts camelCase field keys from both sources via AST and string
analysis, then asserts they match.

### test_architecture.py — TestDependencyCompatibilityMatrix

Verify Dockerfile version pins match COMPATIBILITY.json.

The compatibility matrix is the source of truth for known-good
CLI + SDK + proxy version combinations. If someone bumps a version
in the Dockerfile without updating the matrix (or vice versa),
the relay startup check will reject the combination at runtime.

### test_architecture.py — TestConfigOwnership

Principle: settings.py owns Django, app_config owns product/runtime policy.

### test_architecture.py — TestRuntimeOwnership

Principle: runtime_name must be explicit, never silently defaulted.

### test_architecture.py — TestSerializationOwnership

Principle: serialization lives in serializers.py, not consumers.py.

### test_architecture.py — TestNoStaleSettingsRefs

Principle: after config migration, no service/runtime/graphql file should
reference django.conf.settings for policy vars.

models.py and migrations are exempt — they use settings.AUTH_USER_MODEL
which is a Django framework concern.

### test_architecture.py — TestS6ServicePreflight

Principle: every s6 service must validate config before starting.

All longrun service run scripts must source the preflight helper and
call preflight with --service. This ensures structured JSON logging
on missing config and immediate clean exit (no crash-loop noise).

### test_architecture.py — TestRuntimeValidation

Principle: fail loud on startup, not on first request.

### test_lifecycle.py — TestValidTransitionsComplete

test_inv_life_003_valid_transitions_are_complete

### test_lifecycle.py — TestIllegalTransitionRaises

test_inv_life_003_illegal_transition_raises

### test_lifecycle.py — TestLegalTransitionSucceeds

test_inv_life_003_legal_transition_succeeds

### test_lifecycle.py — TestForceTransition

Force flag bypasses validation for recovery paths.

### test_lifecycle.py — TestNoDirectStatusWrites

test_inv_arch_001_no_direct_status_writes

Architecture check: no service file outside lifecycle.py directly writes
agent.status = AgentStatus.X — all must use transition_agent_status().

### test_lifecycle.py — TestDesiredStatusEnum

Enum values are part of the wire/DB contract. Never rename.

### test_lifecycle.py — TestConvergence

is_converged / needs_reconcile reflect desired vs reported state.

### test_mcp_coord.py — TestSchemaParity

Verify our tool parameter names match Claude Code's native schemas.

### test_mcp_coord.py — TestSendMessage

Principle: message delivery must reach the target relay or fail visibly.

send_message resolves the recipient by name within the sender's project,
formats the payload for the agent's protocol, and pushes it to the relay
channel group. Delivery failures surface as exceptions, never silent drops.

### test_mcp_coord.py — TestTaskCreate

Principle: task creation is atomic — DB row + feed item + broadcast.

A created task must be immediately visible in the dashboard. The MCP tool
returns the task dict on success and surfaces errors on failure.

### test_mcp_coord.py — TestTaskUpdate

Principle: task updates are idempotent and broadcast-complete.

Every field update (status, assignee, dependencies) persists to DB and
triggers a broadcast so the dashboard reflects the change. Deleting
a task sets status=deleted and removes it from active views.

### test_mcp_coord.py — TestTaskGet

Principle: task reads return the full task state including dependencies.

task_get returns the complete task dict (title, description, status,
assignee, blocks, blockedBy) so the agent has full context to act on it.

### test_mcp_coord.py — TestTaskList

Principle: task list returns a summary view scoped to the project.

Returns all non-deleted tasks with enough fields for triage (id, title,
status, assignee, blockedBy) but not full descriptions — use task_get for that.

### test_reconcile.py — TestDetectStuckDeploys

Unit tests for the reconciler's stuck-deploy liveness probe.

### test_reconcile.py — TestReapOrphans

Unit tests for orphan reaper — verifies sandbox_id + agent.id label matching.

The TOCTOU race: agent is DEPLOYING with sandbox_id="" (container exists
but sandbox_id not yet written to DB). Without the agent.id label check,
the orphan reaper would kill the container because its ID doesn't match
any active_sandbox_ids (which contains "" for the deploying agent).

These tests mock the data into the vulnerable state and verify the reaper
handles it correctly — no actual concurrency needed.

### test_reconcile.py — TestErrorReapDebugMode

Failure-injection coverage for errored-agent cleanup behavior.

### test_resolvers.py — TestResolverAdapterDelegation

Principle: GraphQL resolvers must delegate to adapters, never access raw JSON.

Display fields (lastOutput, liveAction, cost, duration, turns) are derived
from latest_snapshot by the agent's adapter. Resolvers call get_adapter()
and pass the snapshot — they never parse stream-json directly. This keeps
the GraphQL layer agent-type-agnostic.

### test_stream.py — TestSnapshotWrites

Principle: latest_snapshot is a faithful mirror of the last event pair.

assistant events replace the assistant key and clear result;
result events add the result key alongside the existing assistant.
No other fields are modified. The snapshot is the sole input to adapters.

### test_stream.py — TestPhaseLogic

Principle: phase transitions derive from stream events, not guesswork.

The phase field (thinking, responding, tool_input, tool_use, idle) is set
by stream_event subtypes, not by the LLM output content. result events
reset phase to idle. Phase is a materialized field on Agent for dashboard
display — it must never contradict the event log.

### test_stream.py — TestMessageInterception

Principle: CC native SendMessage doesnt fire PostToolUse hooks.

The stream processor intercepts SendMessage tool_use blocks in assistant
events for logging only. Feed items are created by mcp_coord.py when the
MCP tool executes — the stream interceptor must NOT create duplicate items.

### test_volume_architecture.py — TestVolumeCompleteness

Agent can boot from volume alone, zero runtime.exec() calls.

### test_volume_architecture.py — TestAtomicWrite

Writes are atomic — .tmp then rename, no partial reads.

### test_volume_architecture.py — TestMirrorDontMap

Volume paths match container filesystem paths exactly.

### test_volume_architecture.py — TestSecretsAndMcpHelpers

Secrets/MCP machine paths should be explicit helpers, not raw strings everywhere.

### test_volume_architecture.py — TestInbox

Inbox persists canonical task messages only.

### test_volume_architecture.py — TestNoOrphanState

Backend relay module never pushes raw state over WS — only typed commands.

### test_volume_architecture.py — TestProvisionUsesVolume

provision.py writes to Volume, not runtime (except scoped sudo).

### test_volume_architecture.py — TestConsumerSimplicity

consumers.py has no backfill logic or theme push on connect.

### test_volume_architecture.py — TestNoPushToRelayDataPayloads

push_to_relay must ONLY carry typed commands — never data payloads.

The volume architecture routes all state through files. WS messages are
typed notifications (reload = file changed, signal = ephemeral control).
Any push_to_relay call with type "theme", "mode", "skill", or "input"
is a stale pre-volume code path that bypasses the volume and will be
silently dropped by the relay.

This test greps ALL Python files in the project (not just services/)
to catch stale callers in mutations, management commands, etc.

### test_volume_architecture.py — TestPathParity

SYMLINKED_PREFIXES in volume.py matches init-volume's actual symlinks.

init-volume creates symlinks for specific directories. The Python
SYMLINKED_PREFIXES constant gates Volume.write() to only allow paths
under those directories. If they drift, either:
- Python allows a path init-volume doesn't symlink (invisible file)
- init-volume symlinks a dir Python doesn't allow (write rejected)

This test parses the bash script and extracts the dirs it covers,
then verifies the Python constant matches.

### test_volume_architecture.py — TestProvisioningGate

Boot readiness must wait for explicit provisioning completion.

### test_volume_architecture.py — TestMutationBoundary

Mutations that push state to agents must go through relay.py — not DIY.

Bug: set_project_theme in projects/graphql/mutations.py had its own
_push_theme_for_project() that sent old {"type": "theme"} WS payloads.
The relay only handles {"type": "reload"}, so the theme never updated.
This test ensures no mutation file has inline push_to_relay or
channel_layer.group_send calls that bypass relay.py.

Exception: update_agent_instructions in agents/graphql/mutations.py uses
push_to_relay for live CLAUDE.md updates via the canonical volume path.
This is acceptable because it goes through Volume.mutate() + push_to_relay.

### test_volume_architecture.py — TestMachineBoundary

App-layer code should speak in terms of agent.machine, not agent.volume.

## Exception Annotations

| File | Line | Annotation |
|------|------|------------|
| consumers.py | 174 | agent row may be deleted — don't crash disconnect handler |
| consumers.py | 208 | callback failure must not break relay WS — log and send deny |
| consumers.py | 276 | one bad event must not kill the relay WS connection |
| consumers.py | 292 | one bad event must not kill the relay WS connection |
| consumers.py | 391 | upstream connect failure — reject client with 4003 instead of crashing |
| consumers.py | 434 | upstream WS close/error ends relay loop — normal teardown path |
| consumers.py | 453 | upstream send failure — close proxy cleanly |
| consumers.py | 469 | upstream WS may already be closed during teardown |
| mutations.py | 432 | CLAUDE.md write is best-effort — instructions saved to DB regardless |
| run_triggers.py | 161 | trigger loop must never crash -- log and retry next interval |
| __init__.py | 33 | log with context before re-raising — caller gets the original exception |
| broadcast.py | 86 | dashboard push failure must not break agent lifecycle |
| feed.py | 59 | dashboard push failure must not break feed creation |
| feed.py | 91 | dashboard push failure must not break feed update |
| lifecycle.py | 724 | provisioning is background task — must not crash, cleanup below |
| lifecycle.py | 737 | orphan container kill is best-effort during provision failure cleanup |
| lifecycle.py | 765 | DB cleanup after failed provision — nothing more to do |
| lifecycle.py | 809 | best-effort — container stop is the real cleanup |
| lifecycle.py | 1043 | old container kill is best-effort during restart — new one will be provisioned regardless |
| lifecycle.py | 1145 | log capture is diagnostic only — never block provisioning |
| lifecycle.py | 1242 | one corrupt secret must not block other secrets or provisioning |
| lifecycle.py | 1264 | one corrupt secret must not block other secrets or provisioning |
| mcp_coord.py | 86 | feed is secondary — message delivery already succeeded |
| mcp_coord.py | 120 | feed is secondary — broadcast delivery already succeeded |
| mcp_coord.py | 251 | feed/broadcast is secondary — task creation already succeeded |
| mcp_coord.py | 319 | broadcast is secondary — task deletion already committed |
| mcp_coord.py | 392 | feed/broadcast is secondary — task update already committed |
| media.py | 103 | S3 upload fail-open — keep base64 so API call still works |
| reconcile.py | 73 | reconciliation loop must never crash — log and retry next interval |
| reconcile.py | 373 | can't check status — fall through to kill |
| relay.py | 90 | URL-to-base64 conversion is best-effort — keep original block |
| relay.py | 134 | DB error checking relay state — fall through and attempt send anyway |
| relay.py | 231 | dashboard push failure must not break message delivery |
| relay.py | 441 | theme push is best-effort — one agent failure must not block others |
| relay.py | 531 | one agent's skill push failure must not block other agents |
| relay.py | 552 | one agent's skill cleanup failure must not block other agents |
| relay.py | 586 | session file cleanup is best-effort — restart still proceeds |
| secrets.py | 74 | one agent's push failure must not block other agents' secrets |
| utils.py | 29 | done callback must surface uncaught background task failures |
| utils.py | 89 | container may already be gone — log and report failure |
| views.py | 240 | catch-all for hook bridge — log and return 500 so agent gets error response |
| runner.py | 208 | task execution failure should be surfaced on the task record |
| client.py | 114 | transport startup failure should degrade the runtime instead of crashing the process |
