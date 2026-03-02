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

### Layer 2: HTTP Proxy for High-Value Keys (protect in transit)

**Status: active.**

`api-proxy.py` runs on localhost:9999, reads the real key from `/run/secrets/proxy_key`, injects it into outbound requests to `api.anthropic.com`. The relay gets a placeholder key that passes CLI validation but is worthless if leaked.

```
Claude CLI  →  ANTHROPIC_BASE_URL=http://localhost:9999
            →  api-proxy.py reads /run/secrets/proxy_key
            →  injects real Authorization header
            →  forwards to api.anthropic.com
```

**Protects against:** Everything in Layer 1, plus `echo $ANTHROPIC_API_KEY` prints the placeholder, `env | grep` shows nothing useful, process memory inspection of the relay.

**When to use:** Only for the highest-value secrets where leakage = direct financial cost (anthropic API key). The proxy overhead (extra hop, streaming complexity) isn't worth it for every secret.

### Layer 3: Output Stream Redaction (protect in output)

**Status: active.**

The relay (`relay.py`) is the single chokepoint — every event flows through `_send_event()` before reaching the backend WebSocket. A `_Redactor` class loads secret values from `/run/secrets/` and `/mnt/abox-state/secrets/env` at boot, then scrubs matching substrings from every outbound event.

**Protects against:** `echo $GITHUB_TOKEN` → `[REDACTED]` in dashboard, `env | grep TOKEN` → values redacted, `cat .env` → values redacted.

**Does not protect against:** Network exfiltration, base64-encoded secrets, secrets the relay can't read (root-only files).

**This is a UX safety net, not a security boundary.** A compromised process can trivially bypass redaction via encoding or exfiltration. Document it as defense-in-depth, not a security control.

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

**Not built yet.** When the first secret-bearing MCP is added, create:
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

1. **Encryption at rest?** `Project.anthropic_api_key` is plaintext CharField. `ProjectSecret` uses Fernet. Unify both under Fernet or migrate to AWS Secrets Manager.
2. **Secret rotation?** The mount+inject pattern supports it (rewrite file, restart service) but no UI/automation yet.
3. **MCP-specific secrets?** Should the MCP registry entry include a `secrets` field mapping env var names to project secrets?
4. **Dynamic MCP addition?** When an agent requests a new MCP mid-session, can we start the s6 service without restarting the agent? Possible with dynamic tool discovery via a local registry.
