# Agentobox Backend Reference

> Auto-generated from codebase. Do not edit — regenerate with `make docs`.

## Modules

### agents/adapters/__init__.py

Adapter registry — maps agent_type strings to AgentAdapter instances.

Public API:
    get_adapter(agent_type) -> AgentAdapter
    register_adapter(agent_type, adapter) -> None

Auto-registers ClaudeCodeAdapter for "claude-code" on import.

To add a new agent type:
    1. Create adapters/<name>/ package implementing AgentAdapter
    2. Import and register here: register_adapter("<name>", <Adapter>())

### agents/adapters/base.py

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

### agents/adapters/claude_code/__init__.py

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

### agents/adapters/claude_code/registries.py

Claude Code-specific registries — models, MCP servers, team templates.

These are agent-type-specific data that other adapters (Codex, Gemini) would
replace with their own equivalents. Kept separate from the adapter class
so the data is easy to find and modify.

### agents/admin.py

Django admin registration for agent models.

Registers Agent with list display, filters, and search. Other models
(StreamEvent, SessionResult, etc.) are intentionally excluded — they're
high-volume append-only logs better inspected via GraphQL or shell.

### agents/apps.py

Django app configuration for the agents app.

### agents/consumers.py

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

### agents/graphql/auth.py

GraphQL authorization helpers for Strawberry resolvers.

Extracts the authenticated user from Strawberry's info context and verifies
project/agent ownership. Three auth paths in priority order:
1. HTTP request.user (TokenAuthMiddleware — Bearer/ApiKey header)
2. WS scope["user"] (AuthMiddlewareStack — session cookies)
3. WS connectionParams Bearer token (graphql-ws connection_init — browsers
   can't set custom headers on WebSocket upgrades, so the dashboard sends
   the token in connectionParams instead)

Every mutation/query that touches project-scoped data must call
authorize_project or authorize_agent before proceeding. These raise
PermissionError on failure — Strawberry converts that to a GraphQL error.

### agents/graphql/mutations.py

GraphQL mutations for agent lifecycle, communication, and configuration.

All mutations require Bearer auth — authorize_project or authorize_agent
checks ownership before any state change. Mutations delegate to service
functions (lifecycle.py, comms.py, feed.py) for the actual work; this
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

### agents/graphql/queries.py

Queries: agents, feed, and metadata.

Two feed layers:
    teamFeed    → curated TeamFeedItems for the dashboard (materialized view)
    agentFeed   → raw StreamEvent log for agent detail view (event store)
    projectFeed → raw StreamEvent log for project-wide view (event store)

### agents/graphql/subscriptions.py

GraphQL subscriptions — three channels, three subscriptions.

agent_changed      → project_{id}_agents     (Agent model state changes)
feed_item_changed  → project_{id}_team_feed   (TeamFeedItem create/update)
event_stream       → project_{id}_events      (StreamEvent log entries)

### agents/graphql/types.py

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

### agents/management/commands/generate_reference.py

Generate docs/REFERENCE.md from codebase docstrings and annotations.

Walks backend/agents/**/*.py, extracts module docstrings, test class
docstrings (as principles), and # intentional: annotations. Renders
a single markdown file for LLM consumption.

Usage:
    docker compose exec backend uv run python manage.py generate_reference

### agents/management/commands/seed_dev_data.py

Seed development data matching the frontend mock data.

Usage:
    docker compose exec backend uv run python manage.py seed_dev_data

Creates:
    - 1 project (owned by test user 'vahid')
    - 7 agents with varied statuses, modes, attention levels, tags, snapshots
    - ~25 TeamFeedItems covering all types
    - 4 ProjectSecrets

### agents/models.py

Domain models for the agents app.

Defines the core entities: Agent, StreamEvent, SessionResult, TeamFeedItem,
AgentTask, ProjectSecret, Skill, AgentFeedback. Agent is the central record
tracking a single Claude Code container — its runtime, config facets, session
state, and materialized view fields. StreamEvent is the append-only event log
(INSERT only, never UPDATE) that captures every relay event verbatim.
TeamFeedItem is the curated dashboard feed — a flat union where every row has
all fields, nulled where inapplicable, matching the frontend's discriminated
union type.

