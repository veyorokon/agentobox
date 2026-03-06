# OpenClaw Gateway Docker Experiment

**Date**: 2026-03-05
**Status**: SUCCESS — full event flow confirmed

## Setup (order of operations)

### 1. Create config directory structure

```bash
mkdir -p ~/.openclaw-test/identity
mkdir -p ~/.openclaw-test/agents/main/agent
mkdir -p ~/.openclaw-test/agents/main/sessions
mkdir -p ~/.openclaw-test/workspace
```

### 2. Write openclaw.json (bypass onboarding)

```json
{
  "gateway": {
    "mode": "local",
    "port": 18789,
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "<generate-with-openssl-rand-hex-32>"
    }
  },
  "agents": {
    "defaults": {
      "workspace": "/home/node/.openclaw/workspace"
    }
  },
  "session": { "dmScope": "per-channel-peer" },
  "tools": { "profile": "messaging" },
  "wizard": {
    "lastRunAt": "2026-03-05T00:00:00.000Z",
    "lastRunVersion": "2026.3.2",
    "lastRunCommand": "onboard",
    "lastRunMode": "local"
  }
}
```

Key learnings:
- Token MUST be a plain string, not a SecretRef object (gateway validates it)
- `wizard` block is cosmetic metadata but avoids "not onboarded" warnings
- `bind: "lan"` required to access from host; gateway auto-seeds `controlUi.allowedOrigins`

### 3. Fix permissions for node user (uid 1000)

```bash
docker run --rm -v ~/.openclaw-test:/data alpine chown -R 1000:1000 /data
```

### 4. Run container with API key as env var

```bash
docker run -d \
  --name openclaw-test \
  -p 18789:18789 \
  -e HOME=/home/node \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v ~/.openclaw-test:/home/node/.openclaw \
  -v ~/.openclaw-test/workspace:/home/node/.openclaw/workspace \
  ghcr.io/openclaw/openclaw:latest \
  node dist/index.js gateway --bind lan --port 18789
```

Other provider keys: `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, etc.

### 5. Wait for startup (~8s warm, ~25s cold)

Gateway health: `curl -sf http://localhost:18789/healthz`
Logs: `docker logs openclaw-test`

## WS Connection Protocol

### Connect to WebSocket

```
ws://localhost:18789/ws
```

### Handshake (3 steps)

1. **Receive** `connect.challenge` event with `nonce`
2. **Send** `connect` request:
   ```json
   {
     "type": "req", "id": "<uuid>", "method": "connect",
     "params": {
       "minProtocol": 3, "maxProtocol": 3,
       "client": {
         "id": "gateway-client",
         "version": "1.0.0",
         "platform": "linux",
         "mode": "backend"
       },
       "role": "operator",
       "scopes": ["operator.admin"],
       "caps": ["tool-events"],
       "auth": { "token": "<gateway-token>" }
     }
   }
   ```
3. **Receive** `hello-ok` response

Key: `role: "operator"` + valid token = skip device identity/pairing entirely.
(`roleCanSkipDeviceIdentity()` returns true for operator + sharedAuthOk)

### Valid client IDs and modes

Client IDs: `webchat-ui`, `openclaw-control-ui`, `webchat`, `cli`,
`gateway-client`, `openclaw-macos`, `openclaw-ios`, `openclaw-android`,
`node-host`, `test`, `fingerprint`, `openclaw-probe`

Modes: `webchat`, `cli`, `ui`, `backend`, `node`, `probe`, `test`

Capabilities: `tool-events` (must request to receive tool start/update/end events)

### RPC format

```json
{"type": "req", "id": "<uuid>", "method": "<method-name>", "params": {...}}
```

Response: `{"type": "res", "id": "<same-uuid>", "ok": true/false, "payload": {...}}`

### Available RPC methods (key ones)

| Method | Purpose |
|--------|---------|
| `health` | Server status, agents, sessions |
| `models.list` | All available models with metadata |
| `sessions.list` | List chat sessions |
| `agents.list` | List configured agents |
| `chat.send` | Send message: `{sessionKey, message, idempotencyKey}` |
| `chat.history` | Get session history |
| `chat.abort` | Cancel running generation |
| `config.get` | Read current config |
| `config.set` | Write config (takes `{raw: "<full-json>"}`) |
| `exec.approval.resolve` | Reply to permission request |

### Event types

| Event | Description |
|-------|-------------|
| `agent` | Agent execution events (lifecycle, assistant, tool, error) |
| `chat` | Chat messages (delta, final) — client-friendly summaries |
| `exec.approval.requested` | Permission request from agent |
| `exec.approval.resolved` | Permission decision |
| `tick` | Periodic keepalive |
| `presence` | Client presence updates |
| `health` | Health status changes |

