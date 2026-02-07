#!/bin/bash
# SessionStart hook: register agent with control plane

CALLBACK_URL="${ABOX_CALLBACK_URL:-}"
AGENT_ID="${AGENT_ID:-}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"

if [ -z "$CALLBACK_URL" ] || [ -z "$AGENT_ID" ]; then
    exit 0
fi

# Compute HMAC signature
BODY=$(jq -nc \
    --arg id "$AGENT_ID" \
    --arg type "session_start" \
    '{agent_id: $id, event_type: $type}')

SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

# POST registration to control plane
curl -sf -X POST "${CALLBACK_URL}/webhook/event" \
    -H "Content-Type: application/json" \
    -H "X-Signature: $SIGNATURE" \
    -d "$BODY" >/dev/null 2>&1 || true

# Persist env vars for subsequent hooks
if [ -n "$CLAUDE_ENV_FILE" ]; then
    echo "export AGENT_ID=\"$AGENT_ID\"" >> "$CLAUDE_ENV_FILE"
    echo "export ABOX_CALLBACK_URL=\"$CALLBACK_URL\"" >> "$CLAUDE_ENV_FILE"
    echo "export WEBHOOK_SECRET=\"$WEBHOOK_SECRET\"" >> "$CLAUDE_ENV_FILE"
fi
