# Agentobox

A platform for managing AI agent teams. Provision agents with full Linux desktops, observe their work in real-time via VNC and activity feeds, and coordinate multi-agent workflows through a web dashboard.

## What It Does

- **Agent provisioning**: Spin up containerized AI agents with full desktop environments (X11, browser, terminal)
- **Real-time observation**: Watch agents work via VNC streams and structured activity feeds
- **Team coordination**: Agents communicate via messages and shared task lists, all visible in the dashboard
- **Permission control**: Supervised mode lets you approve/deny agent tool calls from the dashboard
- **Cost tracking**: Per-session cost, duration, and turn counts

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  Dashboard   │────▶│   Backend    │────▶│   Agent Containers  │
│  (Next.js)   │◀────│  (Django)    │◀────│  (s6 + Claude Code) │
│  :5051       │ GQL │  :8000       │ WS  │  :6080 (VNC)        │
└─────────────┘     └──────────────┘     └─────────────────────┘
                           │
                    ┌──────┴──────┐
                    │  Postgres   │  Redis
                    │  (pgvector) │  (pub/sub)
                    └─────────────┘
```

- **backend/**: Django 6.0 + Strawberry GraphQL + Django Channels (ASGI via Daphne)
- **dashboard/**: Next.js + Apollo Client + Zustand + Tailwind CSS v4
- **agent/**: Debian container with s6-overlay, AwesomeWM, Firefox, noVNC, Claude Code + relay process
- **Runtimes**: Docker (local dev) or Modal (serverless production)

## Quick Start

```bash
# Start all services
make up

# In another terminal — services are ready when you see "backend-1 | Listening on TCP address 0.0.0.0:8000"
open http://localhost:5051
```

Login: `vahid` / `test1234`

## Make Commands

| Command | Description |
|---------|-------------|
| `make up` | Start all services (Postgres, Redis, backend, dashboard) |
| `make down` | Stop all services |
| `make test` | Run backend tests in Docker |
| `make test-local` | Run backend tests locally via uv |
| `make lint` | Run ruff (backend) + next lint (dashboard) |
| `make migrate` | Run Django migrations |
| `make makemigrations` | Generate new Django migrations |
| `make createsuperuser` | Create Django superuser |
| `make check` | Django system checks |
| `make schema` | Export GraphQL schema to `dashboard/schema.graphql` |
| `make docs` | Regenerate `docs/REFERENCE.md` from codebase |
| `make agent-image` | Build agent Docker image locally |
| `make dev` | Run backend locally with Daphne (outside Docker) |

## Pre-commit Hooks

Architecture checks run automatically on commit (import boundaries, naming conventions, annotation enforcement):

```bash
git config core.hooksPath .githooks
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [FOUNDATIONS](docs/FOUNDATIONS.md) | Product axioms, principles, design decisions |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System topology, data flow, service lifecycle |
| [REFERENCE](docs/REFERENCE.md) | Auto-generated from codebase (`make docs`) |
| [DASHBOARD-UX-SPEC](docs/DASHBOARD-UX-SPEC.md) | UX framework, component hierarchy |

## Project Structure

```
agentobox/
├── agent/                  # Container image
│   ├── Dockerfile.debian   # Full image definition
│   ├── rootfs/             # Filesystem overlay (s6 services, relay, hooks)
│   └── mcp-servers/        # Bundled MCP servers
├── backend/                # Django backend
│   ├── agents/             # Core app (models, services, adapters, GraphQL)
│   ├── accounts/           # Auth
│   └── config/             # Django settings, ASGI config
├── dashboard/              # Next.js frontend
│   ├── app/                # App router pages
│   ├── components/         # React components
│   ├── lib/                # GraphQL client, stores, hooks
│   └── schema.graphql      # Checked-in GraphQL schema
├── docs/                   # Documentation
│   ├── archive/            # Historical research and reference captures
│   └── *.md                # Living docs
├── .github/                # CI/CD workflows, issue templates, PR template
├── .githooks/              # Shareable git hooks
└── Makefile                # Developer commands
```

## Testing

```bash
# Run all backend tests (in Docker)
make test

# Run specific test file
docker compose exec backend uv run python -m pytest agents/tests/test_architecture.py -v

# Run dashboard hook tests
cd dashboard && npx vitest run __tests__/hooks.test.ts
```

## License

Proprietary. All rights reserved.
