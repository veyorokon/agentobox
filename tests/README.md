# Tests

System-level tests that exercise the full agentobox stack. Separate from
Django unit tests in `backend/agents/tests/` and agent contract tests in
`agent/tests/`.

## Test Layers

| Layer | Location | Runs on | What it tests |
|-------|----------|---------|---------------|
| Unit | `backend/agents/tests/` | Host (pytest-django) | Models, adapters, services, architecture |
| Agent contract | `agent/tests/` | Inside agent container | Relay modules, event shapes, security |
| **Integration** | `tests/integration/` | Host → live services | WS relay, message delivery, permissions |
| **E2E** | `tests/e2e/` | Host → browser + services | Dashboard UX, agent lifecycle, Playwright |

## Quick Start

```bash
# Install test deps
uv sync --group e2e

# Start the stack
docker compose up -d && make seed

# Run each layer
make test                # Django unit tests (in container)
make test-agent          # Agent contract tests (in agent image)
make test-integration    # Integration tests (against live stack)
make test-e2e            # E2E tests (cheap only, no agents/browser)
make test-e2e-full       # E2E tests (everything)
```

## Directory Structure

```
tests/
  README.md
  integration/
    conftest.py            # Auth, stack health check, project/agent fixtures
    helpers.py             # DB access via docker exec (relay tokens, status)
    test_relay_ws.py       # Relay WS auth, event delivery, downstream commands
  e2e/
    conftest.py            # Root fixtures: auth, gql client, docker, project
    helpers/
      graphql.py           # AboxGraphQL client (httpx, sync)
      docker_ops.py        # Container find/kill/exec/logs helpers
      polling.py           # poll_until, poll_agent_status, poll_feed_for
    lifecycle/             # Agent creation, error capture, status transitions
    messaging/             # Message delivery, routing, feed items
    dashboard/             # Playwright browser tests
    control/               # Supervised mode, permissions, plans
```

---

## Integration Tests

Real services, no mocks. Tests run on the host and connect to `localhost:8000`
(backend) via httpx and websockets. The docker compose stack IS the system
under test.

### Domains

| Domain | File | Chain tested |
|--------|------|-------------|
| Relay WS | `test_relay_ws.py` | pytest → WS → RelayConsumer → auth/events/commands |
| Message delivery | (planned) | sendMessage → Channels → relay WS → agent |
| Permissions | (planned) | permission event → callback → dashboard → relay reply |
| Provisioning | (planned) | createAgent → container boot → relay connect → status |

### How it works

Tests impersonate the relay by connecting directly to the backend's WS
endpoint with a seeded relay token. No agent container needed for WS-level
tests — the test IS the relay client.

```
pytest (host) ──ws──→ localhost:8000/ws/relay/{id}/ ──→ RelayConsumer
                                                         ↓
                                                    Redis Channels
                                                         ↓
pytest (host) ──gql──→ localhost:8000/graphql ──→ query feed/agent status
```

### Fixtures

| Fixture | Scope | What it provides |
|---------|-------|-----------------|
| `_check_stack` | session | Skips all tests if backend is unreachable |
| `auth_token` | session | Bearer token from demo login |
| `gql` | function | Fresh GraphQL client |
| `test_project` | module | Throwaway project, cleaned up after |
| `agent_with_token` | function | Agent with known relay_token for WS testing |
| `relay_ws_url` | function | Base WS URL for relay connections |

---

## E2E Tests

Full stack tests including browser automation via Playwright.

### Fixture Scoping

| Scope | Fixtures | Rationale |
|-------|----------|-----------|
| session | `auth_token`, `docker_client`, `backend_health` | One login, one docker connection per run |
| module | `test_project`, `browser_context` | One project per test file, one browser per file |
| function | `gql`, `test_agent`, `dashboard_page` | Fresh state per test |

### Marker Gating

Expensive tests are gated by markers. Default `addopts` excludes `agent` and
`dashboard` markers so `pytest` alone runs only cheap tests.

```python
pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]
```

### Polling Pattern

Async state transitions use `poll_until`:

```python
from helpers.polling import poll_agent_status, poll_feed_for

agent = poll_agent_status(gql, agent_id, ["idle", "running"], timeout_s=90)
item = poll_feed_for(gql, project_id, lambda i: i["type"] == "error", timeout_s=30)
```

### One Code Path

Real services, no stubs. Tests hit the actual backend, spawn actual Docker
containers, and verify actual state transitions. Test what you ship.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ABOX_API_URL` | `http://localhost:8000/graphql` | Backend GraphQL endpoint |
| `ABOX_WS_URL` | `ws://localhost:8000` | Backend WebSocket base URL |
| `ABOX_DASH_URL` | `http://localhost:5051` | Dashboard URL (Playwright tests) |
| `ABOX_TEST_USER` | `demo` | Login username |
| `ABOX_TEST_PASS` | `demo` | Login password |
