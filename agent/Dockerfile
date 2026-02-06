FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# --- System packages ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    xterm \
    tmux \
    curl \
    jq \
    git \
    sudo \
    mutter \
    net-tools \
    ca-certificates \
    gnupg \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# --- Node.js 20 LTS ---
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- noVNC + websockify ---
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone --depth 1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# --- Claude Code CLI ---
RUN npm install -g @anthropic-ai/claude-code

# --- User setup ---
RUN useradd -m -s /bin/bash computeruse \
    && echo "computeruse ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# --- Environment ---
ENV DISPLAY=:1
ENV RESOLUTION=1024x768

# --- Copy hooks and entrypoint ---
COPY hooks/ /home/computeruse/hooks/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /home/computeruse/hooks/*.sh \
    && chown -R computeruse:computeruse /home/computeruse/hooks

EXPOSE 6080

USER computeruse
WORKDIR /home/computeruse

ENTRYPOINT ["/entrypoint.sh"]
