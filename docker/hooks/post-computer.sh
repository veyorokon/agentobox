#!/bin/bash
# PostToolUse hook for computer-use computer tool
# Reads stdin JSON, extracts intent field, POSTs as msg to callback server

INPUT=$(cat)
CALLBACK_URL="${ABOX_CALLBACK_URL}"
AGENT="${ABOX_AGENT_NAME}"

[ -z "$CALLBACK_URL" ] || [ -z "$AGENT" ] && exit 0

INTENT=$(echo "$INPUT" | jq -r '.tool_input.intent // empty')
[ -z "$INTENT" ] && exit 0

# Escape quotes for JSON safety
SAFE_INTENT=$(echo "$INTENT" | sed 's/"/\\"/g')

curl -s -X POST "$CALLBACK_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"agent\":\"$AGENT\",\"state\":\"working\",\"msg\":\"$SAFE_INTENT\"}" \
  >/dev/null 2>&1

exit 0
