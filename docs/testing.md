# Testing

Agentobox uses a layered test taxonomy so failures can be mapped to the
narrowest owning layer.

## Taxonomy

| Type | Scope | Primary location | Purpose |
|------|-------|------------------|---------|
| `unit` | pure logic / cheap behavior | `backend/**/tests`, most `agent/tests` by default | prove local behavior without live services |
| `invariant` | architecture and policy rules | `backend/agents/tests/test_*architecture*.py` | prevent abstraction bleed and naming drift |
| `integration` | multiple live components | `backend/**/tests` and `tests/integration/` | prove service wiring with real dependencies |
| `contract` | boundary and bootstrap contracts | `agent/tests/test_*contract*.py`, `agent/tests/test_bootstrap.py` | prove runtime-visible contracts and boot gates |
| `smoke` | critical path end to end | `tests/smoke/` | prove one real round trip through the shipped system |
| `chaos` | failure and recovery behavior | backend chaos tests | prove degraded paths and reconciler behavior |
| `security` | secrets, dependency, config policy | workflow lanes | prove shipped artifacts and infra meet policy |

## Marker Authority

- root `pyproject.toml`
  - e2e, smoke, and system-level markers
- `backend/pyproject.toml`
  - backend `unit`, `integration`, `chaos`, `invariant`
- `agent/pyproject.toml`
  - agent `contract` and `docker_contract`

## CI Mapping

| Lane | What it should prove |
|------|----------------------|
| `CI Fast` | unit, invariant, integration, lint, typecheck, app security |
| `CI Smoke` | docker-backed bootstrap plus one local-style round trip |
| `Agent Image` | managed runtime contract and tested agent image publication |
| `Deploy` | tested artifacts are deployed to the target environment |
| `Agent Bootstrap` | deployed runtime reaches `idle` |
| `Agent Smoke` | deployed runtime completes one deterministic round trip |
| `Security Infra` | infra policy is evaluated separately from app fast CI |

## Rules

- Put the cheapest test that can prove a contract at the owning layer.
- Do not make smoke tests carry unit or contract responsibilities.
- Every resolved production failure should add or update a regression at the
  narrowest enforcing layer.
- If a test needs a real container or live runtime boundary, call it a
  `contract` or `smoke` test explicitly.