Key design decisions:
- State facets (model, mode, mcp_servers, allowed_tools) live on the Agent
  row. DB is source of truth; relay reads them via env vars at launch. See
  the "State facets" comment block on Agent for the extension protocol.
- SessionResult is INSERT-per-turn (not upserted) so we get a full cost
  timeline, not just latest values.
- config_snapshot captures creation-time config so hard_restart can
  reprovision identically without re-resolving defaults.

### agents/runtimes/__init__.py

Runtime registry — maps runtime names to Runtime protocol implementations.

get_runtime("docker") returns DockerRuntime, get_runtime("modal") returns
ModalRuntime. Instances are cached after first creation. Imports are lazy
(inside the match arms) to avoid pulling in docker-py or modal SDK when
only one runtime is used.

### agents/runtimes/base.py

Runtime Protocol — the port in Ports and Adapters for container orchestration.

Defines the async interface that all runtimes (Docker, Modal) must implement:
create, exec, write_file, terminate, list_sandboxes, get_status, get_crash_info.
SandboxInstance and VolumeMount are the runtime-agnostic data types that cross
the boundary.

Services never import DockerRuntime or ModalRuntime directly — they call
get_runtime(name) from __init__.py and program against this Protocol. Adding
a new runtime (e.g. Fly.io) means implementing this interface and registering
it in __init__.py; no service code changes.

### agents/runtimes/docker.py

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

### agents/runtimes/modal.py

Modal runtime — serverless container orchestration via Modal Python SDK.

Implements the Runtime protocol for production deployments. Each agent gets
a Modal Sandbox with the agent image pulled from GHCR (authenticated via
ghcr-secret). Volumes use modal.Volume.from_name() with create_if_missing.
VNC is exposed via Modal's encrypted tunnel on port 6080.

Modal Sandbox.create is natively async (.aio suffix), so no executor
wrapping needed unlike DockerRuntime.

### agents/services/auth_relay.py

Relay token authentication -- single implementation for all entry points.

### agents/services/broadcast.py

Broadcast agent updates and stream events to Channels groups.

Two broadcast functions, two channel groups. That's it.

    broadcast_agent_update(agent)  → project_{id}_agents  (Agent model state)
    broadcast_event(agent, event)  → project_{id}_events   (StreamEvent log entries)

The old system had 3 functions and 4 groups (agents, events, messages, timeline)
because Messages and AgentEvents were separate tables that needed separate
subscription paths. With StreamEvent as the single source, we need one event
channel group.

Status change detection still works via Agent.from_db() setting _original_status.
When a status change is detected, we create a StreamEvent for it (replacing the
old AgentEvent creation) and broadcast it.

### agents/services/callbacks.py

Handle SDK callback requests from the relay.

When the SDK fires a callback (can_use_tool, future hooks), the relay
forwards it as a {type: "callback"} event. We create a TeamFeedItem
for the dashboard and let the existing resolve mutation flow handle
the response back to the relay.

The callback_type field is data, not code — adding a new callback type
means adding a handler function here and a renderer in the dashboard.
No transport changes needed.

### agents/services/comms.py

Agent communication: send messages, signals, and mode changes.

Commands are delivered to agents via WebSocket push through the relay's
persistent connection. Each command goes through:

    1. Create StreamEvent (append-only log)
    2. Broadcast to dashboard subscribers
    3. Push command to relay via Channels group_send

The relay consumer (consumers.py) receives group_send messages on the
relay_{agent_id} group and forwards them to the relay process over WebSocket.

### agents/services/feed.py

TeamFeedItem creation and attention management.

This is the materialized view layer. StreamEvent = raw audit log.
TeamFeedItem = curated dashboard feed items created when feed-worthy events occur.

### agents/services/interagent.py

Inter-agent message delivery through the Agentobox backend.

Messages are delivered to target agents via WebSocket relay push.
The MCP coordination server's teammate_message and teammate_broadcast
tools call into this module directly.

Flow:
    1. Agent calls teammate_message MCP tool
    2. deliver_to_stdin() formats message as stream-json input
    3. StreamEvent created for feed visibility
    4. Command pushed to relay via WebSocket
    5. Relay writes to Claude's stdin -> agent receives it immediately

### agents/services/lifecycle.py

