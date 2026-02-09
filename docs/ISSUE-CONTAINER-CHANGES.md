# Container Image Changes for Relay Integration

Audit of what needs to change in the agent container image to support `abox-relay.py` replacing the hooks + tmux launch system.

**Related issues:**
- Issue #36 (Backend): Stream-JSON integration
- Issue #38 (Relay): `abox-relay.py` process

---

## Current Image Structure

Two Dockerfiles exist. Both follow the same pattern:

### `agent/Dockerfile.debian` (primary, 97 lines)
- **Base:** `debian:bookworm-slim`
- **s6-overlay:** v3.2.2.0 — process supervisor, ENTRYPOINT is `/init`
- **System packages:** bash, curl, jq, git, sudo, openssl, tmux, procps, xvfb, x11vnc, xterm, xdotool, awesome, dbus, python3-websockify, dmz-cursor-theme
- **Node.js:** v22 via nodesource
- **GitHub CLI:** via apt
- **Firefox ESR:** via apt
- **JetBrains Mono font:** downloaded from GitHub releases
- **noVNC:** git clone to `/opt/noVNC`
- **textfox:** git clone to `/opt/textfox`
- **Claude Code CLI:** `npm install -g @anthropic-ai/claude-code`
- **Computer Use MCP:** copied from `mcp-servers/computer-use/` to `/opt/mcp-servers/computer-use/`
- **User:** `computeruse` with passwordless sudo
- **Rootfs overlay:** `COPY rootfs/ /` — all agent configs, s6 services, hooks
- **Env vars:** `DISPLAY=:1`, `RESOLUTION=1920x1080`, `S6_KEEP_ENV=1`, `S6_LOGGING=1`, cursor theme
- **Exposed port:** 6080 (noVNC)
- **Entrypoint:** `/init` (s6-overlay)

### `agent/Dockerfile.alpine` (71 lines)
- Same structure, Alpine packages instead of Debian. Slightly smaller image.

### s6-overlay Services (under `agent/rootfs/etc/s6-overlay/s6-rc.d/`)
| Service | Purpose |
|---------|---------|
| `svc-xvfb` | X virtual framebuffer (display :1) |
| `svc-dbus` | D-Bus system bus |
| `svc-awesome` | AwesomeWM window manager |
| `svc-x11vnc` | VNC server |
| `svc-websockify` | WebSocket proxy for noVNC |
| `init-firefox` | One-shot: copies Firefox profile/config |

All registered in `user/contents.d/`. No s6 service for Claude — it's launched later by the backend via `runtime.exec()`.

### Current Claude Launch Flow (lifecycle.py:120-144)
```
Backend _provision_agent() →
  runtime.exec(sandbox_id, [
    "tmux", "new-session", "-d", "-s", "claude",
    "-x", "200", "-y", "50",
    "bash", "-c", "<claude_cmd>; <curl ProcessExit>"
  ])
```
Claude runs in a tmux session. When Claude exits, a curl command posts a `ProcessExit` hook event to the backend.

### Current Hook System
- **hook-event.sh:** Written at runtime by `provision.py` to `/home/computeruse/hooks/hook-event.sh`. Also exists as a template in `rootfs/home/computeruse/hooks/hook-event.sh`.
- **hooks.json:** Baked into image at `rootfs/home/computeruse/hooks/hooks.json`. Configures 9 Claude Code hook events, all routing to `hook-event.sh`.
- **.claude/settings.json:** Written at runtime by `provision.py._build_settings_json()`. Contains the same hook config as hooks.json.
- **.agent_env:** Written at runtime by `provision.py`. Contains `AGENT_ID` and `ABOX_CALLBACK_URL` for hook-event.sh to source.

---

## Required Changes

### 1. Bundle `abox-relay.py` in the Image

**Current state:** `relay.py` already exists at `agent/rootfs/opt/abox/relay.py` (400 lines, written by the backend engineer). It's already included via `COPY rootfs/ /`.

**Action needed:** Ensure `relay.py` is executable after COPY:
- **Dockerfile.debian line 80-83:** Add `chmod +x /opt/abox/relay.py` alongside existing chmod commands
- **Dockerfile.alpine line 57-61:** Same change

```dockerfile
# Current (Dockerfile.debian:80-84):
RUN chmod +x /etc/s6-overlay/scripts/* \
    && chmod +x /etc/s6-overlay/s6-rc.d/*/run 2>/dev/null || true \
    && chmod +x /home/computeruse/hooks/*.sh \
    && chmod +x /usr/local/bin/firefox /usr/local/bin/firefox-esr \
    && chown -R computeruse:computeruse /home/computeruse

# New:
RUN chmod +x /etc/s6-overlay/scripts/* \
    && chmod +x /etc/s6-overlay/s6-rc.d/*/run 2>/dev/null || true \
    && chmod +x /home/computeruse/hooks/*.sh \
    && chmod +x /usr/local/bin/firefox /usr/local/bin/firefox-esr \
    && chmod +x /opt/abox/relay.py \
    && chown -R computeruse:computeruse /home/computeruse
```

