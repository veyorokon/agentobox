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
    net-tools \
    ca-certificates \
    gnupg \
    openssl \
    unzip \
    fontconfig \
    awesome \
    && rm -rf /var/lib/apt/lists/*

# --- Firefox (real binary, not snap shim) ---
RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common \
    && add-apt-repository -y ppa:mozillateam/ppa \
    && printf 'Package: *\nPin: release o=LP-PPA-mozillateam\nPin-Priority: 1001\n' \
       > /etc/apt/preferences.d/mozilla-firefox \
    && apt-get update && apt-get install -y --no-install-recommends firefox \
    && rm -rf /var/lib/apt/lists/*

# --- GitHub CLI ---
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
       https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# --- JetBrains Mono font ---
RUN curl -fsSL -o /tmp/jbmono.zip \
      https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip \
    && mkdir -p /usr/share/fonts/jetbrains-mono \
    && unzip -q /tmp/jbmono.zip -d /tmp/jbmono \
    && cp /tmp/jbmono/fonts/ttf/*.ttf /usr/share/fonts/jetbrains-mono/ \
    && fc-cache -f \
    && rm -rf /tmp/jbmono.zip /tmp/jbmono

# --- Node.js 20 LTS ---
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- noVNC + websockify ---
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone --depth 1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# --- textfox (upstream) ---
RUN git clone --depth 1 https://github.com/adriankarlen/textfox.git /opt/textfox

# --- Claude Code CLI ---
RUN npm install -g @anthropic-ai/claude-code

# --- User setup ---
RUN useradd -m -s /bin/bash computeruse \
    && echo "computeruse ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# --- AwesomeWM config ---
COPY awesome/ /home/computeruse/.config/awesome/

# --- Firefox config (Rose Pine Moon overrides) ---
COPY firefox/ /home/computeruse/.firefox-config/

# --- Environment ---
ENV DISPLAY=:1
ENV RESOLUTION=1920x1080
ENV MOZ_DISABLE_CONTENT_SANDBOX=1

# --- Copy hooks and entrypoint ---
COPY hooks/ /home/computeruse/hooks/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /home/computeruse/hooks/*.sh \
    && chown -R computeruse:computeruse /home/computeruse

EXPOSE 6080

USER computeruse
WORKDIR /home/computeruse

ENTRYPOINT ["/entrypoint.sh"]
