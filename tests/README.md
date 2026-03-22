# Tests

This document is the canonical test taxonomy for the repo.

The repo has three Python test authorities:
- root `pyproject.toml`
  - e2e, smoke, and system-level markers
- `backend/pyproject.toml`
  - backend `unit`, `integration`, `chaos`, `invariant`
- `agent/pyproject.toml`
  - agent `contract` and `docker_contract`

Use this file to decide where a new test belongs before adding it.

Harnesses are documented separately in [bin/README.md](../bin/README.md).
Use `bin/` for deployed-equivalent proof rigs and operator/debug scripts, not
for normal automated test layers.

## Smoke vs Canary

Use these terms precisely:

- `smoke`
  - a test layer
  - minimal end-to-end proof of a critical path
- `canary`
  - a deployment context
  - selected smoke scenarios run automatically against a real remote environment after deploy

Canaries are composed of smoke scenarios, but not all smoke tests are canary runs.

Do not call a test a `canary` unless it is part of a real post-deploy remote verification run.

## Test Layers

| Type | Location | Runs on | What it proves |
|------|----------|---------|----------------|
| `unit` | `backend/**/tests/`, most `agent/tests/` | host | cheap local behavior |
| `invariant` | `backend/agents/tests/test_*architecture*.py` | host | architecture and naming rules |
| `contract` | `agent/tests/test_*contract*.py`, `agent/tests/test_bootstrap.py` | host or Docker | runtime-visible boot and file contracts |
| `integration` | `backend/**/tests/`, `tests/integration/` | host → live services | real component wiring |
| `smoke` | `tests/smoke/` | host → full stack | critical end-to-end path |
| `canary` | post-deploy harness/workflow using selected smoke scenarios | real remote environment | deploy health in a live non-prod environment |
| `e2e` | `tests/e2e/` | host → browser + services | user-facing flows |
| `chaos` | backend chaos tests | host | degraded and recovery behavior |

### Boundary Rules

Use the earliest honest level that can prove the seam.

- `unit`
  - pure local logic or small component behavior
  - no real cross-process or runtime-visible contract
- `contract`
  - one subsystem boundary with a stable external shape
  - file paths, status documents, bootstrap contracts, image/runtime-visible behavior
- `integration`
  - multiple real components wired together in a controlled local/test environment
  - honest service collaboration without requiring a deployed remote environment
- `smoke`
  - the minimum end-to-end scenario proving a critical product path
  - narrow and diagnosis-first
- `e2e`
  - broader user-facing flows, often browser-driven
  - allowed to prove UI behavior across multiple steps, not just basic liveness
- `canary`
  - remote post-deploy execution context for selected smoke scenarios
  - used to confirm environment health, not to replace local discovery

If a test mainly proves a runtime-visible file/env/status contract, it is a `contract` test even if it lives in `agent/tests/`.
If a check requires operator coordination, real remote state, or deployed-equivalent proof, prefer a harness in `bin/` over forcing it into `tests/`.

## Quick Start

```bash
# Install test deps
uv sync --group e2e

# Start the stack
docker compose up -d && make seed

# Run each layer
make test-backend-unit
make test-invariant
make test-backend-integration
make test-backend-chaos
make test-agent-unit
make test-agent-contract
make test-agent-runtime-docker-contract
make test-integration
make test-smoke
make test-e2e
make test-e2e-full
```

## Directory Structure

```text
tests/
  README.md
  diagnosis.py                  # shared CI failure diagnosis helper
  test_diagnosis_schema.py      # schema shape enforcement
  integration/
    conftest.py
    test_relay_ws.py
  smoke/
    conftest.py
    test_agent_smoke.py
  e2e/
    conftest.py
    helpers/
      graphql.py
      docker_ops.py
      polling.py
    lifecycle/                  # agent boot, error capture, message delivery
    messaging/                  # (placeholder for future messaging e2e)
    dashboard/                  # (placeholder for future dashboard e2e)
    control/                    # (placeholder for future control e2e)
```

## Backend Tests

