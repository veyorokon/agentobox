# Agent Container Secrets: Design

Status: active
Author: Vahid Eyorokon

---

## Problem

Agent containers need secrets to do useful work — API keys, CLI auth tokens, MCP server credentials. The agent process is inherently untrusted: prompt injection, malicious MCPs, or careless `echo $SECRET` could leak credentials through the observable output stream, logs, or network exfiltration.

## Three-Layer Defense Model

### Layer 1: Secret File Mounts (protect at rest)

**Status: active.**

`build_api_key_files()` writes secrets to `/run/secrets/<name>` with 0600 root:root permissions. The provisioning flow (`_provision_api_key_files`) handles both Docker and Modal via the runtime adapter.

**Protects against:** `docker inspect`, `/proc/1/environ`, cross-container snooping, agent user reading secret files directly (root-only).

**Does not protect against:** The agent process itself (it needs the secret to use it).

### Layer 2: HTTP Proxy for Anthropic Key (process isolation)

**Status: active.**

This is process-level isolation, not network encryption ("in transit" is a misnomer). The real key exists only in the proxy's memory space (running as root). The agent process never possesses it.

`api-proxy.py` runs as root on localhost:9999, reads the real key from `/run/secrets/proxy_key` once at startup, and injects it into every outbound request to `api.anthropic.com`. The relay gets a placeholder key (`sk-ant-proxy00-placeholder-key-for-agentobox-validation`) that passes CLI format validation but is rejected by the real API.

```
Provisioning (backend)
  ├── writes real key → /run/secrets/proxy_key (0600 root:root)
  ├── sets ANTHROPIC_API_KEY = placeholder in relay env
  └── sets ANTHROPIC_BASE_URL = http://localhost:9999 in relay env

Runtime (inside container)
  Claude CLI (agent user)
    → POST http://localhost:9999/v1/messages
      → api-proxy.py (root) strips placeholder, injects real key
        → HTTPS POST api.anthropic.com/v1/messages
```

**Protects against:** Everything in Layer 1, plus `echo $ANTHROPIC_API_KEY` prints the placeholder (worthless), `env | grep` shows nothing useful, process memory inspection of the relay finds only the placeholder.

**Scope:** Only the Anthropic API key uses the proxy. Other secrets get Layers 1 + 3 only, until s6 MCP isolation is built.

**Important:** The proxy injects the key on ALL requests (no path allowlist). This is correct because only Claude CLI traffic hits localhost:9999 via ANTHROPIC_BASE_URL. Do not reuse this proxy for non-Anthropic APIs without adding path filtering.

### Layer 3: Output Stream Redaction (protect in output)

**Status: active.**

The relay (`relay.py`) is the single chokepoint — every event flows through `_send_event()` before reaching the backend WebSocket. A `_Redactor` class loads secret values from `/run/secrets/` and `/mnt/abox-state/secrets/env` at boot, then scrubs matching substrings from every outbound event.

**Protects against:** `echo $GITHUB_TOKEN` → `[REDACTED]` in dashboard, `env | grep TOKEN` → values redacted, `cat .env` → values redacted.

**Does not protect against:** Network exfiltration, base64-encoded secrets, secrets the relay can't read (root-only files).

**This is a UX safety net, not a security boundary.** A compromised agent can trivially bypass redaction via base64 encoding, character splitting, or network exfiltration. Redaction prevents accidental exposure in the dashboard — it does not prevent intentional exfiltration.

**Redaction mechanics:**
- Loads at boot, before any events are processed
- Applied in `_send_event()` before WS send AND before event buffering — no unredacted event ever leaves the container
- Strategy: JSON serialize → substring replace (longest first) → deserialize
- Minimum secret length: 8 chars (shorter values excluded to avoid false positives on common strings)
- Logs a WARNING when `/run/secrets/` files cant be read (PermissionError on root-only files is expected when relay runs as `agent` user)

## Which Layers Protect Which Secrets

Not every secret gets all three layers. The proxy (Layer 2) is reserved for the highest-value secret (Anthropic API key) because the overhead isn't worth it for every credential. Other secrets get Layers 1 + 3 until s6 MCP isolation is built.

| Secret type | Layer 1 (mounts) | Layer 2 (proxy) | Layer 3 (redaction) |
|-------------|:-:|:-:|:-:|
| Anthropic API key | yes | **yes** | yes |
| Project secrets (GitHub tokens, etc.) | yes | no | **yes** |
| MCP credentials (future) | yes | no (s6 isolation instead) | yes |

## Threat Model Matrix

