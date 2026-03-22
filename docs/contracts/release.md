# Release Contract

## Owner

CI/CD.

## Source Of Truth

- GitHub Actions workflows in `.github/workflows/`
- immutable sha-tagged image refs
- `.github/release-manifest.json` for the explicit prod promotion handoff

## Inputs

- source commit
- built image refs
- explicit release manifest ref
- environment config and secrets

## Outputs

- tested backend image ref
- tested dashboard image ref
- tested agent desktop image ref
- deployed environment using those same refs

## Invariants

- Build once, test the built artifact, deploy the same artifact.
- Prod promotion must resolve artifact identity from an explicit manifest ref, not git ancestry.
- Agent image used by deploy must be the same sha image proven in CI.
- Smoke must validate the same product path that deploy relies on.
- Security lanes must be explicit about their scope.

## Promotion Flow

1. merge code to `dev`
2. let the `dev` deploy finish green
3. run `bin/write-release-manifest` on `dev`
4. commit only `.github/release-manifest.json`
5. open / merge `dev -> main`
6. `main` deploy reads that exact manifest ref and promotes it

The release metadata commit exists only to carry the promotion contract.
It must not be used to infer artifact identity indirectly.

## Enforcing Tests

- `.github/workflows/agent-image.yml`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/deploy.yml`
- deployed bootstrap and smoke jobs
