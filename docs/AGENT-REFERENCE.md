# Agentobox Agent Reference

> Auto-generated from agent codebase. Do not edit — regenerate with `python agent/scripts/generate-reference.py`.

## Modules

### agent/rootfs/opt/abox/abox_logging.py

Shared JSON logging for all agent-side Python processes.

Stdlib-only (no pip dependencies). Produces JSON lines on stderr matching
the backend structlog output shape so all logs are greppable with the same
tooling. Each process calls ``setup()`` once at import time to configure
the root logger.

Usage::

    from abox_logging import setup
    log = setup("abox-relay")                 # INFO level (default)
    log = setup("team-bridge", level="DEBUG")  # DEBUG level

    log.info("relay.ws_connected")
    log.info("relay.turn_complete", extra={"received": 5, "elapsed": 1.2})

### agent/rootfs/opt/abox/api-proxy.py

Localhost reverse proxy that injects the real API key header.

Part of the Layer 2 secret protection (see docs/ARCHITECTURE.md "Security & Secrets").
Runs as root, reads the real key from /run/secrets/proxy_key (mode 0600 root:root)
at startup, and serves on 0.0.0.0:9999. The agent process gets a base URL pointing
to localhost:9999 with a placeholder key that passes CLI format validation but is
worthless if leaked. The proxy strips the placeholder and injects the real key before
forwarding to the upstream API.