### 2. Python Dependencies: None Needed

The relay uses **stdlib only** — `asyncio`, `json`, `urllib.request`, `logging`, `signal`, `os`, `sys`, `time`. No `httpx` or `aiohttp` required.

Python3 is already installed in both images:
- **Debian:** `python3-websockify` pulls in Python 3.11 (line 21)
- **Alpine:** `py3-pip` and `websockify` pull in Python 3 (line 20)

Verified: all relay imports resolve against Python 3.11 stdlib in the current container.

### 3. Entrypoint / Launch Flow Changes

**Current flow:**
```
Container starts → s6 /init → starts X11/VNC/awesome services
Backend calls runtime.exec() → tmux new-session → claude (interactive mode)
hook-event.sh → curls backend on each hook event
ProcessExit curl → backend on Claude exit
```

**New flow:**
```
Container starts → s6 /init → starts X11/VNC/awesome services
Backend calls runtime.exec() → python3 /opt/abox/relay.py (as computeruse user)
relay.py spawns claude -p --output-format stream-json --input-format stream-json ...
relay.py reads stdout → batches events → POSTs to backend /agents/<id>/stream
relay.py reads POST responses → writes pending_input to claude stdin
relay.py detects Claude exit → POSTs process_exit event → self-terminates
```

**Backend change in lifecycle.py:120-144:**
```python
# Current (tmux launch):
claude_cmd = f"cd {work_dir} && claude --agent-id ..."
wrapped_cmd = f'{claude_cmd}; curl -sf ...'
await runtime.exec(sandbox_id, [
    "tmux", "new-session", "-d", "-s", "claude", ...
])

# New (relay launch):
await runtime.exec(sandbox_id, [
    "bash", "-c",
    f"cd {work_dir} && python3 /opt/abox/relay.py &"
])
```

The relay reads all its config from env vars (`AGENT_ID`, `ABOX_CALLBACK_URL`, `RELAY_AUTH_TOKEN`, `AGENT_NAME`, `TEAM_NAME`, `PARENT_SESSION_ID`, `CLAUDE_MODEL`, `MCP_CONFIG`). The backend sets these during container creation, not at exec time.

**Alternative — s6 service:** Could add a `svc-relay` s6 service definition. This would let s6 manage relay lifecycle (auto-restart on crash). However, the relay needs env vars that are only known after provisioning (RELAY_AUTH_TOKEN is generated per-agent). The current pattern of launching via `runtime.exec()` after provisioning is simpler and consistent with the existing approach. Recommend keeping `runtime.exec()` launch for now.

### 4. Hook System Removal

**What gets removed from the image:**

| File | Action |
|------|--------|
| `rootfs/home/computeruse/hooks/hook-event.sh` | DELETE — no longer needed, relay replaces hooks |
| `rootfs/home/computeruse/hooks/hooks.json` | DELETE — Claude Code hooks no longer configured |

**What gets removed from runtime provisioning (provision.py):**

| Component | Lines | Action |
|-----------|-------|--------|
| `_HOOK_EVENT_SH` script literal | 148-173 | DELETE |
| `_HOOK_EVENTS` list | 175-179 | DELETE |
| `_HOOK_CMD` string | 180 | DELETE |
| `_build_settings_json()` hook config | 299-307 | MODIFY — remove hooks, keep other settings |
| Hook script write in `provision_workspace()` | 71-79 | DELETE |
| `.agent_env` write in `provision_workspace()` | 82-86 | MODIFY — env vars still needed but for relay, not hooks |

**Dockerfile chmod line:** Remove `chmod +x /home/computeruse/hooks/*.sh` (both Dockerfiles).

**Does removing hooks break anything?**
- **No.** The hook system is entirely self-contained. `hook-event.sh` curls the backend's `/hooks/event` endpoint. Once the relay replaces this with POSTs to `/agents/<id>/stream`, the hook endpoint, script, and settings are all dead code.
- **`.claude/settings.json` still needed** for other settings (`theme`, `defaultMode`, `enableAllProjectMcpServers`). Just remove the `hooks` key.
- **Transition period:** During Phase 1 (validation), keep hooks running alongside the relay to compare data parity. Only delete after validation.

### 5. New Environment Variables

**Already set by `_build_agent_env()` in lifecycle.py:383-395:**
- `ANTHROPIC_API_KEY`
- `AGENT_ID`
- `ABOX_CALLBACK_URL`
- `AGENT_NAME`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
- `CLAUDECODE`
- `PROJECT_ID`
- `ABOX_DASHBOARD_URL`
- `CLAUDE_CODE_API_KEY`

