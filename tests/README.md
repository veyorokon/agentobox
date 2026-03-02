# E2E Testing

System-level tests that exercise the full agentobox stack: backend, agents, dashboard.
Separate from Django unit tests in `backend/agents/tests/`.

## Quick Start

```bash
# Install e2e deps
uv sync --group e2e

# Start the stack
docker compose up -d

# Run cheap tests only (no agent spawning, no browser)
make test-e2e

# Run agent lifecycle tests (spawns real agents, costs money)
make test-e2e-agents

# Run Playwright dashboard tests
make test-e2e-dashboard

# Run everything
make test-e2e-full
```

## Directory Structure

Tests are organized by domain, not flat. Each domain has its own `conftest.py`
for domain-specific fixtures while inheriting root-level fixtures.

```
tests/
  e2e/
    conftest.py              # Root fixtures: auth, gql client, docker, project
    helpers/
      graphql.py             # AboxGraphQL client (httpx, sync)
      docker_ops.py          # Container find/kill/exec/logs helpers
      polling.py             # poll_until, poll_agent_status, poll_feed_for
    lifecycle/               # Agent creation, error capture, status transitions
    messaging/               # Message delivery, routing, feed items
    dashboard/               # Playwright browser tests
    control/                 # Supervised mode, permissions, plans
```

New test files go in the matching domain directory. New domains get their own
directory with `__init__.py` and `conftest.py`.

## Conventions

### Fixture Composition

Fixtures compose via dependencies, not base classes. A test that needs an agent
declares `test_agent` as a parameter — it automatically gets `gql`, `test_project`,
`docker_client`, and `auth_token` transitively.

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
# Module-level marker (applies to all tests in the file)
pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]
```

Run specific categories:
```bash
pytest -m "e2e and agent"       # Agent tests only
pytest -m "e2e and dashboard"   # Dashboard tests only
pytest -m "e2e"                 # Everything
```

### Health Checks

The `backend_health` session fixture hits the backend health endpoint before
any tests run. If the backend is unreachable, all tests skip with a clear
message instead of failing with connection errors.

### Polling Pattern

Async state transitions (agent deploying → running, error propagation) use
`poll_until`:

```python
from helpers.polling import poll_agent_status, poll_feed_for

# Wait for agent to reach a target status
agent = poll_agent_status(gql, agent_id, ["idle", "running"], timeout_s=90)

# Wait for a feed item matching a predicate
item = poll_feed_for(gql, project_id, lambda i: i["type"] == "error", timeout_s=30)
```

Always specify a timeout. Never `time.sleep()` in a loop manually.

### Cleanup

Yield fixtures handle cleanup in `finally` blocks. Cleanup is best-effort —
if the agent is already gone, the cleanup silently succeeds.

```python
@pytest.fixture
def test_agent(gql, test_project):
    agent = gql.create_agent(test_project["id"], name="test-agent")
    agent_id = agent["id"]
    try:
        yield agent
    finally:
        gql.kill_agent(agent_id)
        gql.remove_agent(agent_id)
```

### Docker Container Fixtures

Agent containers are found by label or naming convention. Before interacting
with a container, verify it's running. On test failure, capture container logs
for diagnostics.

### Self-Documenting Tests

Every test module has a docstring explaining:
- What pipeline/chain is under test
- How to run this specific file
- What infrastructure is required

### One Code Path

Real services, no stubs. Tests hit the actual backend, spawn actual Docker
containers, and verify actual state transitions. Test what you ship.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ABOX_API_URL` | `http://localhost:8000/graphql` | Backend GraphQL endpoint |
| `ABOX_DASH_URL` | `http://localhost:5051` | Dashboard URL (Playwright tests) |
| `ABOX_TEST_USER` | `demo` | Login username |
| `ABOX_TEST_PASS` | `demo` | Login password |
