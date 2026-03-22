# Production Bootstrap

This runbook is the first-pass checklist for bringing up the `prod` environment.

It is intentionally grounded in the current `dev` setup and current CI/CD workflow.
Use it to make prod real end to end before treating `main` as a normal promotion target.

## Current Reality

As of March 22, 2026:

- `deploy.yml` supports `main -> prod`
- the GitHub `prod` environment is not configured
- `infra/environments/prod` was missing and is now scaffolded
- `agentobox.com` is not yet resolving

So this runbook is not a cleanup nicety. It is the missing environment bootstrap path.

## Goal

Make this true:

1. `main` is a valid production promotion branch
2. GitHub Actions has the required `prod` secrets and variables
3. `agentobox.com` resolves to a real host
4. OAuth works on the prod domain
5. the first prod deploy can pass:
   - `Validate Secrets`
   - `Deploy`
   - `Agent Bootstrap`
   - `Agent Smoke`

## Source Of Truth

- [`deploy.yml`](../../.github/workflows/deploy.yml)
- [`README.md`](../../README.md)
- [`app_config.py`](../../backend/config/app_config.py)
- [`infra/environments/prod/main.tf`](../../infra/environments/prod/main.tf)

## Checklist

### 1. Provision prod infrastructure

- Create/apply the `prod` Terraform environment.
- Confirm the prod host exists and is reachable by SSH.
- Confirm the prod database exists and `DATABASE_URL` is available.

Expected outputs:

- public IP
- SSH access
- database URI

### 2. Wire DNS

- Point `agentobox.com` at the prod host
- decide whether `www.agentobox.com` should also resolve or redirect
- verify:
  - `dig +short agentobox.com`
  - `curl -I https://agentobox.com`

### 3. Create the GitHub `prod` environment

Add GitHub environment:

- `prod`

Required secrets:

- `APP_SECRETS`
- `DEPLOY_HOST`
- `DEPLOY_SSH_KEY`

Required variables:

- `APP_CONFIG`

Optional:

- `TFVARS`

### 4. Populate `APP_CONFIG`

Start from the current `dev` shape and replace values with prod ones.

Minimum expected keys:

```json
{
  "DOMAIN": "agentobox.com",
  "VERSION": "main",
  "AGENT_VERSION": "main",
  "MODAL_ENVIRONMENT": "main",
  "MEDIA_BUCKET": "agentobox-media",
  "MEDIA_CDN_URL": "",
  "GOOGLE_CLIENT_ID": "<prod-google-client-id>",
  "GITHUB_CLIENT_ID": "<prod-github-client-id>",
  "AGENT_RUNTIME": "modal",
  "SMOKE_TEST_USER": "demo"
}
```

Notes:

- `DOMAIN` must be the prod domain the workflow deploys to.
- `MODAL_ENVIRONMENT` should match the real production Modal environment name.
- `SMOKE_TEST_USER` must correspond to a real bootstrap/smoke user in prod.

### 5. Populate `APP_SECRETS`

Minimum required prod secrets:

- `DATABASE_URL`
- `SECRET_KEY`
- `ABOX_ENCRYPTION_KEY`
- `DEPLOY_HOST` is separate GitHub environment secret, not part of `APP_SECRETS`
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_SECRET`

Potential additional provider secrets depending on runtime/product setup:

- `ANTHROPIC_API_KEY` if prod smoke or platform-managed usage needs it

Generate fresh production-only values for:

- `SECRET_KEY`
- `ABOX_ENCRYPTION_KEY`

Do not reuse local or dev values.

### 6. Configure OAuth providers for prod

#### Google

- create or reuse the prod OAuth app
- set authorized origin(s) for:
  - `https://agentobox.com`
- set redirect URI(s) for prod callback flow
- place the prod client id in `APP_CONFIG`
- place the prod client secret in `APP_SECRETS`

#### GitHub

- create or reuse the prod OAuth app
- set callback URL(s) for the prod domain
- place the prod client id in `APP_CONFIG`
- place the prod client secret in `APP_SECRETS`

### 7. Configure prod Modal environment

- confirm the prod Modal environment exists
- confirm the tokens in `APP_SECRETS` have access to that environment
- confirm `MODAL_ENVIRONMENT` matches the intended prod environment name
- confirm the agent image ref path is valid for prod deploys

### 8. Verify prod host prerequisites

On the target host:

- Docker and Docker Compose/plugin available
- deployment directory exists or can be created:
  - `/opt/agentobox`
- SSH user from GitHub Actions can write deploy artifacts there

### 9. Run first prod promotion

Promotion path:

1. merge `dev -> main`
2. watch `deploy.yml` on `main`

Required gates:

- `Validate Secrets`
- `CI`
- `Agent Image`
- `Agent Modal Contract (main)`
- `Deploy (main)`
- `Agent Bootstrap (prod)`
- `Agent Smoke (prod)`

### 10. Verify live prod surface

After the first successful deploy:

- `https://agentobox.com/graphql` responds
- dashboard loads
- login works via configured provider(s)
- smoke/bootstrap user path is valid
- one fresh agent can:
  - boot
  - relay-connect
  - complete one message round-trip

## Failure Modes To Expect

### `Validate Secrets` fails immediately

Most likely:

- `prod` environment missing in GitHub
- missing `APP_SECRETS`
- missing `APP_CONFIG`
- malformed JSON in one of those values
- missing required key like `DOMAIN`

### Deploy runs but site is unreachable

Most likely:

- DNS not configured
- `DEPLOY_HOST` wrong
- host not bootstrapped
- Caddy/TLS/bootstrap incomplete

### OAuth works in dev but not prod

Most likely:

- callback/origin URLs still point to `dev.agentobox.com`
- prod client id/secret not configured

### Bootstrap/smoke fail

Most likely:

- prod smoke user missing
- Modal prod environment/token mismatch
- runtime/provider secrets incomplete

## Minimal “Prod Exists” Definition

Prod should not be considered real until all of the following are true:

1. `agentobox.com` resolves
2. GitHub `prod` environment is populated
3. `main` deploy can run end to end
4. bootstrap and smoke pass against prod

Until then, `main -> prod` is only a configured workflow path, not an actual release path.
