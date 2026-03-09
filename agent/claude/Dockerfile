# ── Agentobox Agent — Claude Code ──
#
# Claude Code CLI + Agent SDK + CC-specific relay, hooks, and MCP servers.
# Builds on the shared base image (Dockerfile.base).
#
# Build context: ./agent (NOT ./agent/claude) — needs access to shared
# rootfs/opt/abox/ python code that lives in the parent directory.

ARG BASE_IMAGE=agentobox-agent-base:latest
FROM ${BASE_IMAGE}

# --- Claude Agent SDK (relay dependency) ---
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && pip3 install --break-system-packages claude-agent-sdk==0.1.48 \
    && apt-get purge -y python3-pip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# --- Claude Code CLI ---
ARG CLAUDE_CODE_VERSION=2.1.71
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# --- Computer Use MCP server ---
COPY claude/mcp-servers/computer-use/package.json claude/mcp-servers/computer-use/package-lock.json /opt/mcp-servers/computer-use/
COPY claude/mcp-servers/computer-use/dist/ /opt/mcp-servers/computer-use/dist/
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ libx11-dev libxtst-dev libxinerama-dev libpng-dev libvips-dev \
    && cd /opt/mcp-servers/computer-use \
    && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev) \
    && npm cache clean --force \
    && apt-get purge -y make g++ libx11-dev libxtst-dev libxinerama-dev libpng-dev libvips-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# --- Chromium for Playwright MCP ---
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# --- Shared abox python code (from base rootfs, changes often) ---
# Lives in base context but copied here so base image stays frozen.
# Split by change frequency: stable utils first, then hot code.
COPY rootfs/opt/abox/abox_logging.py /opt/abox/abox_logging.py
COPY rootfs/opt/abox/api-proxy.py /opt/abox/api-proxy.py
COPY rootfs/opt/abox/mcp-gateway.py /opt/abox/mcp-gateway.py
COPY rootfs/opt/abox/converters.py /opt/abox/converters.py
COPY rootfs/opt/abox/relay_common.py /opt/abox/relay_common.py
RUN chmod +x /opt/abox/relay_common.py \
    && chmod +x /opt/abox/api-proxy.py \
    && chmod +x /opt/abox/mcp-gateway.py

# --- CC-specific code (changes most often — last for fastest rebuilds) ---
COPY claude/rootfs/opt/abox/api-key-helper.sh /opt/abox/api-key-helper.sh
RUN chmod +x /opt/abox/api-key-helper.sh

COPY claude/rootfs/opt/abox/hooks/ /opt/abox/hooks/
RUN chmod +x /opt/abox/hooks/*.py

COPY claude/rootfs/opt/abox/relay.py /opt/abox/relay.py
RUN chmod +x /opt/abox/relay.py
