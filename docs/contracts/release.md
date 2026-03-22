# Release Contract

## Owner

CI/CD.

## Source Of Truth

- GitHub Actions workflows in `.github/workflows/`
- immutable sha-tagged image refs

## Inputs

- source commit
- built image refs
- explicit release manifest ref
- environment config and secrets

## Outputs

- tested backend image ref
- tested dashboard image ref
- tested agent desktop image ref
- deployed dev environment using those same refs
- promoted prod environment using those same refs

## Invariants

- Build once, test the built artifact, deploy the same artifact.
- Prod promotion must resolve artifact identity from an explicit manifest ref, not git ancestry or branch movement.
- Agent image used by deploy must be the same sha image proven in CI.
- Smoke must validate the same product path that deploy relies on.
- Security lanes must be explicit about their scope.

## Promotion Flow

1. merge code to `dev`
2. let the `dev` deploy finish green
3. choose the exact manifest ref emitted by `deploy-dev.yml`
4. run `promote-prod.yml(manifest_ref=...)`
5. after successful promotion, open / merge the bookkeeping PR to `main`

`main` records what is in prod. It is not the control surface that decides prod artifact identity.

## Enforcing Tests

- `.github/workflows/agent-image.yml`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/promote-prod.yml`
- deployed bootstrap and smoke jobs
