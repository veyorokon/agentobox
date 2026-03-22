# Provisioning Contract

## Owner

Backend lifecycle and runtime bootstrap.

## Source Of Truth

- backend lifecycle services in `backend/agents/services/`
- runtime bootstrap/fsbridge in `agent/runtime/`
- canonical files under `_abox/`

## Inputs

- `relay_token`
- `sandbox_id`
- generated runtime files
- canonical provisioning files

## Outputs

- `_abox/relay.env`
- `_abox/state.json`
- `_abox/status.json`
- `_abox/provisioned.ready`

## Invariants

- The runtime must not proceed until provisioning is complete.
- `_abox/provisioned.ready` must belong to the current runtime attempt.
- The readiness release must match the current `RELAY_AUTH_TOKEN`.
- A stale sandbox or stale volume must not unblock a new runtime attempt.

## Enforcing Tests

- `backend/agents/tests/test_lifecycle.py`
- `backend/agents/tests/test_volume_architecture.py`
- `agent/tests/test_bootstrap.py`
- `agent/tests/test_managed_boot_contract.py`
- `agent/tests/test_fsbridge.py`
- `agent/tests/test_managed_docker_contract.py`
