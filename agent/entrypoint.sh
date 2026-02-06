#!/bin/bash
set -e

RESOLUTION="${RESOLUTION:-1920x1080}"

# Start Xvfb
Xvfb :1 -screen 0 "${RESOLUTION}x24" &
sleep 1

# Start AwesomeWM
awesome &
sleep 1

# --- Firefox profile setup (textfox + Rose Pine Moon) ---
# Firefox 147+ uses XDG path (~/.config/mozilla/firefox/) and ignores pre-created
# profiles.ini. Strategy: brief headless launch to trigger profile creation, then
# inject textfox into the profile Firefox actually created.
FF_DIR="$HOME/.config/mozilla/firefox"

# Brief headless launch to create default profile
firefox --headless &
FF_PID=$!
for i in $(seq 1 15); do
    FF_ACTIVE=$(find "$FF_DIR" -maxdepth 2 -name 'prefs.js' 2>/dev/null | head -1)
    [ -n "$FF_ACTIVE" ] && break
    sleep 1
done
kill $FF_PID 2>/dev/null || true
sleep 1
pkill -9 -f firefox 2>/dev/null || true
sleep 1

if [ -n "$FF_ACTIVE" ]; then
    FF_TARGET=$(dirname "$FF_ACTIVE")
    cp -r /opt/textfox/chrome "$FF_TARGET/"
    cp /opt/textfox/user.js "$FF_TARGET/user.js"
    cp ~/.firefox-config/config.css "$FF_TARGET/chrome/config.css"
    cat ~/.firefox-config/user-overrides.js >> "$FF_TARGET/user.js"
    echo "[agentobox] textfox injected into $(basename "$FF_TARGET")"
else
    echo "[agentobox] WARNING: Firefox profile not detected, textfox not applied"
fi

# Start x11vnc (localhost only -- noVNC proxies it)
x11vnc -display :1 -nopw -listen localhost -forever -shared -rfbport 5900 &
sleep 1

# Start noVNC websockify (publicly accessible)
/opt/noVNC/utils/websockify/run --web /opt/noVNC 6080 localhost:5900 &

echo "Desktop ready: noVNC on port 6080"

# Keep container alive
tail -f /dev/null
