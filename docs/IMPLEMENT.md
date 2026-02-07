
**Modal path:** VNC available via encrypted tunnel URL (HTTPS, no port mapping needed).
**Docker path:** VNC available via localhost port mapping.

### Environment Variables (Railway)

```bash
# Django service
SECRET_KEY=
DATABASE_URL=          # auto-injected by Railway Postgres plugin
REDIS_URL=             # auto-injected by Railway Redis plugin
ALLOWED_HOSTS=*.railway.app
ABOX_CALLBACK_URL=https://django-service.railway.app

# Modal
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=
MODAL_APP_NAME=agentobox
MODAL_AGENT_IMAGE=ghcr.io/veyorokon/agentobox-agent:latest

# Agent defaults
ANTHROPIC_API_KEY=
GITHUB_TOKEN=

# Security
WEBHOOK_SECRET=

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Railway auto-injects `DATABASE_URL` and `REDIS_URL` when you attach the plugins. No manual connection string management.
