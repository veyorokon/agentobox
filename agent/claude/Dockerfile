# ── Agentobox Agent — Claude Code ──
#
# Claude Code CLI + Agent SDK + CC-specific relay, hooks, and MCP servers.
# Builds on the shared base image (Dockerfile.base).

ARG BASE_IMAGE=agentobox-agent-base:latest
FROM ${BASE_IMAGE}

# --- Claude Agent SDK (relay dependency) ---
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && pip3 install --break-system-packages claude-agent-sdk==0.1.47 \
    && apt-get purge -y python3-pip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# --- Claude Code CLI ---
ARG CLAUDE_CODE_VERSION=2.1.70
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# --- Computer Use MCP server ---
COPY mcp-servers/computer-use/package.json mcp-servers/computer-use/package-lock.json /opt/mcp-servers/computer-use/
COPY mcp-servers/computer-use/dist/ /opt/mcp-servers/computer-use/dist/
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ libx11-dev libxtst-dev libxinerama-dev libpng-dev libvips-dev \
    && cd /opt/mcp-servers/computer-use \
    && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev) \
    && npm cache clean --force \
    && apt-get purge -y make g++ libx11-dev libxtst-dev libxinerama-dev libpng-dev libvips-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# --- CC-specific filesystem overlay (relay, hooks, api-key-helper) ---
COPY rootfs/ /
RUN chmod +x /opt/abox/relay.py \
    && chmod +x /opt/abox/hooks/*.py \
    && chmod +x /opt/abox/api-key-helper.sh
