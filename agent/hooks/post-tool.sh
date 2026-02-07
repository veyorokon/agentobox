#!/bin/bash
# PostToolUse hook: send heartbeat to control plane, check for inbound messages

CALLBACK_URL="${ABOX_CALLBACK_URL:-}"
AGENT_ID="${AGENT_ID:-}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"

if [ -z "$CALLBACK_URL" ] || [ -z "$AGENT_ID" ]; then
    exit 0
fi

# Read tool use JSON from stdin
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Build heartbeat payload
BODY=$(jq -nc \
    --arg id "$AGENT_ID" \
    --arg type "heartbeat" \
    --arg tool "$TOOL_NAME" \
    '{agent_id: $id, event_type: $type, data: {tool_name: $tool}}')

SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

# POST heartbeat, capture response
RESPONSE=$(curl -sf -X POST "${CALLBACK_URL}/webhook/event" \
    -H "Content-Type: application/json" \
    -H "X-Signature: $SIGNATURE" \
    -d "$BODY" 2>/dev/null) || exit 0

# Check for inbound messages in response
MESSAGE=$(echo "$RESPONSE" | jq -r '.message // empty')

if [ -n "$MESSAGE" ]; then
    echo "{\"systemMessage\": \"Message from control plane: $MESSAGE\"}"
fi