| Attack | Layer 1 (mounts) | Layer 2 (proxy) | Layer 3 (redaction) |
|--------|:-:|:-:|:-:|
| `docker inspect` | blocked | blocked | n/a |
| `/proc/1/environ` | blocked | blocked | n/a |
| `echo $SECRET` | exposed | blocked (anthropic only) | **redacted** |
| `env \| grep` | exposed | blocked (anthropic only) | **redacted** |
| Network exfiltration | exposed | blocked (anthropic only) | exposed |
| Read secret files | blocked (root-only) | blocked | n/a |
| Malicious MCP reading env | exposed | blocked (anthropic only) | n/a (output redacted) |

## Separation of Concerns

| Component | Responsibility | File |
|-----------|---------------|------|
| Adapter (`claude_code/__init__.py`) | Decides WHAT secrets to provision, builds file specs and env content | Backend |
| Provisioning (`provision.py`) | Writes secrets to container filesystem, sets permissions | Backend |
| Lifecycle (`lifecycle.py`) | Orchestrates the provisioning sequence | Backend |
| API Proxy (`api-proxy.py`) | Intercepts Anthropic API calls, injects real key | Agent image |
| Relay (`relay.py`) | Redacts secrets from output stream before forwarding | Agent image |
| s6 services (`svc-*/run`) | Process isolation — each service has own user/env | Agent image |

## Future: s6 MCP Secret Isolation

The recommended pattern for secret-bearing MCPs (github, aws, etc.). Each MCP runs as its own s6 `longrun` service under a dedicated linux user. The agent process never possesses the secret — only a socket path.

```
s6 orchestrator
  ├── svc-relay (user: agent) — no secrets, only socket paths + placeholder key
  ├── svc-apiproxy (user: root) — reads /run/secrets/proxy_key
  ├── svc-mcp-github (user: mcp-github) — GITHUB_TOKEN via s6-envdir
  └── svc-mcp-aws (user: mcp-aws) — AWS creds via s6-envdir
```

Each MCP:
- Runs as its own s6 `longrun` service with a dedicated linux user
- Gets secrets via `s6-envdir /run/secrets/mcp-<name>/`
- Listens on unix socket `/run/mcp/<name>.sock` or local HTTP port
- Agent connects via MCP SSE/HTTP transport (not stdio)
- Agent never possesses the secret — only the socket path

**Not built yet.** The team MCP (`/mcp` on the backend) does not need s6 isolation — it runs on the backend server, not inside the container, and authenticates via relay_token over HTTP. The first real candidate is whichever secret-bearing in-container MCP gets added first (likely github or playwright).

**Concrete example — adding mcp-github:**

1. `Dockerfile`: `RUN useradd -r -s /usr/sbin/nologin mcp-github`
2. s6 service `svc-mcp-github/run`: `s6-setuidgid mcp-github` → `s6-envdir /run/secrets/mcp-github/` → `npx @anthropic/mcp-github --transport sse --port 7001`
3. Backend `lifecycle.py`: write `GITHUB_TOKEN` to `/run/secrets/mcp-github/GITHUB_TOKEN`
4. Agent `.mcp.json`: `{"github": {"type": "sse", "url": "http://localhost:7001/sse"}}`
5. Result: agent calls MCP tools over HTTP, never sees the token

When the first secret-bearing MCP is added, create:
- The s6 service directory (`svc-mcp-<name>/`)
- The linux user in the Dockerfile
- The secret provisioning in lifecycle.py
- The `.mcp.json` entry with `type: "sse"` transport pointing to the local socket

### Residual Risks with s6 Isolation

Even with process isolation, the agent can abuse MCP tools without possessing secrets:

1. **Confused deputy** — agent tricks MCP into destructive actions (e.g. `DELETE /repos/...`). Fix: expose narrow, safe tools only.
2. **MCP server exploits** — command injection in MCP tool inputs. Fix: sanitize all inputs from the agent.
3. **Misconfigured s6 permissions** — same linux user for agent and MCP defeats isolation. Fix: enforce separate `s6-setuidgid` per service.

## Open Questions

1. **Encryption at rest?** `Project.anthropic_api_key` is plaintext CharField. `ProjectSecret` uses Fernet. Decision: unify both under Fernet for now. AWS Secrets Manager is overkill until multi-tenant production. The current risk is limited — database access already requires separate credentials.
2. **Secret rotation?** The mount+inject pattern supports it (rewrite file, restart s6 service) but no UI/automation yet. Low priority — rotation matters when secrets are long-lived and shared. Current secrets are per-agent and short-lived (container lifetime).
3. **MCP-specific secrets?** Yes — the MCP registry entry should include a `secrets` field mapping env var names to ProjectSecret references. This tells the provisioner which secrets to write to `/run/secrets/mcp-<name>/` when creating an agent with that MCP enabled.
4. **Dynamic MCP addition?** Deferred. When an agent requests a new MCP mid-session, restarting the agent is acceptable for now. Dynamic s6 service startup without agent restart is possible but adds complexity we dont need yet.
