#!/bin/bash
set -e

# ── Fix docker socket permissions ────────────────────────────────────────────
if [ -S /var/run/docker.sock ]; then
    chmod 666 /var/run/docker.sock 2>/dev/null || true
fi

# ── Copy orchestrator config to workspace ────────────────────────────────────
cp /opt/agentobox/agento/CLAUDE.md "${ABOX_WORKSPACE}/CLAUDE.md"
cp /opt/agentobox/agento/.mcp.json "${ABOX_WORKSPACE}/.mcp.json"

# ── Pre-seed Claude Code config (skip onboarding, approve auth) ──────────────
OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
API_KEY="${ANTHROPIC_API_KEY:-}"

if [ -n "$OAUTH_TOKEN" ]; then
    # OAuth mode — no customApiKeyResponses needed
    cat > /home/abox/.claude.json <<CEOF
{
  "shiftEnterKeyBindingInstalled": true,
  "theme": "dark",
  "hasCompletedOnboarding": true
}
CEOF
else
    # API key mode — pre-approve key fingerprint
    KEY_LAST20="${API_KEY: -20}"
    cat > /home/abox/.claude.json <<CEOF
{
  "customApiKeyResponses": {
    "approved": $([ -n "$KEY_LAST20" ] && echo "[\"$KEY_LAST20\"]" || echo "[]"),
    "rejected": []
  },
  "shiftEnterKeyBindingInstalled": true,
  "theme": "dark",
  "hasCompletedOnboarding": true
}
CEOF
fi

# ── Write Stop hook (signals up to user/watcher) ────────────────────────────
mkdir -p /home/abox/.claude
AGENTO_HOST="${ABOX_AGENTO_HOSTNAME:-host.docker.internal}"
cat > /home/abox/.claude/settings.json <<SEOF
{
  "permissions": {
    "deny": [
      "MCP(agent-manager)(wait_for_completion)",
      "MCP(agent-manager)(wait_for_output)",
      "MCP(agent-manager)(screenshot_terminal)"
    ]
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://${AGENTO_HOST}:9900/event -H 'Content-Type: application/json' -d '{\"agent\":\"agento\",\"state\":\"completed\",\"msg\":\"\"}'",
            "async": true
          }
        ]
      }
    ]
  }
}
SEOF

# ── Fix ownership ────────────────────────────────────────────────────────────
chown -R abox:abox "${ABOX_WORKSPACE}" /home/abox/.claude /home/abox/.claude.json

# ── Launch Claude Code in tmux ───────────────────────────────────────────────
runuser -u abox -- bash -c \
    "tmux new-session -d -s agento -x 220 -y 50 && \
     tmux send-keys -t agento 'cd ${ABOX_WORKSPACE} && claude --dangerously-skip-permissions' Enter"

echo "[agento] Waiting for Claude Code bypass prompt..."

# Wait for bypass prompt, then accept it (same as worker bootstrap)
for i in $(seq 1 60); do
    OUTPUT=$(runuser -u abox -- tmux capture-pane -p -t agento 2>/dev/null || true)
    if echo "$OUTPUT" | grep -qi "bypass"; then
        sleep 1
        runuser -u abox -- tmux send-keys -t agento Down
        sleep 0.5
        runuser -u abox -- tmux send-keys -t agento Enter
        echo "[agento] Bypass prompt accepted."
        break
    fi
    sleep 1
done

# Wait for interactive prompt
for i in $(seq 1 30); do
    OUTPUT=$(runuser -u abox -- tmux capture-pane -p -t agento 2>/dev/null || true)
    if echo "$OUTPUT" | grep -qi "try"; then
        echo "[agento] Claude Code is ready."
        break
    fi
    sleep 1
done

# Keep container alive
tail -f /dev/null
