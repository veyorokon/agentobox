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
- **agent/**: Docker image with AwesomeWM, Firefox, noVNC, Claude Code hooks
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

## Tooling

- **Python**: `uv` for package management (`uv run`, `uv sync`, `uv pip`)
- In Docker containers, always use `uv run` to execute Python commands
