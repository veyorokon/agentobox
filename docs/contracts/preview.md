# Preview Contract

## Owner

Backend serializer/GraphQL layer for derivation, dashboard client for rendering.

## Source Of Truth

- backend-derived `previewState`
- backend-derived `previewRuntimeId`

The dashboard consumes that contract. It does not invent its own lifecycle
truth from VNC, websocket, or React state.

## Inputs

- lifecycle state
- runtime status projection
- runtime identity (`sandbox_id`)

## Outputs

- `previewState`
- `previewRuntimeId`

## Invariants

- `previewState` is derived by the backend, not guessed by the client.
- `previewRuntimeId` changes only when the runtime identity changes.
- The client must fully reset the live surface when `previewRuntimeId` changes.
- Retries only happen while the backend still says preview is ready.
- Redeploy is treated as an in-flight lifecycle state, not a UI-local spinner.

## Enforcing Tests

- `backend/agents/tests/test_serializers.py`
- `dashboard/__tests__/vnc-thumbnail.test.ts`
- `dashboard/__tests__/hooks.test.ts`
- `dashboard/__tests__/state-consistency.test.ts`
