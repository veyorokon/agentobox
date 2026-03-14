#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-agentobox-agent-claude:ci}"
AGENT_ID="contract-agent"
TMPDIR="$(mktemp -d)"
CONTAINER_ID=""

cleanup() {
  if [ -n "${CONTAINER_ID}" ]; then
    docker rm -f "${CONTAINER_ID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

AGENT_VOL="${TMPDIR}/agents/${AGENT_ID}"
mkdir -p \
  "${AGENT_VOL}/_abox" \
  "${AGENT_VOL}/home/agent" \
  "${AGENT_VOL}/tmp/abox-theme" \
  "${AGENT_VOL}/run/secrets" \
  "${AGENT_VOL}/run/mcp-gateway" \
  "${AGENT_VOL}/mnt/abox-state"

touch "${AGENT_VOL}/_abox/inbox.jsonl" "${AGENT_VOL}/_abox/outbox.jsonl"
printf '0' > "${AGENT_VOL}/_abox/inbox.pos"
printf '0' > "${AGENT_VOL}/_abox/outbox.pos"
printf '{}' > "${AGENT_VOL}/_abox/status.json"
printf '{"mode":"auto","allowed_tools":[],"model":"claude-haiku-4-5-20251001"}' \
  > "${AGENT_VOL}/_abox/state.json"
touch "${AGENT_VOL}/_abox/provisioned.ready"

cat > "${AGENT_VOL}/home/agent/.relay_env" <<'EOF'
ABOX_CALLBACK_URL=http://127.0.0.1:9
RELAY_AUTH_TOKEN=test-relay-token
ANTHROPIC_API_KEY=test-anthropic-key
EOF

CONTAINER_ID="$(docker run -d --rm \
  -e AGENT_ID="${AGENT_ID}" \
  -e DISPLAY=":1" \
  -e RESOLUTION="1920x1080" \
  -v "${TMPDIR}:/vol" \
  "${IMAGE}")"

sleep 20

docker exec "${CONTAINER_ID}" test -f /home/agent/.relay_env
docker exec "${CONTAINER_ID}" bash -lc "source /home/agent/.relay_env && [ -n \"\${RELAY_AUTH_TOKEN:-}\" ]"
docker exec "${CONTAINER_ID}" curl -sf http://localhost:8080/livez >/dev/null
docker exec "${CONTAINER_ID}" curl -sf http://localhost:8080/status >/dev/null
docker exec "${CONTAINER_ID}" bash -lc "curl -sf http://localhost:8080/status | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get(\"ws_connected\") is False'"
docker exec "${CONTAINER_ID}" pgrep -f "uvicorn relay_http:app" >/dev/null

echo "agent runtime contract passed for ${IMAGE}"
