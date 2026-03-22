FROM python:3.12-slim

ARG AGENTOBOX_GIT_COMMIT=""
ARG AGENTOBOX_IMAGE_DIGEST=""
ARG AGENTOBOX_IMAGE_REF="agentobox-agent-runtime:latest"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AGENTOBOX_MODE=standalone \
    AGENTOBOX_PLATFORM=docker \
    AGENTOBOX_RUNTIME_PROFILE=core \
    AGENTOBOX_IMAGE_REF=${AGENTOBOX_IMAGE_REF} \
    AGENTOBOX_IMAGE_DIGEST=${AGENTOBOX_IMAGE_DIGEST} \
    AGENTOBOX_GIT_COMMIT=${AGENTOBOX_GIT_COMMIT} \
    AGENTOBOX_EXECUTOR=echo \
    AGENTOBOX_BIND_HOST=0.0.0.0 \
    AGENTOBOX_PORT=8080 \
    AGENTOBOX_ROOT_DIR=/var/lib/agentobox-agent

WORKDIR /app

# Install the new agent runtime as a real package. The image starts in
# standalone/echo mode on purpose; managed transport and Claude-specific
# layers can build on top of this base without reintroducing old shell glue.
COPY pyproject.toml ./
COPY __init__.py ./agent/__init__.py
COPY __main__.py ./agent/__main__.py
COPY main.py ./agent/main.py
COPY contracts ./agent/contracts
COPY platform ./agent/platform
COPY provisioning ./agent/provisioning
COPY runtime ./agent/runtime
COPY transports ./agent/transports

RUN pip install --no-cache-dir .

RUN mkdir -p /var/lib/agentobox-agent

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/livez')); raise SystemExit(0 if data.get('status') == 'ok' else 1)"

ENTRYPOINT ["agentobox-agent"]