Agent lifecycle management: create, kill, remove, hard-restart.

Orchestrates the full agent lifecycle from DB record creation through
container provisioning to teardown. create_agent creates the Agent row
immediately (so the dashboard sees it) then spawns _provision_agent as
a detached asyncio.create_task for the slow container work.

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
    signal s6 to start relay → spawn tmux log tail

### agents/services/mcp_coord.py

MCP Coordination Server for agent-to-agent communication.

Tool names and parameter shapes align with Claude Code's native team tools
(SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList). Transport differs
(MCP HTTP → backend routing instead of filesystem), but the interface is
identical so models trained on CC's native schemas work out of the box.

Auth: Each tool call authenticates by extracting the Bearer token from
the Authorization header and looking up the Agent by relay_token.

See: docs/ARCHITECTURE.md, "MCP Coordination Server"

### agents/services/mcp_registry.py

Proxy client for the official MCP server registry at registry.modelcontextprotocol.io.

Provides search_registry() which forwards search queries to the upstream
registry API and returns the response. Used by the GraphQL searchMcpRegistry
query so the dashboard can browse available MCP servers without a direct
browser-to-registry connection (avoids CORS and keeps the registry URL
server-side).

### agents/services/media.py

S3 media externalization for base64 image content blocks.

Uploads base64-encoded images to S3 (LocalStack in dev, DigitalOcean Spaces in prod)
and returns a public URL. Used by stream.py to swap inline base64 data with URLs
before storing Messages in the database.

### agents/services/provision.py

Workspace provisioning — write config files into agent containers.

Called during _provision_agent (lifecycle.py) after the container is created.
Writes into the container filesystem via runtime.write_file/exec:

    1. CLAUDE.md — instructions built by the adapter (team roster, MCP docs,
       role-specific context, user-provided instructions)
    2. .claude/settings.json — agent settings (API key, permission mode)
    3. .mcp.json — MCP server configs with env blocks for project secrets,
       plus the team coordination HTTP server if relay_token is set
    4. .claude.json — onboarding state (marks setup complete)
    5. API key files — adapter-provided file specs (path, content, mode, owner)
    6. Scoped sudoers — restricts sudo to package management only
    7. Skills — project skills matching agent tags as .claude/skills/<name>/SKILL.md

All agent-type-specific config (file formats, instruction content) is
delegated to the adapter via get_adapter(agent_type). This module handles
only the I/O orchestration.

Also provides utilities for hot-reloading secrets (write_secrets_env,
push_secrets_to_agent) and theme files (write_theme_files) on running agents.

### agents/services/reconcile.py

Background reconciliation loop for agents.

Detects orphaned containers, dead containers, and stuck deploys — then
cleans up. Runs inside the backend process (no extra services).

With the WebSocket relay, heartbeat-based staleness detection is replaced
by WS disconnect events. This loop handles cases where containers die
without a clean disconnect.

NOTE: This runs inside asyncio.create_task() where Django's
CurrentThreadExecutor is unavailable. All ORM calls MUST use
@sync_to_async(thread_sensitive=False) — never async ORM (asave, async for).

### agents/services/secrets.py

Fernet-based encryption for project secrets.

Secrets are stored as individually Fernet-encrypted values in the database.
Decrypted only during agent provisioning (to inject into MCP env blocks
or write to tmpfs).

The encryption key is read from settings.ABOX_ENCRYPTION_KEY. If not set,
secret creation raises an error rather than silently falling back.

Usage:
    from agents.services.secrets import encrypt_value, decrypt_value

    encrypted = encrypt_value("sk-ant-...")
    plaintext = decrypt_value(encrypted)  # -> "sk-ant-..."

### agents/services/stream.py

Process Claude Code stream-json events into the append-only StreamEvent log.

This is the write path. It is deliberately simple:

    1. Store the raw event verbatim as a StreamEvent row (INSERT, never UPDATE)
    2. Broadcast to dashboard subscribers
    3. Update materialized fields on the Agent model (status, phase, cost, etc.)

No upserts. No row locks. No content part accumulation. No dual-table routing.
The old write path had select_for_update() to accumulate parts on a Message row —
that complexity is gone. Each event from the relay is one INSERT.

