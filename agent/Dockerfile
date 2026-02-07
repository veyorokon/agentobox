FROM alpine:3.21

ARG S6_OVERLAY_VERSION=3.2.2.0
ARG TARGETARCH

# --- s6-overlay ---
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && rm /tmp/s6-overlay-noarch.tar.xz
# Map Docker TARGETARCH to s6 naming: amd64->x86_64, arm64->aarch64
RUN S6_ARCH=$(case "$TARGETARCH" in arm64) echo aarch64;; *) echo x86_64;; esac) \
    && wget -qO /tmp/s6-overlay-arch.tar.xz \
       "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
    && tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz && rm /tmp/s6-overlay-arch.tar.xz

# --- System packages ---
RUN apk add --no-cache \
    bash curl jq git sudo openssl ca-certificates fontconfig unzip tmux \
    xvfb-run xorg-server x11vnc xterm \
    awesome dbus \
    py3-pip websockify \
    nodejs npm \
    github-cli \
    font-jetbrains-mono \
    && dbus-uuidgen > /etc/machine-id

# --- Firefox (ESR from community) ---
RUN apk add --no-cache firefox-esr

# --- noVNC (web client only, websockify via apk) ---
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
    && rm -rf /opt/noVNC/.git

# --- textfox ---
RUN git clone --depth 1 https://github.com/adriankarlen/textfox.git /opt/textfox \
    && rm -rf /opt/textfox/.git

# --- Claude Code CLI ---
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

# --- User ---
RUN adduser -D -s /bin/bash computeruse \
    && echo "computeruse ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# --- Filesystem overlay (configs + s6 services) ---
COPY rootfs/ /
RUN chmod +x /etc/s6-overlay/scripts/* \
    && chmod +x /etc/s6-overlay/s6-rc.d/*/run 2>/dev/null || true \
    && chmod +x /home/computeruse/hooks/*.sh \
    && chown -R computeruse:computeruse /home/computeruse

# --- Environment ---
ENV DISPLAY=:1
ENV RESOLUTION=1920x1080
ENV S6_KEEP_ENV=1

EXPOSE 6080

ENTRYPOINT ["/init"]
