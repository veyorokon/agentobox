# Agentobox

## Local Dev

```bash
docker compose up -d          # postgres, redis, backend, gda, dashboard
```

- Dashboard: http://localhost:3000
- Backend GraphQL: http://localhost:8000/graphql

### Test credentials

- Username: `vahid`
- Password: `testpass123`

## CI/CD

- Agent image workflow: `.github/workflows/agent-image.yml`
- Dev builds: push to `main` with `agent/` changes -> `:main` + `:sha-xxx`
- Release builds: push `v*` tag -> `:latest` + `:v1.2.3`
- Image: `ghcr.io/veyorokon/agentobox-agent` (private, Modal pulls via `ghcr-secret`)

## Architecture

- **backend/**: Django 6.0 + Strawberry GraphQL + uvicorn (dev) / Daphne (prod)
- **dashboard/**: Next.js + urql + Zustand + augmented-ui
- **agent/**: Alpine + s6-overlay image with AwesomeWM, Firefox, noVNC, Claude Code hooks. Uses `rootfs/` convention — all container files under `agent/rootfs/` at their actual filesystem paths.
- **Runtimes**: Modal (serverless) or Docker (local)

## Makefile

- `make up` — Start all services. Auto-sets `AGENT_VERSION` from latest git tag so Modal pulls the correct image.
- `make down` — Stop all services.
- `make migrate` / `make makemigrations` — Django migrations (local).
- `make createsuperuser` — Create Django superuser (local).
- `make check` — Django system checks (local).
- `make schema` — Export GraphQL schema to `dashboard/schema.graphql`.
- `make agent-image` — Build agent Docker image locally.
- `make dev` — Run backend locally with Daphne (outside Docker).

## Standing Up an Agent Team (Dev)

The team lead is Claude Code on the host. Agents are Docker containers visible in the dashboard.

### Sequence

1. `docker compose up -d` — backend, dashboard, postgres, redis
2. Login via GraphQL to get a Bearer token
3. `createAgent` mutation per agent — each gets a `name` (role), `runtime: "docker"`, `workspacePath` (host project dir), `instructions` (responsibilities), and optional `mcpServers`
4. Agents boot, mount the workspace, get CLAUDE.md with their responsibilities, and start Claude Code in team mode
5. Team lead dispatches tasks via `sendMessage` mutation
6. Hook events flow from containers back to the backend — dashboard shows status, events, and VNC streams
7. All agents share the same mounted codebase — one agent's file edits are immediately visible to others

### Agent roles (dogfooding)

| Agent | Responsibilities |
|-------|-----------------|
| `backend` | Django models, services, runtimes, GraphQL schema |
| `frontend` | Next.js dashboard, components, stores, GraphQL client, UI/UX |
| `qa` | Deploy test agents, run verification checklists, Playwright testing |

### Key fields on createAgent

- `name` — Role identifier visible to teammates for task routing
- `workspacePath` — Host dir bind-mounted to `/home/computeruse/workspace`
- `instructions` — Scope of responsibilities, injected as "## Responsibilities" in CLAUDE.md
- `mcpServers` — List of MCP names from registry (e.g. `["playwright"]`)

### MCP Registry

Two types in `backend/agents/services/provision.py`:
- **Bundled**: pre-installed in agent image (e.g. `computer-use`)
- **npx**: downloaded at runtime (e.g. `playwright` via `npx @playwright/mcp@latest`)

### Testing via CLI

Django management commands need env vars from Docker Compose, so run them inside the container:
```bash
docker compose exec backend uv run python manage.py migrate
docker compose exec backend uv run python manage.py check
```

GraphQL testing requires Bearer auth:
```bash
# Login
curl -s localhost:8000/graphql -H 'Content-Type: application/json' \
  --data-raw '{"query":"mutation { login(input: { username: \"vahid\", password: \"testpass123\" }) { token } }"}'

# Use token
curl -s localhost:8000/graphql -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' --data-raw '{"query":"..."}'
```

## Tooling

- **Python**: `uv` for package management (`uv run`, `uv sync`, `uv pip`)
- In Docker containers, always use `uv run` to execute Python commands
