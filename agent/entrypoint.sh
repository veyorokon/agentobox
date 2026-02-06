#!/bin/bash
set -e

RESOLUTION="${RESOLUTION:-1024x768}"

# Start Xvfb
Xvfb :1 -screen 0 "${RESOLUTION}x24" &
sleep 1

# Start window manager
mutter --replace --no-x11-backend 2>/dev/null &
sleep 1

# Start x11vnc (localhost only -- noVNC proxies it)
x11vnc -display :1 -nopw -listen localhost -forever -shared -rfbport 5900 &
sleep 1

# Start noVNC websockify (publicly accessible)
/opt/noVNC/utils/websockify/run --web /opt/noVNC 6080 localhost:5900 &

echo "Desktop ready: noVNC on port 6080"

# Keep container alive
tail -f /dev/null
