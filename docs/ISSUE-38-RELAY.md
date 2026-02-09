Relay: Build abox-relay process for agent containers

## Overview

Build `abox-relay`, a ~150 line Python process that runs inside each agent container. It spawns Claude with stream-json flags, reads stdout events, batches and forwards them to the backend, and handles message delivery via the piggyback pattern.

**Spec:** `docs/STREAM-JSON-INTEGRATION-SPEC.md` (see "Relay Process" section)

## Responsibilities

1. Spawn Claude with stream-json flags (see spec for full flag list)
2. Read stdout line-by-line, batch events (50-100ms window), POST batch to backend
3. Read stderr in a separate thread, capture for `process_exit` event
4. Parse POST response for `pending_input` — write to Claude's stdin if present
5. Parse POST response for `pending_signal` — send SIGINT to Claude if present
6. Send heartbeat POST every 2s when idle (no events) to poll for pending input/signals
7. Expose `GET /health` returning `{"relay": "ok", "claude_pid": N, "claude_running": true/false}`
8. Optionally pipe events to a tmux log session for VNC visibility
9. On Claude exit, POST a final `process_exit` event with exit code + stderr, then self-terminate

## Piggyback Pattern

The relay does NOT run an HTTP listener for inbound messages. Instead:

```
Relay POSTs events → Backend responds with:
  {"ack": true, "pending_input": {...} or null, "pending_signal": "SIGINT" or null}
```

If `pending_input` is present, relay writes it to Claude's stdin as a JSON line.
If `pending_signal` is present, relay sends the signal (SIGINT) to Claude.

When idle (no events to POST), relay sends empty heartbeat POSTs every 2s to poll.

## Environment Variables

```
CLAUDECODE=1
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
ANTHROPIC_API_KEY=<key>
AGENT_ID=<uuid>
ABOX_CALLBACK_URL=<backend-url>/agents/<agent_id>/stream
RELAY_AUTH_TOKEN=<token>
```

## Synthetic Events

The relay emits one synthetic event not produced by Claude:

### `process_exit`
```json
{
  "type": "system",
  "subtype": "process_exit",
  "exit_code": 0,
  "stderr": "...",
  "session_id": "...",
  "agent_id": "..."
}
```

## Edge Cases to Handle

- Claude fails to start (bad flags, missing binary) — capture stderr, POST process_exit with non-zero exit code
- Claude crashes mid-turn (OOM, segfault) — detect via `proc.poll()`, POST process_exit
- Backend is down — buffer events in memory (last N), retry with backoff
- stdin buffering — Claude's stream-json stdin buffers natively. If a message arrives while Claude is mid-turn, it processes after the current turn completes. No relay-side queue needed.
- Graceful shutdown — on SIGTERM to relay, forward SIGINT to Claude, wait for exit, POST final events

## Implementation Notes

- Use `asyncio` for concurrent stdout/stderr reading + HTTP posting + heartbeat timer
- Use `aiohttp` or `httpx` for async HTTP client
- Batch: collect events into a list, flush every 50-100ms or when list hits N items
- Health endpoint: simple `http.server` or `aiohttp` on a separate port

## Acceptance Criteria

- [ ] Spawns Claude with correct flags from env vars
- [ ] Reads stdout line-by-line and batches events
- [ ] POSTs batched events to `ABOX_CALLBACK_URL` with `X-Relay-Token` header
- [ ] Parses response for `pending_input` and writes to stdin
- [ ] Parses response for `pending_signal` and sends SIGINT
- [ ] Heartbeat POST every 2s when idle
- [ ] `GET /health` endpoint returns relay/Claude status
- [ ] Captures stderr and includes in `process_exit` event
- [ ] Handles Claude crash gracefully (non-zero exit code)
- [ ] Handles backend downtime (retry with backoff, buffer events)
- [ ] Bundled in agent Docker image

---

## Comments

### Comment

## Update: `--include-partial-messages` validated

With this flag, Claude emits `stream_event` type events with text/tool deltas (chunk-level, 2-5 words).

**Relay impact:**
- `stream_event` events should be forwarded in **real-time** (not batched) — they're for live typing display
- Regular events (`assistant`, `user`, `result`, `system`) still get batched 50-100ms
- The relay needs to distinguish `stream_event` type from others and bypass the batch buffer

So the relay has two output paths:
1. **Batched:** `system`, `assistant`, `user`, `result` → batch 50-100ms → POST to `/agents/<id>/stream`
2. **Real-time:** `stream_event` → immediate POST to `/agents/<id>/stream/live` (or same endpoint with a flag)

The backend will route real-time events to an ephemeral WebSocket channel without persisting them.

---

### Comment

## Convention: Docstrings must trace back to Claude Code

All relay code must include docstrings explaining the Claude Code mapping:

```python
"""
abox-relay: In-container relay process for Claude Code stream-json integration.

Spawns Claude with --output-format stream-json, reads structured events from
stdout, batches them, and POSTs to the Agentobox backend. Receives pending
messages/signals via piggyback pattern in POST responses.

Two output paths:
    Batched (50-100ms): system, assistant, user, result events
        -> POST /agents/<id>/stream (persisted by backend)
    Real-time: stream_event (from --include-partial-messages)
        -> POST /agents/<id>/stream/live (ephemeral, WebSocket passthrough)

Synthetic events (not from Claude):
    process_exit: {type: "system", subtype: "process_exit", exit_code, stderr}
        Emitted when Claude process terminates. Includes exit code and
        captured stderr for crash diagnosis.

See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Relay Process"
See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Piggyback Pattern"
"""
```

```python
def forward_events(batch: list[dict]) -> dict:
    """
    POST a batch of Claude Code stream-json events to the backend.
    
    Events are the raw JSON objects from Claude's stdout, each with
    a `type` field: "system", "assistant", "user", or "result".
    
    Returns piggyback response from backend:
        pending_input:  JSON message to write to Claude's stdin (or null)
        pending_signal: Signal name to send to Claude process (or null)
    
    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Piggyback Pattern"
    """
```

Apply this convention to all relay code.

