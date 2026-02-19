# Agent Image

The agent container provides a full desktop environment (X11 + AwesomeWM + Firefox + noVNC) with Claude Code pre-installed. Multiple Dockerfile variants exist to support different base OS requirements.

## Variants

| Variant | Base | Pkg Manager | libc | Build |
|---------|------|-------------|------|-------|
| `debian` | `debian:bookworm-slim` | `apt` | glibc | `make agent-image VARIANT=debian` |
| `alpine` | `alpine:3.21` | `apk` | musl | `make agent-image VARIANT=alpine` |

**Default: `debian`** — most MCP servers with native binaries require glibc.

## MCP Server Compatibility

Each MCP server in `MCP_REGISTRY` (see `backend/agents/services/provision.py`) declares a `compat` list of supported variants. Incompatible servers are automatically skipped during provisioning.

| MCP Server | debian | alpine | Notes |
|------------|--------|--------|-------|
| `computer-use` | yes | no | `@nut-tree-fork/libnut-linux` requires glibc. Fails on musl with `ERR_DLOPEN_FAILED`. |

## Architecture

The image targets `linux/amd64` by default (`PLATFORM` variable in Makefile). This is required because `@nut-tree-fork/libnut-linux` only ships x86_64 prebuilt binaries — no arm64 prebuilds, and the npm package doesn't include source for local compilation.

On Apple Silicon Macs, Docker Desktop runs amd64 images via Rosetta emulation. Production servers (CI, Modal, etc.) are typically amd64 natively.

## Known Issues

### Alpine + native Node.js binaries

Alpine uses musl libc. Pre-built native Node.js addons (`.node` files) are almost always compiled against glibc. This causes `ERR_DLOPEN_FAILED` at runtime. Affected packages include `@nut-tree-fork/libnut-linux`, `sharp` (older versions), and similar native extensions.

**Workaround:** Use the `debian` variant for any MCP server that depends on native binaries.

### Firefox profile lock

If Claude Code launches Firefox via bash (`firefox-esr URL`), a second invocation hits the profile lock. The `rootfs/usr/local/bin/firefox` and `firefox-esr` wrappers handle this by detecting a running instance and navigating the current tab via `xdotool` instead of launching a new process.

## Shared Structure

Both variants use the same `rootfs/` overlay, s6-overlay services, and hooks. The differences are package installation commands and base image. When adding new system dependencies, update both Dockerfiles.

## Runtime Provisioning

The agent image ships with **no CLAUDE.md, no `.claude/` directory, and no MCP config**. All of these are written at runtime by the backend's provisioning service (`backend/agents/services/lifecycle.py` → `provision.py`). This keeps the image generic and lets the backend control agent identity, team context, and credentials.

### Session persistence via symlink

Claude Code stores session state (conversation history, team config, task lists) under `~/.claude/`. To persist this across container restarts (hard restart, config change, crash recovery):

```
/mnt/abox-state/agents/{agent_id}/.claude    ← volume-backed, survives container kill
       ↑
       symlink
       ↑
/home/agent/.claude                           ← what Claude Code sees
```

The provisioning service creates the volume-backed directory first, then symlinks `~/.claude` to it. This means:
- Session history survives `hard_restart_agent()` (container is killed and recreated)
- Team config (`~/.claude/teams/`) and task lists (`~/.claude/tasks/`) persist
- The agent can `--resume` its previous conversation after restart

### Files written at provision time

| File | Path in container | Purpose |
|------|-------------------|---------|
| `CLAUDE.md` | `/home/agent/CLAUDE.md` | Agent identity, role, team roster, instructions, MCP docs, security rules |
| `settings.json` | `~/.claude/settings.json` | Claude Code config (theme, hooks, API key helper) |
| `.claude.json` | `~/.claude.json` | Onboarding bypass, permission approvals |
| `.mcp.json` | `{work_dir}/.mcp.json` | MCP server registry with secrets injected into env blocks |
| `env` | `/mnt/abox-state/secrets/env` | Shared secrets as shell exports (sourced by `.bashrc`) |
| `anthropic_key` | `/run/secrets/anthropic_key` | API key on tmpfs (root-only, 0400) |
| `api-key-helper.sh` | `/opt/abox/api-key-helper.sh` | Script Claude Code calls to read the API key |
| `config.json` | `~/.claude/teams/{team}/config.json` | Team roster for inter-agent discovery |
| `inboxes/{name}.json` | `~/.claude/teams/{team}/inboxes/` | Per-agent message inbox |

### Hot updates vs cold updates

| Change | Update type | What happens |
|--------|-------------|--------------|
| Instructions | Hot | CLAUDE.md rewritten on running container, no restart |
| Secrets | Hot | `.mcp.json` rewritten with new env vars, no restart |
| Model, role, MCPs | Cold | Agent killed and reprovisioned via `hard_restart_agent()` |
