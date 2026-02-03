#!/bin/bash
# Runs as root during s6 init, after desktop is up.

echo "[agentobox] Starting computer-use MCP server (HTTP on :8808)..."

# Start MCP server as abc user with display access
s6-setuidgid abc \
    env DISPLAY=:1 MCP_TRANSPORT=http PORT=8808 \
    node /opt/agentobox/mcps/computer-use/dist/main.js &

echo "[agentobox] Ready."
echo "[agentobox]   Desktop: https://localhost:3001"
echo "[agentobox]   MCP:     http://localhost:8808/mcp"
