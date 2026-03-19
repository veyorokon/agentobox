# Release Contract

## Owner

CI/CD.

## Source Of Truth

- GitHub Actions workflows in `.github/workflows/`
- immutable sha-tagged image refs

## Inputs

- source commit
- built image refs
- environment config and secrets

## Outputs

- tested backend image ref
- tested dashboard image ref
- tested agent desktop image ref
- deployed environment using those same refs

## Invariants

- Build once, test the built artifact, deploy the same artifact.
- Agent image used by deploy must be the same sha image proven in CI.
- Smoke must validate the same product path that deploy relies on.
- Security lanes must be explicit about their scope.

## Enforcing Tests

- `.github/workflows/agent-image.yml`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/deploy.yml`
- deployed bootstrap and smoke jobs
