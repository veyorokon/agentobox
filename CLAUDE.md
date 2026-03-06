# Agentobox

## Local Dev

```bash
docker compose up -d          # postgres, redis, backend, dashboard
```

- Dashboard: http://localhost:5051
- Backend GraphQL: http://localhost:8000/graphql

### Test credentials

- Username: `demo`
- Password: `demo`

## CI/CD

- Agent image workflow: `.github/workflows/agent-image.yml`
- Dev builds: push to `main` with `agent/` changes -> `:main` + `:sha-xxx`
- Release builds: push `v*` tag -> `:latest` + `:v1.2.3`
- Image: `ghcr.io/deleganceai/agentobox-agent-claude` (private, Modal pulls via `ghcr-secret`)

## Documentation

- `docs/FOUNDATIONS.md` — Product axioms, principles, design decisions, open questions
- `docs/ARCHITECTURE.md` — Technical reference: system architecture, patterns, services, models
- `docs/REFERENCE.md` — Auto-generated from codebase docstrings and annotations. Regenerate with `make docs`.
- `docs/DASHBOARD-UX-SPEC.md` — UX framework, feature inventory, component hierarchy
- `docs/archive/` — Historical research (experiments, binary analysis, Crush comparison)

Read FOUNDATIONS before making product-level decisions. Read ARCHITECTURE before writing backend code, adding hook interceptions, or modifying agent provisioning. Read DASHBOARD-UX-SPEC before frontend work.

## Architecture

- **backend/**: Django 6.0 + Strawberry GraphQL + Daphne (all environments)
- **dashboard/**: Next.js + Apollo Client + Zustand + Tailwind CSS v4
- **agent/**: Debian bookworm + s6-overlay image with AwesomeWM, Firefox, noVNC, Claude Code hooks. Uses `rootfs/` convention — all container files under `agent/rootfs/` at their actual filesystem paths.
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
- `make test` — Run backend tests in Docker.
- `make test-local` — Run backend tests locally via uv.
- `make lint` — Run ruff (backend) + next lint (dashboard).
- `make seed` — Seed dev data (demo user, agents, feed items, secrets). Run once after fresh DB.
- `make docs` — Regenerate `docs/REFERENCE.md` from codebase.

## Dogfooding vs Production

**Dogfooding** = using agentobox to build agentobox. The team lead is Claude Code on the host, agents work on this repo, and the dashboard being tested IS agentobox's own dashboard. This is the dev workflow — not the general product.

**Production** = customers use agentobox to build their own projects. Agents work on the customer's codebase. The agentobox dashboard is just the control plane — agents never interact with it. Agents only need to reach: (1) each other (team comms), (2) the agentobox backend (hook callbacks).

Key implications:
- **Networking**: Don't design agent networking around reaching "the dashboard." In prod, agents have no reason to talk to agentobox's dashboard. Agent-to-agent and agent-to-backend are the real requirements.
- **QA testing**: In dogfooding, QA tests `localhost:5051` (our dashboard). In prod, QA tests the customer's app — which could need any stack. QA either runs unit tests (no infra needed), the customer provides a preview URL, or the platform provides ephemeral environments (future PaaS-like feature).
- **Workspace mounts**: In dogfooding, agents mount this repo. In prod, agents mount the customer's project (Docker bind mount or Modal named volume).
- **Don't let dogfooding specifics leak into the product.** If a feature only makes sense because we're building agentobox with agentobox, it doesn't belong in the platform.

## Standing Up an Agent Team (Dev / Dogfooding)

The team lead is Claude Code on the host. Agents are Docker containers visible in the dashboard.

### Sequence

1. `docker compose up -d` — backend, dashboard, postgres, redis
2. Login via GraphQL to get a Bearer token
3. `createAgent` mutation per agent — each gets a `name` (role), `runtime: "docker"`, `workspacePath` (host project dir), `instructions` (responsibilities), and optional `mcpServers`
4. Agents boot, mount the workspace, get CLAUDE.md with their responsibilities, and start Claude Code in team mode
5. Team lead dispatches tasks via `sendMessage` mutation
6. Hook events flow from containers back to the backend — dashboard shows status, events, and VNC streams
7. All agents share the same mounted codebase — one agent's file edits are immediately visible to others

### Agent roles (dogfooding only)

| Agent | Responsibilities |
|-------|-----------------|
| `backend` | Django models, services, runtimes, GraphQL schema |
| `frontend` | Next.js dashboard, components, stores, GraphQL client, UI/UX |
| `qa` | Deploy test agents, run verification checklists, Playwright testing |

### Key fields on createAgent

- `name` — Role identifier visible to teammates for task routing
- `workspacePath` — Host dir bind-mounted to `/home/agent/workspace`
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
  --data-raw '{"query":"mutation { login(input: { username: \"demo\", password: \"demo\" }) { token } }"}'

# Use token
curl -s localhost:8000/graphql -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' --data-raw '{"query":"..."}'
```

## Debugging — Consult Logs First

When debugging agent behavior, message delivery, or relay issues, **always check the actual logs** before theorizing. Every component has accessible logs:

- **Backend**: `docker compose logs backend --since=2m 2>/dev/null | grep -iE "keyword"` — look for `relay_ws_connected`, `relay_ws_disconnected`, `message_sent`, `error_agent_reaped`, `stream_event`
- **Agent container**: `docker exec <container_id> bash -c "cat /run/uncaught-logs/current"` — relay.py stdout/stderr, s6 service logs
- **Relay process inside container**: `docker logs <container_id>` or read `/run/uncaught-logs/current` inside the container
- **Dashboard**: Browser console, or Playwright `browser_console_messages` — GraphQL errors, subscription events
- **Redis Channels**: `docker compose exec redis redis-cli PUBSUB CHANNELS '*'` — check for stale channel groups

Trace the full chain: dashboard mutation → backend log → Channels push → relay WS → Claude Code process. The bug is always where the chain breaks.

## Tooling

- **Python**: `uv` for package management (`uv run`, `uv sync`, `uv pip`)
- In Docker containers, always use `uv run` to execute Python commands

### Uploading screenshots to GitHub issues

macOS screenshot filenames contain a Unicode narrow no-break space (`U+202F`) before AM/PM that breaks most CLI tools (cp, gh, etc.). The file shows up in `ls` but fails in every other command.

```bash
# Diagnose: look for 3-byte sequence e2 80 af before "PM"
ls Screenshot* | xxd | head

# Fix: strip non-ASCII chars from filenames
for f in Screenshot*; do
  mv "$f" "$(echo "$f" | LC_ALL=C tr -dc 'a-zA-Z0-9._-')"
done

# Upload to GitHub issue (uses gh-attach extension)
# Install once: gh extension install atani/gh-attach
gh attach --issue <num> --image /path/to/file.png --release --body "description"
```

`--release` mode uses GitHub Releases API (CLI auth only, no browser needed). Creates a `gh-attach-assets` release tag in the repo for hosting the images.

@AGENTS.md
