#!/bin/bash
set -e

# ── Disable VNC auth ────────────────────────────────────────────────────────
export VNCOPTIONS="-disableBasicAuth"

# ── Start Kasm desktop (VNC + desktop environment) ──────────────────────────
/dockerstartup/kasm_default_profile.sh
/dockerstartup/vnc_startup.sh &

# Wait for X11 display to be ready
echo "[agentobox] Waiting for X11 display..."
export DISPLAY=:1
for i in $(seq 1 30); do
    if xdotool getactivewindow &>/dev/null 2>&1; then
        echo "[agentobox] X11 display ready"
        break
    fi
    sleep 1
done

# ── Clean desktop and fix ownership ───────────────────────────────────────
rm -rf /home/kasm-user/Desktop/*
mkdir -p "${ABOX_WORKSPACE}"
chown -R kasm-user:kasm-user /home/kasm-user

# ── Allow kasm-user to access X11 display ──────────────────────────────────
xhost +local: 2>/dev/null || true

# ── Kill XFCE panel (clean desktop, no taskbar) ──────────────────────────
pkill -f xfce4-panel 2>/dev/null || true

# ── Computer-use MCP server (HTTP, for remote access) ────────────────────
runuser -u kasm-user -- bash -c \
    "DISPLAY=:1 MCP_TRANSPORT=http PORT=8808 node /opt/agentobox/mcps/computer-use/dist/main.js &"

echo "[agentobox] Ready."
echo "[agentobox]   Desktop: https://localhost:6901"
echo "[agentobox]   MCP:     http://localhost:8808/mcp"

# Keep container alive
tail -f /dev/null