**New env vars needed (add to `_build_agent_env()`):**

| Variable | Purpose | Source |
|----------|---------|--------|
| `RELAY_AUTH_TOKEN` | Auth token for relay → backend POST requests | Generated per-agent during provisioning (e.g. `secrets.token_hex(32)`) |
| `TEAM_NAME` | Team name for Claude's `--team-name` flag | Derived from `project.name` (already computed in `_provision_agent()` line 116) |
| `PARENT_SESSION_ID` | Claude's `--parent-session-id` flag | `str(project.id)` (already computed line 117) |
| `CLAUDE_MODEL` | Model for Claude's `--model` flag | `"claude-opus-4-6"` or agent-configurable |
| `MCP_CONFIG` | Path to MCP config file for Claude's `--mcp-config` flag | Written to container during provisioning, path passed as env var |

**No new Dockerfile ENV directives needed.** These are all set at container runtime by the backend, not baked into the image.

### 6. tmux: Keep or Remove?

`tmux` is installed in both Dockerfiles (Debian line 18, Alpine line 17).

**Keep for now.** The relay has an optional feature to pipe events to a tmux log session for VNC visibility (spec: "Optionally pipe events to a tmux log session for VNC visibility"). Even without this, tmux is a useful debugging tool inside agent containers.

**Future:** If VNC visibility via tmux is not implemented, tmux can be removed to shrink the image.

---

## Persistent Volume for `~/.claude/`

**Current state: No persistent volume.**

The `~/.claude/` directory is created at runtime inside the container. When the container is destroyed (via `kill_agent()`), all Claude Code session data is lost:
- Session history (`~/.claude/sessions/`)
- Project settings (`~/.claude/projects/`)
- Conversation transcripts
- MCP server state

**Implications for session resume:**
- The `--resume <session-id>` flag requires the session file to exist in `~/.claude/sessions/`. Without persistence, agents cannot resume sessions after container restart.
- The relay's `process_exit` event captures the `session_id`. If we persist `~/.claude/`, the backend could pass `--resume <session_id>` when relaunching Claude after a crash.

**Recommendation:** Add a named Docker volume for `~/.claude/` when session resume is needed:

```python
# In DockerRuntime.create():
volumes = {
    agent.workspace_path: CONTAINER_WORKSPACE,  # existing
}
# Future: add claude session persistence
# docker_volumes["agentobox-claude-{name}"] = {
#     "bind": "/home/computeruse/.claude",
#     "mode": "rw"
# }
```

For Docker Compose, this would be a named volume. For Modal, session persistence would need a different approach (Modal named volumes or S3 sync).

**Not blocking for Phase 1.** Session resume can be added later.

---

## Summary of Changes

### Image Changes (Dockerfiles)
| Change | Debian Line | Alpine Line |
|--------|-------------|-------------|
| Add `chmod +x /opt/abox/relay.py` | 80-84 | 57-61 |
| Remove `chmod +x /home/computeruse/hooks/*.sh` (Phase 3) | 82 | 59 |

### Files to Remove from rootfs (Phase 3)
| File | Reason |
|------|--------|
| `rootfs/home/computeruse/hooks/hook-event.sh` | Replaced by relay |
| `rootfs/home/computeruse/hooks/hooks.json` | Claude Code hooks no longer configured |

### Files Already Present
| File | Status |
|------|--------|
| `rootfs/opt/abox/relay.py` | Already written by backend engineer |

### No New Dependencies
- Python3: already installed (via websockify dependency)
- All relay imports: stdlib only (asyncio, json, urllib.request, etc.)
- No httpx/aiohttp needed

### New Env Vars (set by backend, not in Dockerfile)
| Variable | Purpose |
|----------|---------|
| `RELAY_AUTH_TOKEN` | Relay → backend auth |
| `TEAM_NAME` | Claude team flag |
| `PARENT_SESSION_ID` | Claude parent session flag |
| `CLAUDE_MODEL` | Claude model selection |
| `MCP_CONFIG` | Path to MCP config file |

### Launch Flow Change
```
Before: runtime.exec() → tmux new-session → claude (interactive)
After:  runtime.exec() → python3 /opt/abox/relay.py → claude -p --stream-json
```

---

## Phase Alignment

| Phase | Container Impact |
|-------|-----------------|
| Phase 1 (Relay + Backend) | Add `chmod +x /opt/abox/relay.py`. New env vars. Backend launches relay instead of tmux. Keep hooks running for data parity validation. |
| Phase 2 (Frontend) | No container changes. |
| Phase 3 (Cleanup) | Remove hook-event.sh, hooks.json from rootfs. Remove hooks chmod from Dockerfile. Remove tmux if unused. |
