#!/bin/bash
set -e

NETWORK="agentobox"
AGENTO_NAME="abox-agento"
AGENTO_IMAGE="agentobox-agento"
WORKER_IMAGE="agentobox-agent"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Creating Docker network '${NETWORK}' (if needed)"
docker network inspect "$NETWORK" >/dev/null 2>&1 || \
    docker network create "$NETWORK"

echo "==> Building worker image '${WORKER_IMAGE}'"
docker build \
    --platform linux/amd64 \
    -t "$WORKER_IMAGE" \
    -f "$PROJECT_DIR/docker/Dockerfile" \
    "$PROJECT_DIR"

echo "==> Building agento image '${AGENTO_IMAGE}'"
docker build \
    --platform linux/amd64 \
    -t "$AGENTO_IMAGE" \
    -f "$PROJECT_DIR/docker/Dockerfile.agento" \
    "$PROJECT_DIR"

echo "==> Stopping existing Agento (if running)"
docker rm -f "$AGENTO_NAME" 2>/dev/null || true

echo "==> Starting Agento"
docker run -d \
    --platform linux/amd64 \
    --name "$AGENTO_NAME" \
    --network "$NETWORK" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e ABOX_AGENTO_HOSTNAME="$AGENTO_NAME" \
    -e ABOX_NETWORK="$NETWORK" \
    -e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
    -e "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}" \
    "$AGENTO_IMAGE"

echo ""
echo "Agento started."
echo "  Attach:   docker exec -it -u abox $AGENTO_NAME tmux attach -t agento"
echo "  Logs:     docker logs -f $AGENTO_NAME"