Upstream is configurable via env vars (set by the adapter's build_relay_env()):
  PROXY_UPSTREAM_HOST  — default: api.anthropic.com
  PROXY_UPSTREAM_PORT  — default: 443
  PROXY_AUTH_HEADER    — default: x-api-key (Anthropic), or "authorization" (OpenAI)

This ensures the agent process never has access to the real API key — process-level
isolation, not just environment variable hiding.

SCOPE: All requests to this proxy get the real key injected. Only agent CLI traffic
should hit localhost:9999 (via *_BASE_URL env vars).

OPS: If the proxy enters a restart loop (visible in s6 logs), check:
  1. /run/secrets/proxy_key exists and is non-empty (provisioning issue)
  2. Port 9999 is not already in use (another process grabbed it)
  3. DNS resolution for the upstream host works (network issue)

### agent/rootfs/opt/abox/converters.py

Theme token converter — generates derived theme files from tokens.json.

Called from:
1. Boot oneshot (init-volume) for initial state
2. Relay poke handler when tokens.json changes

Input:  /vol/tmp/abox-theme/tokens.json (CSS design tokens)
Output: /vol/tmp/abox-theme/theme.css (generic browser/home-surface CSS)
        /vol/tmp/abox-theme/awesome.lua (AwesomeWM theme table)
        /vol/tmp/abox-theme/theme.json (reference copy)

### agent/rootfs/opt/abox/mcp-gateway.py

MCP Gateway — manages MCP server subprocesses with secret isolation.

Reads /run/mcp-gateway/config.json for server definitions.
Spawns each MCP as a stdio subprocess with scoped env from /run/secrets/mcp-<name>/.
Bridges stdio↔HTTP on localhost:<port> per server.
Reloads on SIGHUP (re-reads config, starts new servers, stops removed ones).

Runs as root (to read secret dirs), spawns MCP subprocesses as `agent` user via
pwd.getpwnam + subprocess.Popen(user=, group=, env=).

Config format (/run/mcp-gateway/config.json):
{
    "servers": {
        "playwright": {
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
            "port": 7001
        }
    }
}

Secret dirs: /run/secrets/mcp-<name>/<KEY> — each file contains one secret value.
Only secrets listed in the MCP's registry entry are written to its secret dir.

### agent/rootfs/opt/abox/relay_common.py

Shared utilities for agent relay processes.

Both the Claude Code relay (relay.py) and the OpenCode relay
(opencode-relay.py) use the same WebSocket transport to the Agentobox
backend, the same secret redaction, and the same reconnection logic.
This module contains only the shared pieces — agent-type-specific logic
lives in each relay's own file.

Classes:
    Redactor     — scrub known secrets from outbound event dicts
    FatalWSClose — non-retryable WS rejection from the backend
    WSTransport  — WebSocket connection with reconnect + auth header

### agent/claude/rootfs/opt/abox/hooks/team-bridge.py

Hook bridge: intercept CC native team tools, route through agentobox backend.

PreToolUse: read-only tools (TaskList, TaskGet) — deny native execution,
    return backend result via systemMessage.
PostToolUse: mutating tools (SendMessage, TaskCreate, TaskUpdate) — native
    tool already ran, forward to backend for DB persistence.

Stdlib only — no pip dependencies. Runs inside agent container as child of
CC process. Reads config from ~/.relay_env (CC strips custom env vars from
hook subprocesses so we cannot rely on env var inheritance).

### agent/claude/rootfs/opt/abox/relay.py

abox-relay: In-container relay process for Claude Code SDK integration.

Manages a Claude Code session via the Agent SDK and bridges events to the
Agentobox backend over WebSocket.

    WebSocket (ws://backend/ws/relay/<agent_id>/):
        auth:       Authorization header on WS upgrade (Bearer <relay_token>)
        upstream:   SDK messages → raw event dicts → ws.send(json)
        downstream: commands from backend (input, signal, mode) → SDK methods

The SDK spawns and manages the Claude Code CLI subprocess internally.
We monkey-patch the SDK's message parser to preserve the raw JSON dict from
stdout on every parsed message (as msg._raw). This lets us forward the exact
wire-format dicts the backend expects — no manual serialization, no field loss.

See the comment block above the monkey-patch for why this exists and when it can be removed.

Synthetic events (not from Claude):
    process_exit: {type: "system", subtype: "process_exit", exit_code, stderr}
        Emitted when the SDK client disconnects or the subprocess terminates.

## Shell Scripts

### agent/rootfs/etc/s6-overlay/s6-rc.d/svc-apiproxy/run

OAuth mode: no proxy key, no proxy needed — CC authenticates directly.
Sleep forever so s6 doesn't restart-loop this service.

### agent/rootfs/etc/s6-overlay/s6-rc.d/svc-dbus/run

Start a dbus session bus for desktop/browser processes that expect one.
Write the address to a file that desktop services can source.

### agent/rootfs/etc/s6-overlay/s6-rc.d/svc-mcp-gateway/run

config.json is available via volume symlink (init-volume runs first).

### agent/rootfs/etc/s6-overlay/s6-rc.d/svc-relay/run

.relay_env is available via volume symlink (init-volume runs first).
No polling needed — s6-rc dependency ensures init-volume completes first.

### agent/rootfs/etc/s6-overlay/s6-rc.d/svc-relay/finish

s6 finish script — runs after the relay process exits.

$1 = exit code (256 if killed by signal)
$2 = signal number (0 if normal exit)

On clean exit (code 0): touch down to prevent restart — the relay
decided to stop (fatal WS close, clean shutdown).

On crash (non-zero): let s6-supervise auto-restart. The relay has
reconnection logic (WS backoff + SDK retry) and the backend backfills
missed messages on reconnect. After MAX_CRASHES consecutive failures,
halt the container to avoid infinite loops.

### agent/rootfs/etc/s6-overlay/scripts/init-volume

init-volume — create symlinks from the agent's volume subdir into the container.

Each agent gets its own subdir within the shared project volume:
  /vol/agents/$AGENT_ID/home/agent/.claude  →  /home/agent/.claude
  /vol/agents/$AGENT_ID/tmp/abox-theme      →  /tmp/abox-theme
  etc.

AGENT_ID is set as a container env var by _build_agent_env() in lifecycle.py.
The volume root is /vol/ (Docker named volume mounted by _build_volume_mounts()).

### agent/claude/rootfs/opt/abox/api-key-helper.sh

Placeholder — overwritten at provision time by build_api_key_files().
If this runs un-overwritten, fail loud so the agent doesn't start
with a broken key path.

## S6 Services

| Service | Type | Dependencies |
|---------|------|-------------|
| init-volume | oneshot | base |
| svc-apiproxy | longrun | base, init-volume |
| svc-awesome | longrun | init-volume, svc-dbus, svc-xvfb |
| svc-dbus | longrun | svc-xvfb |
| svc-mcp-gateway | longrun | base, init-volume |
| svc-relay | longrun | base, init-volume |
| svc-websockify | longrun | svc-x11vnc |
| svc-x11vnc | longrun | svc-xvfb |
| svc-xvfb | longrun | base |

### init-volume

init-volume — create symlinks from the agent's volume subdir into the container.

Each agent gets its own subdir within the shared project volume:
  /vol/agents/$AGENT_ID/home/agent/.claude  →  /home/agent/.claude
  /vol/agents/$AGENT_ID/tmp/abox-theme      →  /tmp/abox-theme
  etc.

AGENT_ID is set as a container env var by _build_agent_env() in lifecycle.py.
The volume root is /vol/ (Docker named volume mounted by _build_volume_mounts()).

### svc-apiproxy

OAuth mode: no proxy key, no proxy needed — CC authenticates directly.
Sleep forever so s6 doesn't restart-loop this service.

### svc-dbus

Start a dbus session bus for desktop/browser processes that expect one.
Write the address to a file that desktop services can source.

### svc-mcp-gateway

config.json is available via volume symlink (init-volume runs first).

### svc-relay

.relay_env is available via volume symlink (init-volume runs first).
No polling needed — s6-rc dependency ensures init-volume completes first.

## Test Principles

### test_config.py — TestBuildOptions

_build_options — translates env vars to ClaudeAgentOptions.

### test_config.py — TestBuildSdkEnv

_build_sdk_env — env dict passed to the SDK subprocess.

### test_config.py — TestWSUrl

WSTransport._ws_url — builds WS endpoint from HTTP callback URL.

### test_config.py — TestStderrCollection

_get_stderr — assembles diagnostic output for process_exit events.

### test_contracts.py — TestProcessExitEvent

process_exit synthetic event — stream.py reads exit_code as int,
stderr as string ≤4096 chars.

### test_contracts.py — TestModeMapping

_MODE_MAP translates backend vocabulary to SDK format.
Backend sends: auto, plan, supervised
SDK expects: bypassPermissions, plan, default

### test_contracts.py — TestCriticalEventTypes

CRITICAL_EVENT_TYPES — events that must be buffered, never dropped.

### test_contracts.py — TestUserMessageFiltering

_message_to_event must filter text-only user messages (echoes)
but forward tool_result messages.

### test_contracts.py — TestRelayStartupContracts

Startup stage markers and MCP preflight error contracts.

### test_contracts.py — TestDependencyVersionCheck

_check_dependency_compatibility — validates CLI + SDK + proxy versions
against the known-good matrix before spawning the SDK.

### test_contracts.py — TestFirefoxThemeReload

Theme changes use loopback socket poke — relay must NOT restart Firefox.

### test_contracts.py — TestHookBridgeRouting

team-bridge.py tool classification — PRE tools are intercepted,
POST tools are forwarded after native execution, others pass through.

### test_contracts.py — _FakeWSTransport

Minimal WSTransport stand-in for testing EventSender.

### test_contracts.py — _FakeRedactor

Pass-through redactor for tests.

### test_contracts.py — TestSequenceIdsMonotonic

INV-OBS-002: Every outbound event gets a monotonic seq field.

### test_contracts.py — TestDropCounterIncrements

INV-OBS-002: Drop counters track non-critical drops during disconnect.

### test_contracts.py — TestOverflowEmitsTypedEvent

INV-OBS-002: Buffer overflow emits relay.buffer_overflow event.

### test_contracts.py — TestBufferStatsReportedOnReconnect

Buffer stats are logged and buffer is flushed on reconnect.

### test_logging.py — TestJSONFormatter

JSONFormatter output shape — this is a contract with log pipelines.

### test_logging.py — TestSetup

setup() function — logging root configuration.

### test_logging.py — TestRedactingFormatter

RedactingFormatter — secrets scrubbed from JSON output.

### test_logging.py — TestAddRedactingFileHandler

add_redacting_file_handler — replaces plain handler with redacting one.

### test_logging.py — _FakeRedactor

Minimal redactor for testing — replaces known secrets.

### test_security.py — TestRedactorLoading

Secret loading from filesystem sources.

### test_security.py — TestRedaction

Redaction of secrets from text and event dicts.

### test_theme.py — TestRenderThemeCss

Generated CSS must reflect the semantic theme tokens without leaking stale defaults.

### test_theme.py — TestWriteThemeDocument

End-to-end: write a theme document and verify the derived runtime artifacts update.

### test_theme.py — TestInitVolumeSymlinks

init-volume must symlink /tmp/abox-theme so the volume files are visible.

## Exception Annotations

| File | Line | Annotation |
|------|------|------------|
| relay_common.py | 224 | WS connect can fail for transient network reasons — caller retries via reconnect() |
| relay_common.py | 257 | WS send failure marks connection down — caller will reconnect and retry |
| relay_common.py | 281 | WS recv failure marks connection down — caller reconnects |
| relay_common.py | 308 | WS close is best-effort cleanup — socket may already be dead |
| relay.py | 652 | unexpected SDK error during message forwarding — post exit event and let run loop decide retry |
| relay.py | 701 | query failure must not kill downstream listener — log and continue receiving commands |
| relay.py | 786 | awesome-client reload is best-effort cosmetic — theme still applies on next restart |
| relay.py | 845 | mode change failure is recoverable — deferred to next SDK session start |
| relay.py | 865 | gateway SIGHUP is best-effort — gateway still serves with old config |
| relay.py | 1097 | SDK connect failure is retried with backoff — exhaustion posts exit event |
| relay.py | 1167 | SDK disconnect is best-effort cleanup — process may already be dead |
| relay.py | 1459 | top-level catch — log crash details before exit so s6 can restart |

## Tech Debt

| File | Line | Annotation |
|------|------|------------|
| relay.py | 92 | SDK monkey-patch — attaches _raw dict to parsed messages. Remove when SDK adds .to_dict() on message types. |
