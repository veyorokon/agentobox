#!/bin/bash
# Forward Claude Code hook events to agentobox control plane
[ -f "$HOME/.agent_env" ] && . "$HOME/.agent_env"
CALLBACK_URL="${ABOX_CALLBACK_URL:-}"
AGENT_ID="${AGENT_ID:-}"
[ -z "$CALLBACK_URL" ] || [ -z "$AGENT_ID" ] && exit 0

INPUT=$(cat)
BODY=$(echo "$INPUT" | jq -c --arg id "$AGENT_ID" '. + {agent_id: $id}')

RESPONSE=$(curl -sf -X POST "${CALLBACK_URL}/hooks/event" \
    -H "Content-Type: application/json" \
    -d "$BODY" 2>/dev/null) || exit 0

# SessionStart: persist env for subsequent hooks
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
if [ "$EVENT_NAME" = "SessionStart" ] && [ -n "$CLAUDE_ENV_FILE" ]; then
    echo "export AGENT_ID=\"$AGENT_ID\"" >> "$CLAUDE_ENV_FILE"
    echo "export ABOX_CALLBACK_URL=\"$CALLBACK_URL\"" >> "$CLAUDE_ENV_FILE"
fi

# Control plane feedback
MESSAGE=$(echo "$RESPONSE" | jq -r '.message // empty')
[ -n "$MESSAGE" ] && echo "{\"systemMessage\": \"$MESSAGE\"}"
exit 0
