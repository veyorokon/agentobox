#!/bin/bash
# PostToolUse hook for TodoWrite
# Reads stdin JSON, extracts todo state, POSTs task + status to callback server

INPUT=$(cat)
CALLBACK_URL="${ABOX_CALLBACK_URL}"
AGENT="${ABOX_AGENT_NAME}"

[ -z "$CALLBACK_URL" ] || [ -z "$AGENT" ] && exit 0

TODOS=$(echo "$INPUT" | jq -r '.tool_input.todos // empty')
[ -z "$TODOS" ] && exit 0

# Find in_progress item's activeForm
ACTIVE=$(echo "$TODOS" | jq -r '[.[] | select(.status == "in_progress")] | first | .activeForm // empty')

# Check if all items are completed
TOTAL=$(echo "$TODOS" | jq -r 'length')
COMPLETED=$(echo "$TODOS" | jq -r '[.[] | select(.status == "completed")] | length')

if [ "$TOTAL" -gt 0 ] && [ "$TOTAL" = "$COMPLETED" ]; then
  # All todos completed → agent is done
  curl -s -X POST "$CALLBACK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"agent\":\"$AGENT\",\"state\":\"completed\",\"task\":\"$ACTIVE\",\"msg\":\"\"}" \
    >/dev/null 2>&1
elif [ -n "$ACTIVE" ]; then
  # Has in_progress item → working on this task
  # Escape quotes in activeForm for JSON safety
  SAFE_ACTIVE=$(echo "$ACTIVE" | sed 's/"/\\"/g')
  curl -s -X POST "$CALLBACK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"agent\":\"$AGENT\",\"state\":\"working\",\"task\":\"$SAFE_ACTIVE\"}" \
    >/dev/null 2>&1
fi

exit 0
