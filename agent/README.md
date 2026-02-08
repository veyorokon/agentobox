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