## Agent Event Format (the key data)

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "dd08ca60-...",
    "stream": "lifecycle",  // or "assistant", "tool", "error"
    "data": {
      "phase": "start",     // stream-specific data
      "startedAt": 1772756561705
    },
    "sessionKey": "agent:main:main",
    "seq": 1,
    "ts": 1772756561705
  },
  "seq": 2
}
```

### Stream types and data shapes

**lifecycle**: `{phase: "start"|"end"|"error", startedAt/endedAt: number}`
**assistant**: `{delta: string}` (streaming) or `{text: string}` (accumulated)
**tool**: `{phase: "start"|"update"|"end", name: string, toolCallId: string, args/result: ...}`
**error**: `{message: string, ...}`

### Chat events (client-friendly)

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "delta",     // or "final"
    "message": {
      "role": "assistant",
      "content": [{"type": "text", "text": "..."}],
      "timestamp": "..."
    }
  }
}
```

## Observed Event Sequence (real message)

1. `chat.send` response: `{runId, status: "started"}`
2. `agent` lifecycle.start
3. `agent` assistant.delta (repeated, ~1-5 tokens each)
4. `chat` delta (batched, periodic accumulation)
5. `agent` lifecycle.end
6. `chat` final (complete message)

Total: 36 events for a simple response (29 assistant deltas, 2 lifecycle, 5 chat)

## MCP Server Support

### Two agent modes

OpenClaw has two execution modes with different MCP support:

| Mode | Tools | MCP Support | How |
|------|-------|-------------|-----|
| **Built-in ACP agent** | exec, read, write, etc. | **None** — ACP translator ignores mcpServers | Default when no CLI backend configured |
| **claude-cli backend** | Full Claude Code tools | **Full** — via `--mcp-config` or workspace `.mcp.json` | Configure `cliBackends` in openclaw.json |

Source: `src/acp/translator.ts:146-147` — `this.log('ignoring ${params.mcpServers.length} MCP servers')`
Source: `src/agents/cli-backends.ts` — DEFAULT_CLAUDE_BACKEND spawns `claude -p --output-format json --permission-mode bypassPermissions`

### claude-cli backend (what we want)

When using `claude-cli` backend, OpenClaw spawns Claude Code as a subprocess. Claude Code picks up MCP config from:
1. `--mcp-config /path/to/mcp.json --strict-mcp-config` (explicit)
2. `.mcp.json` in the workspace directory (automatic)

MCP config format (same as standalone Claude Code):
```json
{
  "mcpServers": {
    "team-coord": {
      "command": "npx",
      "args": ["-y", "@agentobox/mcp-coord"],
      "env": {"AGENTOBOX_BACKEND_URL": "..."}
    }
  }
}
```

### Config to enable claude-cli backend

Add to `openclaw.json`:
```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "claude-cli": {
          "command": "claude",
          "args": ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions",
                   "--mcp-config", "/home/node/.openclaw/mcp-config.json"]
        }
      }
    }
  }
}
```

### Key insight

OpenClaw becomes a pure **event streaming and session management layer**. Claude Code does the actual work — tool execution, MCP integration, permission handling. This is cleaner than having OpenClaw's built-in agent compete with Claude Code.

## Architecture Implications for Agentobox

### What this gives us
- **Unified event format** — one adapter for ALL model providers
- **No relay per agent type** — gateway handles Claude, GPT, Gemini, local models
- **WS protocol already designed** — battle-tested by 250k+ users
- **Permission system built-in** — `exec.approval.requested` / `exec.approval.resolved`
- **Multi-agent ready** — `agents.list`, `agents.create`, session routing
- **Cost tracking** — in session JSONL files, accessible via API
- **MCP support** — via claude-cli backend, full MCP passthrough to Claude Code

### What we still add
- **VNC stack** (s6 + Xvfb + AwesomeWM + noVNC) — our image, gateway runs inside
- **Team coordination** — MCP server injected via `.mcp.json` in workspace
- **Thin relay** — WS bridge: gateway events → agentobox backend
- **Container lifecycle** — our Docker/Modal runtime manages containers

### Container architecture
```
┌─── agentobox container ──────────────────────┐
│  s6-overlay (process supervisor)             │
│  ├── openclaw gateway (port 18789)           │
│  │   └── claude-cli backend (subprocess)     │
│  │       └── .mcp.json (team coord, etc.)    │
│  ├── Xvfb + AwesomeWM                       │
│  ├── x11vnc → websockify (port 6080)        │
│  └── relay.py (WS bridge to backend)        │
│       connects to gateway localhost:18789    │
│       forwards events to agentobox WS       │
└──────────────────────────────────────────────┘
```

relay.py:
1. Connects to gateway via WS (localhost, no auth needed on loopback)
2. Subscribes to `agent` + `exec.approval` events
3. Forwards to agentobox backend via existing relay WS
4. Receives commands from backend → translates to gateway RPC (`chat.send`, `exec.approval.resolve`)
