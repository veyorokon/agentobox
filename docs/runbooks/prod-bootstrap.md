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

Recommended first-pass template:

```json
{
  "DOMAIN": "agentobox.com",
  "VERSION": "main",
  "AGENT_VERSION": "main",
  "ENVIRONMENT": "prod",
  "ABOX_CALLBACK_URL": "https://agentobox.com/graphql",
  "ABOX_DASHBOARD_URL": "https://agentobox.com",
  "ALLOWED_HOSTS": "agentobox.com,www.agentobox.com",
  "CSRF_TRUSTED_ORIGINS": "https://agentobox.com,https://www.agentobox.com",
  "CORS_ALLOWED_ORIGINS": "https://agentobox.com,https://www.agentobox.com",
  "MODAL_ENVIRONMENT": "main",
  "MODAL_APP_NAME": "agentobox",
  "MEDIA_BUCKET": "agentobox-media",
  "MEDIA_CDN_URL": "",
  "GOOGLE_CLIENT_ID": "<prod-google-client-id>",
  "GITHUB_CLIENT_ID": "<prod-github-client-id>",
  "AGENT_RUNTIME": "modal",
  "SMOKE_TEST_USER": "demo"
}
```

Why these keys:

- `DOMAIN` is consumed directly by the deploy workflow.
- `ABOX_CALLBACK_URL` and `ABOX_DASHBOARD_URL` make the prod surface explicit instead of inheriting dev-ish defaults.
- `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, and `CORS_ALLOWED_ORIGINS` should be explicit for prod.
- `ENVIRONMENT=prod` keeps the app/runtime labeling honest.
- `MODAL_ENVIRONMENT` should match the real Modal environment name you decide to use for prod.

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

Recommended first-pass template:

```json
{
  "DATABASE_URL": "postgres://<user>:<password>@<host>:5432/<db>",
  "REDIS_URL": "redis://redis:6379/0",
  "SECRET_KEY": "<fresh-django-secret-key>",
  "ABOX_ENCRYPTION_KEY": "<fresh-fernet-compatible-key>",
  "MODAL_TOKEN_ID": "<prod-modal-token-id>",
  "MODAL_TOKEN_SECRET": "<prod-modal-token-secret>",
  "GOOGLE_CLIENT_SECRET": "<prod-google-client-secret>",
  "GITHUB_CLIENT_SECRET": "<prod-github-client-secret>",
  "SMOKE_TEST_PASS": "<prod-demo-password>"
}
```

Possible later additions:

- `ANTHROPIC_API_KEY`
- other provider keys if prod will run platform-managed usage
- any storage/provider secrets required by the final prod topology

Notes:

- `DATABASE_URL` is required by `AppConfig`; there is no valid prod deploy without it.
- `REDIS_URL` has a default, but it is better to make the real prod value explicit.
- `SMOKE_TEST_PASS` is optional in workflow code, but should be explicitly set for real prod canaries.
- `DEPLOY_HOST` and `DEPLOY_SSH_KEY` are separate GitHub environment secrets, not part of `APP_SECRETS`.

### 5a. Load values into the GitHub `prod` environment

The deploy workflow reads:

- `vars.APP_CONFIG`
- `secrets.APP_SECRETS`
- `secrets.DEPLOY_HOST`
- `secrets.DEPLOY_SSH_KEY`

The easiest clean path is to create local JSON files, then load them with `gh`.

Example:

```bash
cat > /tmp/agentobox-prod-app-config.json <<'EOF'
{
  "DOMAIN": "agentobox.com",
  "VERSION": "main",
  "AGENT_VERSION": "main",
  "ENVIRONMENT": "prod",
  "ABOX_CALLBACK_URL": "https://agentobox.com/graphql",
  "ABOX_DASHBOARD_URL": "https://agentobox.com",
  "ALLOWED_HOSTS": "agentobox.com,www.agentobox.com",
  "CSRF_TRUSTED_ORIGINS": "https://agentobox.com,https://www.agentobox.com",
  "CORS_ALLOWED_ORIGINS": "https://agentobox.com,https://www.agentobox.com",
  "MODAL_ENVIRONMENT": "main",
  "MODAL_APP_NAME": "agentobox",
  "MEDIA_BUCKET": "agentobox-media",
  "MEDIA_CDN_URL": "",
  "GOOGLE_CLIENT_ID": "<prod-google-client-id>",
  "GITHUB_CLIENT_ID": "<prod-github-client-id>",
  "AGENT_RUNTIME": "modal",
  "SMOKE_TEST_USER": "demo"
}
EOF

cat > /tmp/agentobox-prod-app-secrets.json <<'EOF'
{
  "DATABASE_URL": "postgres://<user>:<password>@<host>:5432/<db>",
  "REDIS_URL": "redis://redis:6379/0",
  "SECRET_KEY": "<fresh-django-secret-key>",
  "ABOX_ENCRYPTION_KEY": "<fresh-fernet-compatible-key>",
  "MODAL_TOKEN_ID": "<prod-modal-token-id>",
  "MODAL_TOKEN_SECRET": "<prod-modal-token-secret>",
  "GOOGLE_CLIENT_SECRET": "<prod-google-client-secret>",
  "GITHUB_CLIENT_SECRET": "<prod-github-client-secret>",
  "SMOKE_TEST_PASS": "<prod-demo-password>"
}
EOF
```

Then load them:

```bash
gh variable set APP_CONFIG --env prod < /tmp/agentobox-prod-app-config.json
gh secret set APP_SECRETS --env prod < /tmp/agentobox-prod-app-secrets.json
gh secret set DEPLOY_HOST --env prod
gh secret set DEPLOY_SSH_KEY --env prod < /path/to/prod-deploy-key
```

Verification:

```bash
gh variable list --env prod
gh secret list --env prod
```

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