Why store raw: the relay forwards ALL stream-json events without filtering.
Thinking content, tool progress, rate limits, content deltas — everything
Anthropic adds to stream-json is automatically captured. The data field is
the raw event dict, verbatim. We are an event log, not a relational model.

Intelligence lives in the read path (the frontend) which reconstructs
logical messages by grouping StreamEvents by message_id.

### agents/services/utils.py

Shared service utilities -- thin helpers for repeated patterns.

### agents/tests/check_architecture.py

Fast architecture checks — no Django, no DB, no pytest.

Runs as a standalone script for pre-commit hooks. Parses source files
as AST and checks import boundaries, naming conventions, and resolver
discipline. Exits 0 on pass, 1 on failure with details.

Usage:
    python backend/agents/tests/check_architecture.py

### agents/tests/conftest.py

Shared test fixtures for agents tests.

### agents/tests/test_adapters.py

Contract tests for the adapter layer.

Tests verify:
    1. Protocol compliance — every registered adapter satisfies AgentAdapter
    2. Extraction correctness — display fields extracted from sample data
    3. Graceful handling — None/empty/{} inputs don't crash
    4. Registry — get_adapter works, unknown types raise ValueError
    5. Seed data parity — seed_dev_data snapshots match real CC event structure
    6. Real event parity — adapter handles actual CC v2.1.59 stream-json events

### agents/tests/test_architecture.py

Architectural enforcement tests.

These tests catch drift mechanically — import boundaries, naming conventions,
and model field discipline. They read source files as text and check patterns.
No Django ORM needed (except schema contract test which needs Strawberry).

### agents/tests/test_auth.py

Tests for agents.graphql.auth authorization helpers.

### agents/tests/test_comms.py

Tests for agents.services.comms — content normalization and SSRF prevention.

### agents/tests/test_lifecycle.py

Tests for agents.adapters.claude_code — shell escape utility.

### agents/tests/test_mcp_coord.py

Contract tests for MCP coordination tools — CC native schema parity.

Verifies that our MCP tools match Claude Code's native team tool schemas
(SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList) in parameter names
and return shapes.

Tests call the tool functions directly with mocked auth to avoid needing
a full MCP server roundtrip.

NOTE: mcp_coord.py uses lazy imports inside functions (to avoid circular
imports), so we patch at the source module (agents.models) not at the
consumer (agents.services.mcp_coord).

### agents/tests/test_resolvers.py

Tests for GraphQL resolver adapter delegation.

Verifies that display field resolvers read from latest_snapshot via adapter,
not from stale model columns.

### agents/tests/test_stream.py

Tests for stream.py snapshot writes and phase logic.

### agents/views.py

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

### test_adapters.py — TestRegistry

Principle: the adapter registry is the single lookup point for agent types.

get_adapter(type) returns a cached adapter instance. Unknown types raise
ValueError immediately — no silent fallback to a default adapter.

### test_adapters.py — TestProtocolCompliance

Principle: every registered adapter must satisfy the AgentAdapter protocol.

Runtime isinstance() check ensures all protocol methods exist with correct
signatures. If a new method is added to AgentAdapter, every adapter must
implement it or this test fails.

### test_adapters.py — TestClaudeCodeExtraction

Principle: adapter extraction is a pure function of the snapshot.

Given a latest_snapshot dict, the adapter returns display fields (last_output,
live_action, cost, duration, turns) deterministically. No DB access, no side
effects, no mutation of the input.

### test_adapters.py — TestGracefulHandling

Every registered adapter must handle degenerate input without crashing.

### test_adapters.py — TestSeedDataParity

Verify seed_dev_data snapshots produce correct adapter output.

This is the contract test: if seed snapshot structure drifts from what
the adapter expects (or vice versa), these tests catch it.

### test_adapters.py — TestRealEventParity

Verify adapter handles actual Claude Code v2.1.59 stream-json events.

Fixtures in tests/fixtures/ are sanitized captures from real CC sessions
(solo, tool use, plan mode, team mode). These tests prove our adapter
can extract display fields from events with the FULL real structure,
not just simplified test snapshots.

### test_adapters.py — TestBuildSettings

Verify ClaudeCodeAdapter.build_settings produces correct settings.json.

### test_adapters.py — TestBuildInstructions

