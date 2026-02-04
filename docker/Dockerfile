ARG ABOX_BASE_IMAGE=kasmweb/core-ubuntu-focal:1.16.0
FROM ${ABOX_BASE_IMAGE}

USER root

# ── System deps ──────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tmux \
    xdotool \
    scrot \
    imagemagick \
    jq \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome ────────────────────────────────────────────────────────────
RUN curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/* \
    # Strip non-English Chrome locales
    && find /opt/google/chrome/locales -type f ! -name 'en-US.pak' -delete 2>/dev/null || true \
    # Wrap Chrome binary to always pass --no-sandbox (required in Docker)
    && mv /opt/google/chrome/google-chrome /opt/google/chrome/google-chrome-real \
    && printf '#!/bin/bash\nexec /opt/google/chrome/google-chrome-real --no-sandbox --no-first-run --no-default-browser-check --disable-infobars --test-type --start-fullscreen "$@"\n' \
       > /opt/google/chrome/google-chrome \
    && chmod +x /opt/google/chrome/google-chrome

# ── AwesomeWM + Firefox ───────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    awesome \
    firefox \
    unzip fontconfig \
    && rm -rf /var/lib/apt/lists/*

# ── JetBrains Mono font ──────────────────────────────────────────────────────
RUN curl -fsSL https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip -o /tmp/jbm.zip \
    && mkdir -p /usr/share/fonts/jetbrains-mono \
    && unzip -oq /tmp/jbm.zip -d /tmp/jbm \
    && cp /tmp/jbm/fonts/ttf/*.ttf /usr/share/fonts/jetbrains-mono/ \
    && fc-cache -f \
    && rm -rf /tmp/jbm.zip /tmp/jbm

# ── Node.js (for MCP server) ─────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Claude Code CLI ──────────────────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ── Computer-use MCP server ─────────────────────────────────────────────────
COPY mcps/computer-use /opt/agentobox/mcps/computer-use
RUN cd /opt/agentobox/mcps/computer-use && npm install --production

# ── Agent workspace ─────────────────────────────────────────────────────────
RUN mkdir -p /home/kasm-user/.claude /home/kasm-user/workspace \
    && chown -R kasm-user:kasm-user /home/kasm-user/.claude /home/kasm-user/workspace

# ── AwesomeWM config ──────────────────────────────────────────────────────────
COPY docker/awesome/ /home/kasm-user/.config/awesome/
RUN chown -R kasm-user:kasm-user /home/kasm-user/.config/awesome

# ── Firefox profile with textfox theme ────────────────────────────────────────
COPY docker/firefox/ /home/kasm-user/.mozilla/firefox/agentobox.default/
RUN mkdir -p /home/kasm-user/.mozilla/firefox && \
    printf '[General]\nStartWithLastProfile=1\nVersion=2\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=agentobox.default\nDefault=1\n' \
    > /home/kasm-user/.mozilla/firefox/profiles.ini && \
    chown -R kasm-user:kasm-user /home/kasm-user/.mozilla

# ── Clean up Kasm default desktop icons ────────────────────────────────────
RUN rm -rf /home/kasm-user/Desktop/Downloads /home/kasm-user/Desktop/Uploads \
           /home/kasm-user/Downloads /home/kasm-user/Uploads 2>/dev/null || true

# ── Hook scripts (PostToolUse callbacks) ──────────────────────────────────
COPY docker/hooks/ /opt/agentobox/hooks/
RUN chmod +x /opt/agentobox/hooks/*.sh

# ── Entrypoint ──────────────────────────────────────────────────────────────
COPY docker/entrypoint.sh /opt/agentobox/entrypoint.sh
RUN chmod +x /opt/agentobox/entrypoint.sh

# ── Environment ─────────────────────────────────────────────────────────────
ENV ABOX_WORKSPACE="/home/kasm-user/workspace"
ENV VNC_PW=password

EXPOSE 8808

ENTRYPOINT ["/opt/agentobox/entrypoint.sh"]
