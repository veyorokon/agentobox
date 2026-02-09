Backend: Stream-JSON integration — replace hooks/tmux/transcript with relay pipeline

## Overview

Replace the current hooks + tmux + transcript parsing system with a stream-JSON relay pipeline. The relay process runs inside each agent container, spawns Claude with `--output-format stream-json`, and forwards typed events to the backend via HTTP.

**Spec:** `docs/STREAM-JSON-INTEGRATION-SPEC.md`
**Audit:** `docs/ARCHITECTURE-AUDIT.md`
**Claude Code internals:** `docs/CLAUDE-CODE-MESSAGE-PIPELINE.md`
**Crush patterns:** `docs/CRUSH-ARCHITECTURE.md`

## Scope

### New Models

**`Message`** — replaces `AgentMessage` + `AgentEvent`. Mirrors Claude Code's message structure with typed content parts (`parts` JSONField). Upserted by `(agent, message_id)`.

Fields: `agent`, `message_id` (Claude's `msg_xxx`), `session_id`, `role`, `model`, `parts` (typed content array), `usage`, `parent_tool_use_id`, `stop_reason`, `turn_number`

**`SessionResult`** — cost/usage per session. Upserted by `(agent, session_id)` on each `result` event (fires per-turn with cumulative totals).

Fields: `agent`, `session_id`, `is_error`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `model_usage`, `permission_denials`

**Agent model changes:**
- Remove: `transcript_path`
- Add: `session_cost_usd`, `capabilities` (JSONField from `system/init`), `pending_input` (JSONField for relay piggyback), `pending_signal` (CharField for SIGINT), `relay_token` (auth token)

### New Endpoint: `/agents/<agent_id>/stream`

Receives batched stream-json events from relay. Authenticated via `X-Relay-Token` header.

Returns piggyback response:
```json
{"ack": true, "pending_input": null, "pending_signal": null}
```

Backend enqueues `pending_input` on Agent record when `send_message()` is called. Relay picks it up in the next POST response cycle.

### Event Processing: `process_stream_events()`

Handles 4 event types:
- `system/init` → upsert `agent.capabilities`
- `system/process_exit` → update `agent.status` (idle or error based on exit code)
- `assistant` → upsert `Message` by `message_id`, update `agent.status` to working
- `user` (tool_result) → create `Message` for tool result
- `result` → upsert `SessionResult`, update `agent.session_cost_usd`, set status idle, assign `turn_number`

Full processing logic is in the spec under "Event Processing Logic".

### Rewritten Services

**`send_message()`** — instead of tmux send-keys, set `agent.pending_input` as JSON. Relay picks up via piggyback.

**`interrupt_agent()`** — instead of tmux C-c, set `agent.pending_signal = "SIGINT"`. Relay picks up via heartbeat.

**`_provision_agent()`** — launch relay process instead of tmux. Pass `RELAY_AUTH_TOKEN`, `ABOX_CALLBACK_URL`, `AGENT_ID` as env vars.

### Removed Code

| Component | File |
|---|---|
| Hook shell script + provisioning | `provision.py` |
| Hook settings builder | `provision.py` |
| Hook HTTP endpoint + URL route | `views.py`, `urls.py` |
| ProcessExit curl wrapper | `lifecycle.py` |
| `process_hook_event()` (~115 lines) | `lifecycle.py` |
| `_extract_last_response()` (~47 lines) | `lifecycle.py` |
| Tmux launch wrapper | `lifecycle.py` |
| `attach_mcp()` via tmux | `comms.py` |
| `AgentMessage` model | `models.py` |
| `AgentEvent` model | `models.py` |

MCP configured at launch time via `--mcp-config` flag instead of runtime `attach_mcp()`.

### GraphQL API Changes

**Remove:**
- `attachMcp` mutation (MCP configured at launch)
- `events` query (replaced by messages on agent)
- `newEvent` subscription (replaced by message subscription)
- `AgentEventType` / `AgentEventSubType` types
- `AgentMessageType` (replaced by `MessageType`)

**Add/Update:**
- `MessageType` with typed `parts` field and `turnNumber`
- `SessionResultType` with cost/usage fields
- `AgentType.messages` returns new `MessageType` (with `parts: [ContentPartType]`)
- `AgentType.sessionResult` returns current `SessionResultType`
- `AgentType.capabilities` returns tools, MCP servers, model, version
- `messageReceived(agentId: ID!)` subscription — pushes new/updated `MessageType`
- `sendMessage` mutation unchanged in signature, but backend enqueues instead of tmux
- `interruptAgent` mutation unchanged in signature, but backend sets signal instead of tmux
- `AgentFeedback.message` FK migrated from `AgentMessage` to `Message`

**Naming:** Match Claude Code field names 1:1 where possible. `message_id` = Claude's `msg_xxx`, `tool_use_id` (not `tool_call_id`), `stop_reason` (not `finish_reason`), `parts` for content array.

### Migration Path

1. Add new models + endpoint alongside existing (additive)
2. Replace tmux launch with relay launch
3. Keep hooks running in parallel during validation
4. Frontend migrates to new types
5. Remove old models, hooks, endpoints
6. Migrate `AgentFeedback.message` FK

## Acceptance Criteria

- [ ] `Message` and `SessionResult` models created with migrations
- [ ] `/agents/<agent_id>/stream` endpoint receives batched events and returns piggyback response
- [ ] `process_stream_events()` correctly upserts Messages and SessionResults
- [ ] `send_message()` enqueues `pending_input` on Agent
- [ ] `interrupt_agent()` sets `pending_signal` on Agent
- [ ] `_provision_agent()` launches relay with correct env vars
- [ ] GraphQL types updated (`MessageType`, `SessionResultType`, `AgentType.capabilities`)
- [ ] `messageReceived` subscription broadcasts new messages
- [ ] Old hook/tmux code removed
- [ ] `AgentFeedback` FK migrated
- [ ] All existing tests pass, new tests for event processing

---

## Comments

### Comment

## Update: `--include-partial-messages` validated

Tested on v2.1.37. With this flag, Claude emits `stream_event` events wrapping the raw Anthropic streaming API:

- **Text streams** as `text_delta` chunks (2-5 words each) — perfect for live typing
- **Tool input streams** as `input_json_delta` with partial JSON fragments
- **MCP tools** work identically to native tools
- **Full `assistant` message still emitted** after streaming — deltas AND final message arrive
- **Event type is `stream_event`** — distinct from `assistant`/`user`/`result`, easy to route

**Architecture impact:**
- `stream_event` events should NOT be persisted — pass through to WebSocket only
- Relay should forward these in real-time (not batched)
- Backend needs a separate ephemeral subscription channel (e.g. `agentStreaming(agentId)`)
- Frontend accumulates deltas for live typing, replaces with final `assistant` message

Spec updated with full details in "Partial Messages (Live Streaming)" section.

---

### Comment

## Convention: Docstrings must trace back to Claude Code

Every model, service function, and type must include docstrings that explain:
1. Which Claude Code stream-json event(s) it maps to
2. Field-by-field mapping from the event payload
3. Reference to the relevant spec section

Example:

```python
class Message(models.Model):
    """
    Mirrors Claude Code's stream-json assistant/user events.
    
    Each stdout event with type="assistant" or type="user" becomes one Message.
    The `parts` field stores message.content[] verbatim — the same typed array
    format used by the Anthropic Messages API and Claude Code's internal
    MessageContent type.
    
    Field mapping from Claude Code stream-json:
        message_id  <- event.message.id (stable across incremental updates)
        session_id  <- event.session_id
        role        <- event.message.role ("assistant" | "user")
        model       <- event.message.model
        parts       <- event.message.content[] (ContentPart[])
        usage       <- event.message.usage (token counts with cache breakdown)
        stop_reason <- event.message.stop_reason ("end_turn" | "tool_use" | "max_tokens")
        parent_tool_use_id <- event.parent_tool_use_id (non-null for subagent responses)
    
    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
    See: docs/CRUSH-ARCHITECTURE.md, "Message Model" (pattern origin)
    """
```

```python
class SessionResult(models.Model):
    """
    Cost and usage from Claude Code's stream-json `result` events.
    
    Upserted by (agent, session_id) because `result` fires per-turn with
    cumulative totals — not per-session.
    
    Field mapping from Claude Code stream-json:
        is_error         <- event.is_error
        total_cost_usd   <- event.total_cost_usd (cumulative across turns)
        duration_ms      <- event.duration_ms (total wall time)
        duration_api_ms  <- event.duration_api_ms (API time only; diff = tool exec time)
        num_turns        <- event.num_turns (conversation depth)
        model_usage      <- event.modelUsage (per-model cost/token breakdown)
        permission_denials <- event.permission_denials
    
    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "result event"
    """
```

```python
def process_stream_event(agent, event):
    """
    Route a single Claude Code stream-json event to the appropriate handler.
    
    Event types (from Claude Code stdout):
        system    -> init (capabilities), process_exit (relay synthetic)
        assistant -> upsert Message (text and/or tool_use content parts)
        user      -> create Message (tool_result content parts)
        result    -> upsert SessionResult (cumulative cost/usage)
    
    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Event Processing Logic"
    See: docs/CLAUDE-CODE-MESSAGE-PIPELINE.md, "Turn Lifecycle"
    """
```

Apply this convention to all new code: models, services, endpoints, GraphQL types.

---

### Comment

## Critical: Content parts arrive incrementally — APPEND, don't replace

Tested on v2.1.37. Each `assistant` event carries exactly **1 content part**, even when a message has multiple parts. For a turn with text + 2 parallel tool calls:

```
assistant {msg_id: "msg_A", content: [{type: "text"}]}                    ← 1 part
assistant {msg_id: "msg_A", content: [{type: "tool_use", name: "Read"}]}  ← 1 part
assistant {msg_id: "msg_A", content: [{type: "tool_use", name: "Bash"}]}  ← 1 part
```

**Same `message_id`, each event has only 1 part.** A naive `update_or_create` with `defaults={"parts": content}` loses earlier parts.

**Fix:** Use `get_or_create` then append — same pattern Crush uses with `AppendContent()`/`AddToolCall()`:

```python
message, created = Message.objects.get_or_create(
    agent=agent, message_id=message_id,
    defaults={"session_id": ..., "role": "assistant", "parts": [], ...}
)
message.parts = message.parts + msg_data.get("content", [])
message.usage = msg_data.get("usage") or message.usage
message.stop_reason = msg_data.get("stop_reason") or message.stop_reason
message.save(update_fields=["parts", "usage", "stop_reason", "updated_at"])
```

**Also confirmed:**
- Parallel tool calls work — multiple `tool_use` parts on the same `message_id`
- Tool results arrive as separate `user` events (1 `tool_result` per event)
- User events should use `event.uuid` as `message_id` (not `tool_use_id`) + `get_or_create` for idempotency

Spec updated with corrected processing logic.

