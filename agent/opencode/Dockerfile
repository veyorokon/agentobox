# ── Agentobox Agent — OpenCode ──
#
# OpenCode CLI + HTTP/SSE relay. Builds on the shared base image
# (Dockerfile.base).
#
# OpenCode uses `opencode serve --port 4096` as a local server.
# The relay connects via SSE (downstream events) and REST (upstream
# commands), bridging to the Agentobox backend over WebSocket.

ARG BASE_IMAGE=agentobox-agent-base:latest
FROM ${BASE_IMAGE}

# --- OpenCode CLI + relay dependencies ---
RUN npm install -g opencode-ai && npm cache clean --force
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && pip3 install --break-system-packages httpx aiohttp \
    && apt-get purge -y python3-pip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# --- OC-specific filesystem overlay (relay, s6 svc-opencode) ---
COPY rootfs/ /
RUN chmod +x /opt/abox/relay.py \
    && chmod +x /etc/s6-overlay/s6-rc.d/svc-opencode/run