| Marker | Purpose |
|--------|---------|
| `unit` | cheap local behavior |
| `integration` | real DB/Redis/service wiring |
| `chaos` | failure injection and degraded paths |
| `invariant` | architecture and policy rules |

## Agent Contract Tests

Agent contract tests prove runtime-visible contracts:
- managed bootstrap contract
- Docker-managed image contract
- readiness and status projection contracts

Rule of thumb:

- use `contract` when the failure mode is drift between independently maintained components
- use `unit` when the failure is internal logic only

`docker_contract` is the narrow opt-in subset that builds and runs the real
managed image.

## Integration Tests

Real services, no mocks. Tests run on the host and connect to `localhost:8000`
(backend) via httpx and websockets. The docker compose stack is the system
under test.

### How It Works

Tests impersonate the relay by connecting directly to the backend WS endpoint
with a seeded relay token. No agent container is needed for WS-level tests.

```text
pytest (host) -> /ws/relay/{id}/ -> RelayConsumer -> Redis Channels
pytest (host) -> /graphql       -> query feed / agent status
```

## E2E Tests

Full stack tests including browser automation via Playwright.

`smoke` and `e2e` are different test types, not a containment hierarchy.

- `smoke` should answer: "is the critical path alive?"
- `e2e` should answer: "does the user-visible flow behave correctly?"

Smoke tests may carry `e2e` markers for pytest selection convenience,
but they remain smoke tests by taxonomy.

### Marker Gating

Expensive tests are gated by markers. Default `addopts` excludes `agent` and
`dashboard`, so `pytest` alone runs only the cheap e2e subset.

```python
pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]
```

### One Code Path

Real services, no stubs. Tests hit the actual backend, spawn actual Docker
containers, and verify actual state transitions. Test what you ship.

## Dev Canary Plan

Canaries are smoke scenarios run as post-deploy verification against the
real `dev.agentobox.com` environment. They execute automatically in the
deploy pipeline after `agent-bootstrap` and `agent-smoke` gates.

### Scenario Set

| Scenario | Smoke test | Canary gate | What it proves | Proof level |
|----------|-----------|-------------|----------------|-------------|
| Fresh agent boot | `test_agent_boot.py` | `agent-bootstrap` in deploy.yml | provisioning → relay → idle | live |
| Message round-trip | `test_agent_smoke.py` | `agent-smoke` in deploy.yml | send → LLM → feed response | live |
| Theme convergence | — | not yet wired | canonical theme → runtime derived files match | — |
| Browser dock launch | — | not yet wired | Chromium launches from desktop dock | — |
| Incident capture | `test_agent_smoke.py` | `agent-smoke` in deploy.yml | captureIncident → stored bundle with expected structure | live |

### What runs today

```
deploy → agent-bootstrap → agent-smoke
```

`agent-bootstrap` runs `test_agent_boot.py::TestAgentBoot` against the
deployed environment. `agent-smoke` runs `tests/smoke/` for a full
message round-trip. Both use diagnosis artifacts on failure.

### Proof/close criteria

A canary run proves:

- the deployed environment is healthy at the tested seam
- the exact shipped image + config can complete the scenario end-to-end
- if it fails, the diagnosis artifact names the first broken step

A canary does NOT prove:

- local-only bugs (use unit/contract tests)
- exhaustive coverage (use e2e tests)
- long-running stability (use monitoring)

### Adding a new canary scenario

1. Write the scenario as a smoke test in `tests/smoke/` or `tests/e2e/`.
2. Gate it behind appropriate markers.
3. Wire it into `deploy.yml` as a post-deploy job if it should run on
   every deploy.
4. Add it to the scenario table above.
5. Ensure it emits a diagnosis artifact on failure.

### Future scenarios

Theme convergence and browser dock launch are candidates for future
canary wiring. Theme convergence could verify that
`applied.theme_fingerprint` matches `desired.theme_fingerprint` via
the incident bundle. Browser dock launch needs either Playwright or
a runtime-side observation mechanism.

## Related Docs

- [Testing taxonomy](../docs/testing.md)
- [Operational contracts](../docs/contracts/README.md)
- [Harnesses](../bin/README.md)
