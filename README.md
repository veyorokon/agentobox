# Agentobox

[![CI](https://github.com/veyorokon/agentobox/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/veyorokon/agentobox/actions/workflows/ci.yml)
[![Deploy](https://github.com/veyorokon/agentobox/actions/workflows/deploy.yml/badge.svg)](https://github.com/veyorokon/agentobox/actions/workflows/deploy.yml)

A platform for managing AI agent teams. Provision agents with full Linux desktops, observe their work in real-time via VNC and activity feeds, and coordinate multi-agent workflows through a web dashboard.

## Quick Start

```bash
make up
open http://localhost:5051
```

Login: `demo` / `demo`

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌────────────────────┐
│  Dashboard   │────▶│   Backend    │────▶│   Agent Containers  │
│  (Next.js)   │◀────│  (Django)    │◀────│  (s6 + Claude Code) │
│  :5051       │ GQL │  :8000       │ WS  │  :6080 (VNC)        │
└─────────────┘     └───────────────┘     └─────────────────────┘
                           │
                    ┌──────┴──────┐
                    │  Postgres   │  Redis
                    │  (pgvector) │  (pub/sub)
                    └─────────────┘
```

| Layer | Stack |
|-------|-------|
| **backend/** | Django 6.0 · Strawberry GraphQL · Django Channels · Daphne (ASGI) |
| **dashboard/** | Next.js · Apollo Client · Zustand · Tailwind CSS v4 |
| **agent/** | Debian bookworm · s6-overlay · AwesomeWM · Chromium · noVNC · Claude Code relay |
| **infra/** | Terraform (DigitalOcean compute/db + Route53 DNS) · Docker Compose · Caddy |
| **runtimes** | Docker (local dev) · Modal (serverless production) |

## Engineering Principles

These aren't aspirational — they're enforced via architecture tests, pre-commit hooks, and code review. Each one exists because we were burned by the alternative.

### Ship one code path

No mock modes, feature flags, or conditional branches between dev and prod. The code you test is the code you ship. Separate code paths rot — the untested one always breaks first.

*In practice:* Docker Compose for local dev and production. Same images, same entrypoints, different env vars. No `if NODE_ENV === 'development'` escape hatches.

### Fail loud, never fail silent

Every broad exception handler requires an `# intentional: <reason>` annotation explaining why it exists. This is enforced by architecture tests — unannotated `except Exception` blocks fail CI.

```python
# Good — the decision is documented and reviewable:
except Exception as exc:  # intentional: callback failure must not break relay WS — log and send deny

# Bad — fails CI:
except Exception:
    pass
```

### Validate at the boundary, trust internally

Auth checks live at the GraphQL resolver layer. Services trust that the caller is authorized — no defensive `if not user.owns(agent)` scattered through business logic. External input is validated once at ingestion; internal code trusts the normalized shape.

### Secrets never touch agent processes

Real API keys are stored in root-readable files (`0600`). Agent processes only see a placeholder. The api-proxy (running as root) swaps the placeholder for the real key on each upstream request. Even if an agent process is compromised, it never sees the actual key.

```
┌──────────────┐    placeholder key    ┌────────────┐    real key    ┌──────────┐
│  Claude Code  │ ──────────────────▶ │  api-proxy  │ ────────────▶ │ Upstream │
│  (user:agent) │                     │  (root)     │              │ API      │
└──────────────┘                     └────────────┘              └──────────┘
```

### Document in code, generate from code

Module docstrings, test class docstrings, `# intentional:` annotations, and `# tech-debt:` comments are extracted by `make docs` into `docs/REFERENCE.md`. Documentation lives next to the code it describes — no separate wiki to maintain, no docs drift.

### Test structure, not just behavior

Architecture tests read source files as text and enforce invariants that code review alone can't catch reliably:

| Test | Enforces |
|------|----------|
| `test_secret_boundary` | Only api-proxy reads `/run/secrets/`, relay never touches it |
| `test_poke_registry` | Every volume state path has a matching relay handler |
| `test_theme_token_parity` | CSS tokens → Chromium + AwesomeWM produce identical output |
| `test_architecture` | Import boundaries, broad-except annotations, field discipline |

## Key Patterns

### Volume-Based State

All agent runtime state flows through a shared volume. The backend writes files, sends a WebSocket "poke" to the relay, and the relay reloads from disk. One protocol replaces multiple ad-hoc sync mechanisms.

```
VOLUME_ROOT/agents/{agent_id}/
├── home/agent/                      # Mirrored to /home/agent/ in container
│   ├── .claude/settings.json        # CC settings (model, mode)
│   ├── .relay_env                   # Relay environment
│   └── workspace/CLAUDE.md          # Agent instructions
├── tmp/abox-theme/tokens.json       # Theme CSS tokens
├── run/secrets/proxy_key            # Real API key (0600, root-only)
└── _abox/                           # Control plane
    ├── state.json                   # {model, mode, allowed_tools}
    ├── status.json                  # Convergence tracking (SHA-256 hashes)
    ├── inbox.jsonl / inbox.pos      # Messages to agent
    └── outbox.jsonl / outbox.pos    # Events from agent
```

Convergence is tracked via SHA-256 hashes in `status.json`. The relay compares file hashes on each poke — if the hash matches, no reload. Delivery is guaranteed via `.pos` offset files.

### S6-Overlay Service Graph

Agent containers use s6-overlay for dependency-driven startup. No polling, no sleep loops, no race conditions — s6-rc guarantees ordering.

```
base
├── init-volume ─────────────────┐
├── svc-xvfb (X11 display)      │
│   ├── svc-x11vnc (VNC)        │
│   │   └── svc-websockify      │
│   └── svc-awesome (WM) ◀──────┘
├── svc-dbus
├── svc-apiproxy (root, key injection)
├── svc-mcp-gateway
└── svc-relay (Claude Code bridge) ◀── init-volume
```

Each service is a directory under `agent/platform/` with a `run` script and explicit `dependencies.d/` declarations.

### Agent Module Layout

Agent runtime code lives in `agent/runtime/` (app logic, execution, state) and `agent/transports/` (relay bridge). Platform-level services (s6, X11, VNC) live in `agent/platform/`. Desktop assets (Chromium theme, browser config) live in `agent/desktop-assets/`.

### Relay Bridge

A single bidirectional WebSocket connects each agent container to the backend:

- **Upstream:** Every Claude Code stdout event (stream-json) forwarded verbatim — no filtering, no batching, no transformation. New event types are captured automatically.
- **Downstream:** Commands from the dashboard (input, signal, mode changes) delivered to the relay, which applies them to the running CC session.

### Adapter Protocol

Each agent type (claude-code, etc.) plugs in via a pure-function adapter. Adapters translate between agent-type-specific vocabulary and backend-generic fields. No DB access, no side effects — adapters are pure functions over JSON.

### Frontend Data Split

Server data lives in Apollo cache (agents, feed items, stream events). Ephemeral UI state lives in Zustand stores (composer recipients, sidebar state). The boundary is clear: if it came from the server, it stays in Apollo. If the user created it locally, it goes in Zustand.

### Image Layer Strategy

The agent image is split into a stable base layer (s6, X11, VNC, AwesomeWM, fonts) and an agent-type layer (Claude Code, relay, api-proxy). Changing relay.py rebuilds only the top layer — not 40 APT install layers.

### JSON Logging

All agent-side processes emit structured JSON matching the backend's structlog shape. Stdlib `logging` only — zero pip dependencies. File handlers write to the shared volume (persistent); stderr handlers write to tmpfs (ephemeral, unredacted for performance). A `RedactingFormatter` scrubs secrets from file output at log-time.

## Annotation Conventions

Three structured comment types are extracted by `make docs`:

| Annotation | Purpose | Example |
|------------|---------|---------|
| `# intentional: <reason>` | Broad exception handlers, unusual patterns | `# intentional: agent row may be deleted — don't crash disconnect` |
| `# tech-debt: <reason>` | Known shortcuts with removal conditions | `# tech-debt: SDK monkey-patch — remove when SDK adds .to_dict()` |
| Module/class docstrings | Auto-extracted to REFERENCE.md | First string in any `.py` file or test class |

Currently scans `backend/agents/` and `agent/runtime/`. Dashboard reference is generated separately via `node dashboard/scripts/generate-reference.mjs`.

## Deployment

### Local

```bash
make up                    # docker compose up -d
```

### Production

Automated via GitHub Actions (`deploy.yml`). Pushes to `dev` deploy to `dev.agentobox.com`; pushes to `main` deploy to `agentobox.com`.

```
PR → dev:   ci.yml (fast + smoke)
merge dev:  deploy → dev environment → agent bootstrap + smoke
merge main: deploy → prod environment → agent bootstrap + smoke
```

Images are built, pushed to GHCR with sha-pinned tags, and deployed to the target server via SSH. Caddy handles TLS via Let's Encrypt.

### CI/CD

Images are built and pushed to GHCR on every push to `dev` or `main` (`:branch`, `:sha-xxx`) and on version tags (`:latest`, `:v1.2.3`). Agent images are contract-tested before push. Post-deploy bootstrap and smoke tests verify the live environment.

## Make Commands

| Command | Description |
|---------|-------------|
| `make up` / `make down` | Start / stop all services |
| `make test` | Run backend tests in Docker |
| `make test-local` | Run backend tests locally via uv |
| `make lint` | Run ruff (backend) + next lint (dashboard) |
| `make migrate` | Run Django migrations |
| `make makemigrations` | Generate new Django migrations |
| `make schema` | Export GraphQL schema to `dashboard/schema.graphql` |
| `make docs` | Regenerate all reference docs from codebase |
| `make agent-image` | Build agent Docker image locally |
| `make seed` | Seed dev data (demo user, agents, feed items) |

## Documentation

| Doc | Purpose |
|-----|---------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System topology, data flow, service lifecycle |
| [TESTING](docs/testing.md) | Canonical test taxonomy and CI lane mapping |
| [CONTRACTS](docs/contracts/README.md) | Ownership and invariants for provisioning, runtime, preview, and release |
| [MACHINE CONTRACT](docs/contracts/machine.md) | Canonical state model for project volumes, agent machine surfaces, and Docker/Modal parity |
| [RUNTIME-FAILURE-AUDIT](docs/RUNTIME-FAILURE-AUDIT.md) | Standard runtime debugging and failure classification procedure |
| [REFERENCE](docs/REFERENCE.md) | Auto-generated: backend modules, annotations (`make docs`) |
| [DASHBOARD-REFERENCE](docs/DASHBOARD-REFERENCE.md) | Auto-generated: dashboard modules, annotations (`make docs`) |
| [AGENT-REFERENCE](docs/AGENT-REFERENCE.md) | Auto-generated: agent modules, s6 services, annotations (`make docs`) |
| [docs/archive/superseded](docs/archive/superseded/README.md) | Historical docs retained for context, not as current source of truth |

## Project Structure

```
agentobox/
├── agent/                  # Container image
│   ├── Dockerfile*         # Layered: base → managed → desktop variants
│   ├── runtime/            # App logic (execution, state, config, inbox)
│   ├── transports/         # Relay bridge (agentobox WS transport)
│   ├── platform/           # Platform services (s6, X11, VNC)
│   ├── desktop-assets/     # Browser theme and config (Chromium)
│   ├── contracts/          # Transport protocol definitions
│   └── tests/              # Agent-side tests (boot, health, architecture)
├── backend/                # Django backend
│   ├── agents/             # Core app (models, services, adapters, GraphQL)
│   ├── accounts/           # Auth (JWT, middleware)
│   └── config/             # Django settings, ASGI config, health check
├── dashboard/              # Next.js frontend
│   ├── app/                # App router pages
│   ├── components/         # React components
│   ├── lib/                # GraphQL client, stores, hooks
│   └── schema.graphql      # Checked-in GraphQL schema
├── infra/                  # Terraform
│   ├── environments/       # Per-environment config (dev, prod)
│   ├── modules/            # Reusable modules (compute, database, dns)
│   └── bootstrap/          # One-time setup (S3 state bucket, DynamoDB lock)
├── docs/                   # Documentation
├── .github/                # CI/CD workflows, issue/PR templates
├── .githooks/              # Shareable pre-commit hooks
├── docker-compose.yml      # Local dev
├── docker-compose.prod.yml # Production
├── Caddyfile               # Reverse proxy config
└── Makefile                # Developer commands
```

## Pre-commit Hooks

```bash
git config core.hooksPath .githooks
```

Architecture checks run on commit: import boundaries, annotation enforcement, naming conventions.

## License

Proprietary. All rights reserved.
