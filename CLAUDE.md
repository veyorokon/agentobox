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

## Tooling

- **Python**: `uv` for package management (`uv run`, `uv sync`, `uv pip`)
- In Docker containers, always use `uv run` to execute Python commands