Verify ClaudeCodeAdapter.build_instructions produces correct CLAUDE.md.

### test_architecture.py — TestImportBoundaries

Principle: layer boundaries are enforced by import direction.

Adapters must not import models or services — they're pure functions of
dict input. The stream write path must not import adapters at module level
to stay agent-type-agnostic. Resolvers must use adapters, not raw JSON.

### test_architecture.py — TestNamingConventions

Principle: public API names are self-documenting via verb_entity pattern.

Service functions, mutations, and subscriptions follow naming conventions
that make the codebase navigable without reading implementations. Service
functions start with a verb, mutations are verb_entity, subscriptions end
with _changed or _stream.

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

### test_architecture.py — TestExplicitErrorHandling

Principle: Fail loud, never fail silent.

Every broad except (Exception/BaseException/bare) must be annotated with
``# intentional:`` explaining why the broad catch is necessary. Unannotated
blocks are likely silent-failure bugs. This test catches them mechanically.

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

Every field update (status, owner, dependencies) persists to DB and
triggers a broadcast so the dashboard reflects the change. Deleting
a task sets status=deleted and removes it from active views.

### test_mcp_coord.py — TestTaskGet

Principle: task reads return the full task state including dependencies.

task_get returns the complete task dict (subject, description, status,
owner, blocks, blockedBy) so the agent has full context to act on it.

### test_mcp_coord.py — TestTaskList

Principle: task list returns a summary view scoped to the project.

Returns all non-deleted tasks with enough fields for triage (id, subject,
status, owner, blockedBy) but not full descriptions — use task_get for that.

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

## Exception Annotations

| File | Line | Annotation |
|------|------|------------|
| consumers.py | 139 | agent row may be deleted — don't crash disconnect handler |
| consumers.py | 157 | callback failure must not break relay WS — log and continue |
| consumers.py | 165 | one bad event must not kill the relay WS connection |
| consumers.py | 253 | upstream connect failure — reject client with 4003 instead of crashing |
| consumers.py | 273 | upstream WS close/error ends relay loop — normal teardown path |
| consumers.py | 286 | upstream send failure — close proxy cleanly |
| consumers.py | 296 | upstream WS may already be closed during teardown |
| mutations.py | 392 | CLAUDE.md write is best-effort — instructions saved to DB regardless |
| generate_reference.py | 4 | annotations. Renders |
| generate_reference.py | 144 | comments, yield DocChunk.""" |
| __init__.py | 33 | log with context before re-raising — caller gets the original exception |
| broadcast.py | 66 | channel layer failure must not break agent state mutations |
| broadcast.py | 116 | channel layer failure must not break event creation |
| comms.py | 71 | URL-to-base64 conversion is best-effort — keep original block |
| comms.py | 87 | DB error checking relay state — fall through and attempt send anyway |
| comms.py | 384 | session file cleanup is best-effort — restart still proceeds |
| feed.py | 219 | channel layer failure must not break feed item creation |
| lifecycle.py | 393 | provisioning is background task — must not crash, cleanup below |
| lifecycle.py | 400 | orphan container kill is best-effort during provision failure cleanup |
| lifecycle.py | 412 | DB cleanup after failed provision — nothing more to do |
| lifecycle.py | 603 | old container kill is best-effort during restart — new one will be provisioned regardless |
| lifecycle.py | 639 | log capture is diagnostic only — never block provisioning |
| lifecycle.py | 695 | one corrupt secret must not block other secrets or provisioning |
| mcp_coord.py | 102 | broadcast is best-effort — shutdown already committed to DB |
| mcp_coord.py | 206 | feed/broadcast is secondary — task creation already succeeded |
| mcp_coord.py | 265 | broadcast is secondary — task deletion already committed |
| mcp_coord.py | 329 | feed/broadcast is secondary — task update already committed |
| media.py | 103 | S3 upload fail-open — keep base64 so API call still works |
| reconcile.py | 54 | reconciliation loop must never crash — log and retry next interval |
| secrets.py | 77 | one agent's push failure must not block other agents' secrets |
| utils.py | 62 | container may already be gone — log and report failure |
| views.py | 195 | catch-all for hook bridge — log and return 500 so agent gets error response |
