# Runtime Contract

## Owner

Agent runtime.

## Source Of Truth

- runtime process state
- service catalog and health projection
- `_abox/status.json`
- `/readyz`

## Inputs

- runtime configuration
- service supervision state
- relay transport state
- desktop service state

## Outputs

- runtime status projection
- service readiness
- structured runtime events

## Invariants

- Runtime liveness is owned by the runtime, not inferred by the UI.
- `/readyz` and `_abox/status.json` must reflect the same readiness model.
- Required desktop services must be marked explicitly in the service catalog.
- A runtime is not healthy just because the container exists.

## Enforcing Tests

- `agent/tests/test_health.py`
- `agent/tests/test_service_catalog.py`
- `agent/tests/test_status_schema.py`
- `agent/tests/test_managed_docker_contract.py`
