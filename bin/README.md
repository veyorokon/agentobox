# Harnesses

`bin/` is the canonical home for repo harnesses.

Harnesses are not part of the normal automated test taxonomy. They are
purpose-built proof rigs for deployed-equivalent checks, operator workflows,
and seam-specific debugging where a normal unit/integration/smoke test would
either be dishonest or too heavy for CI.

## Tests vs Harnesses

- `tests/`
  - repeatable automated test layers
  - unit, invariant, contract, integration, smoke, e2e
  - should be reasonable to run in CI or as normal local test commands
- `bin/`
  - deployed-equivalent proof rigs
  - operator/debug scripts
  - can require real env vars, live services, or manual coordination
  - should still exit non-zero when the proof fails

If the work is asserting a reusable automated test contract, it belongs in
`tests/`.

If the work is proving one higher-level seam against a real environment or
topology, it belongs in `bin/`.

## Naming

Use:

- `bin/<topic>-<scope>`

Examples:

- `control-plane-continuity-local`
- `control-plane-continuity-modal`
- `modal-local-bootstrap`

Names should answer:

- what seam is being exercised
- what scope/environment it runs against

## Required Header Shape

Every harness should start with a short header that states:

1. what seam it exercises
2. what contract it is proving
3. what it does and does not prove
4. the main environment variables or prerequisites

Python harnesses should use a module docstring.
Shell harnesses should use a top-of-file comment block.

## Output Expectations

Harnesses should:

- print the key IDs and states they rely on
- print a concise PASS/FAIL summary
- exit non-zero on failed proof
- avoid hiding real failures behind partial success

## Current Harnesses

- `control-plane-continuity-local`
  - local Docker deployed-equivalent proof for control-plane restart continuity
- `control-plane-continuity-modal`
  - deployed-equivalent Modal proof for control-plane deploy continuity
- `modal-local-bootstrap`
  - local backend + Modal bootstrap proof helper
- `smoke-test.sh`
  - post-deploy HTTP/GraphQL smoke harness

## Current Operator Scripts

- `write-release-manifest`
  - writes `.github/release-manifest.json` for the exact dev artifact set that `main` should promote

## Non-Goals

- no generic harness framework
- no second test taxonomy
- no duplicate logic when a normal test is the honest place
