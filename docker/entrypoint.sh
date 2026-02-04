#!/bin/bash
set -e

# ── Disable VNC auth ────────────────────────────────────────────────────────
export VNCOPTIONS="-disableBasicAuth"

# ── Replace XFCE with AwesomeWM before Kasm starts ──────────────────────
# Shim startxfce4 so Kasm's vnc_startup.sh launches awesome instead.
# The watchdog tracks awesome's PID and restarts it on crash.
cp /usr/bin/startxfce4 /usr/bin/startxfce4.orig 2>/dev/null || true
cat > /usr/bin/startxfce4 << 'XFCE_SHIM'
#!/bin/bash
exec awesome 2>>/tmp/awesome.log
XFCE_SHIM
chmod +x /usr/bin/startxfce4

# ── Disable KasmVNC SSL (plain HTTP for local dev) ───────────────────────
sed -i 's/-sslOnly//g' /dockerstartup/vnc_startup.sh
sed -i 's/require_ssl: true/require_ssl: false/g' /usr/share/kasmvnc/kasmvnc_defaults.yaml

# ── Hide KasmVNC error dialog (shows on disconnect — we handle it in the dashboard) ─
sed -i 's|id=noVNC_fallback_error class=noVNC_center|id=noVNC_fallback_error class=noVNC_center style="display:none!important"|g' /usr/share/kasmvnc/www/index.html

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

# ── Inject textfox into Firefox's default profile (background) ────────────
# Firefox 136+ creates its own profile on first launch, ignoring profiles.ini.
# We run this in the background so it doesn't block MCP server startup.
(
    FF_PROFILE_DIR="/home/kasm-user/.mozilla/firefox"
    FF_TEXTFOX_SRC="$FF_PROFILE_DIR/agentobox.default"

    # Brief headless launch to trigger profile creation
    runuser -u kasm-user -- bash -c "DISPLAY=:1 firefox --headless &"
    FF_PID=$!
    for i in $(seq 1 15); do
        FF_ACTIVE=$(find "$FF_PROFILE_DIR" -maxdepth 2 -name 'prefs.js' ! -path '*/agentobox.default/*' 2>/dev/null | head -1)
        [ -n "$FF_ACTIVE" ] && break
        sleep 1
    done
    # Kill ALL firefox processes (runuser PID is the wrapper, not firefox itself)
    pkill -u kasm-user -f firefox 2>/dev/null || true
    sleep 2
    # Ensure nothing lingers
    pkill -9 -u kasm-user -f firefox 2>/dev/null || true
    sleep 1

    if [ -n "$FF_ACTIVE" ]; then
        FF_TARGET=$(dirname "$FF_ACTIVE")
        cp -r "$FF_TEXTFOX_SRC/chrome" "$FF_TARGET/"
        cp "$FF_TEXTFOX_SRC/user.js" "$FF_TARGET/"
        chown -R kasm-user:kasm-user "$FF_TARGET/chrome" "$FF_TARGET/user.js"
        echo "[agentobox] textfox injected into $(basename "$FF_TARGET")"
    else
        echo "[agentobox] WARNING: Firefox profile not detected, textfox not applied"
    fi
) &

# ── Computer-use MCP server (HTTP, for remote access) ────────────────────
runuser -u kasm-user -- bash -c \
    "DISPLAY=:1 MCP_TRANSPORT=http PORT=8808 node /opt/agentobox/mcps/computer-use/dist/main.js &"

echo "[agentobox] Ready."
echo "[agentobox]   Desktop: http://localhost:6901"
echo "[agentobox]   MCP:     http://localhost:8808/mcp"

# Keep container alive
tail -f /dev/null
