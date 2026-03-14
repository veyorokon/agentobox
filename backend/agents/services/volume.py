"""
Volume-based state management for agent containers.

Replaces the three separate sync paths (provision-time file writes, live
WebSocket push, theme-specialized WS handling) with one: filesystem on a
shared volume. Backend writes files, sends a WS reload command. Relay
reads the file and reloads the relevant process.

## Storage hierarchy

    VOLUME_ROOT/                          # e.g. /volumes/ (Docker named volume)
      agents/
        {agent_id}/                       # per-agent isolation boundary
          home/agent/                     # mirrors /home/agent/ in container
            .claude/
              settings.json               # CC settings (mode, model, api_key placeholder)
            .relay_env                    # relay process env vars
            workspace/
              CLAUDE.md                   # project-level instructions
              .claude/.claude.json        # onboarding state
              .mcp.json                   # MCP config
          tmp/abox-theme/                 # mirrors /tmp/abox-theme/
            tokens.json                   # source: backend writes CSS tokens
            userChrome.css                # derived: converter writes
            awesome.lua                   # derived: converter writes
            theme.json                    # derived: reference copy
          run/                            # mirrors /run/
            secrets/
              proxy_key                   # API proxy key (0600)
              mcp-{name}/{KEY}            # per-MCP scoped secrets
            mcp-gateway/
              config.json                 # gateway server config
          mnt/abox-state/                 # mirrors /mnt/abox-state/
            secrets/env                   # shell-sourceable secrets export
          _abox/                          # control plane (NOT mirrored into container)
            state.json                    # {model, mode, allowed_tools}
            status.json                   # {filename: sha256_hash} — convergence tracking
            inbox.jsonl                   # messages to agent (backend appends)
            inbox.pos                     # byte offset of last consumed message (relay writes)
            outbox.jsonl                  # events from agent (hooks/relay append)
            outbox.pos                    # byte offset of last collected event (backend writes)

## From agent perspective (inside container)

    Boot oneshot (init-volume) creates symlinks before any service starts.
    AGENT_ID env var selects the agent's subdir within the shared volume:

        /home/agent/.claude       → /vol/agents/$AGENT_ID/home/agent/.claude
        /home/agent/.relay_env    → /vol/agents/$AGENT_ID/home/agent/.relay_env
        /home/agent/workspace     → /vol/agents/$AGENT_ID/home/agent/workspace
        /tmp/abox-theme           → /vol/agents/$AGENT_ID/tmp/abox-theme
        /run/secrets              → /vol/agents/$AGENT_ID/run/secrets
        /run/mcp-gateway          → /vol/agents/$AGENT_ID/run/mcp-gateway
        /mnt/abox-state           → /vol/agents/$AGENT_ID/mnt/abox-state

    The agent sees a normal filesystem. It doesn't know about the volume.
    Backend writes are immediately visible because they're the same files.

## Convergence protocol

    Backend writes a config file → sends WS reload {"type": "reload", "path": "..."}.
    Relay reads the file, applies it, then writes the file's SHA-256 hash
    to _abox/status.json. Backend can check is_converged() to verify the
    relay has applied all pending changes.

## Delivery guarantee (inbox/outbox)

    Backend appends to inbox.jsonl, sends a reload. Relay reads from
    inbox.pos offset, processes messages, advances the cursor. Messages
    survive relay crashes — unread lines persist on the volume. No
    backfill logic needed in consumers.py.

## What's NOT on the volume

    - /home/agent/workspace (bind-mounted from host, shared across ALL agents)
    - /etc/sudoers.d/ (system file, still written via runtime.exec)
    - /opt/abox/ (image-baked scripts, not agent state)
"""

import hashlib
import json
from pathlib import Path

from agents.services.relay_commands import ReloadCommand
from config.app_config import app_config

# Directories that init-volume symlinks into the container.
# Every volume write path MUST start with one of these prefixes.
# If you add a new symlink dir to init-volume, add the prefix here.
#
# Source of truth: agent/rootfs/etc/s6-overlay/scripts/init-volume
# Architecture test (test_volume_architecture.py) verifies parity.
SYMLINKED_PREFIXES = (
    "home/agent/",       # glob: ${AGENT_VOL}/home/agent/*
    "opt/abox/",         # glob: ${AGENT_VOL}/opt/abox/*
    "tmp/abox-theme/",   # explicit: ln -sfn
    "run/secrets/",      # explicit: ln -sfn (under run/)
    "run/mcp-gateway/",  # explicit: ln -sfn (under run/)
    "mnt/abox-state/",   # explicit: ln -sfn
    "_abox/",            # control plane — accessed directly via /vol/, not symlinked
)

# Provision-time readiness sentinel.
# init-volume waits for this file before creating symlinks and releasing
# longrun services. This is stronger than checking for _abox/ alone because
# _abox is created early by initialize(), before the rest of provisioning
# files necessarily exist.
PROVISIONING_SENTINEL = "_abox/provisioned.ready"

# Config files the backend manages. The relay tracks convergence by
# comparing file hashes against _abox/status.json. When a file's hash
# doesn't match, the relay hasn't applied the latest version yet.
MANAGED_CONFIG_FILES = [
    "home/agent/.claude/settings.json",
    "home/agent/workspace/CLAUDE.md",
    "home/agent/workspace/.mcp.json",
    "home/agent/workspace/.claude/.claude.json",
    "home/agent/.relay_env",
    "tmp/abox-theme/tokens.json",
    "run/mcp-gateway/config.json",
    "_abox/state.json",
]

# ── Reload registry ───────────────────────────────────────────────────
#
# The single contract between backend and relay for mutable runtime state.
# Keys = volume file paths that the backend writes and the relay handles.
# Values = sets of state field names that each file owns.
#
# This registry defines ALL mutable runtime state. If a piece of data:
#   - Is in this registry → it lives on the volume, NOT in the DB
#   - Is NOT in this registry → it's metadata (DB) or immutable config
#
# Architectural tests enforce:
#   1. Every key has a matching handler in the relay
#   2. Every write to a registered path goes through Volume.mutate()
#   3. No Agent model save() touches fields owned by this registry
#
# To add new runtime state: add the file + fields here, add a relay handler,
# add a Volume helper method if needed. The arch tests will guide you.
RELOAD_REGISTRY: dict[str, set[str]] = {
    "_abox/state.json": {"mode", "allowed_tools", "model"},
    "_abox/inbox.jsonl": {"messages"},
    "tmp/abox-theme/tokens.json": {"theme_tokens"},
    "home/agent/workspace/CLAUDE.md": {"instructions"},
    "home/agent/workspace/.mcp.json": {"mcp_servers"},
    "run/mcp-gateway/config.json": {"gateway_config"},
}

# Flattened set of all state fields owned by the volume.
# Used by arch tests to verify no DB dual-writes.
VOLUME_OWNED_FIELDS: set[str] = set().union(*RELOAD_REGISTRY.values())


class Volume:
    """Filesystem interface for an agent's shared volume.

    All paths are relative to the volume root and mirror container paths
    exactly (Mirror, Don't Map principle). A path like "home/agent/.claude/settings.json"
    on the volume corresponds to /home/agent/.claude/settings.json in the
    container, connected via symlink.

    Write operations are atomic: write to .tmp then os.rename(). Both
    files live on the same filesystem (Docker named volume), so rename
    is guaranteed atomic by POSIX.

    Usage:
        vol = agent.volume                          # from Agent model property
        vol.write("home/agent/.claude/settings.json", json_content)
        vol.write_secret("run/secrets/proxy_key", key, mode=0o600)
        vol.append_inbox({"type": "input", "payload": {...}})
        assert vol.is_converged()                   # relay applied all changes
    """

    def __init__(self, project_id: str, agent_id: str):
        self.root = Path(app_config.volume_root) / "agents" / agent_id

    @staticmethod
    def _validate_path(path: str) -> None:
        """Reject paths outside init-volume's symlinked directories.

        Every file the backend writes must land under a directory that
        init-volume symlinks into the container. Without this, the file
        exists on the volume but is invisible inside the container.
        """
        if not any(path.startswith(p) for p in SYMLINKED_PREFIXES):
            raise ValueError(
                f"Volume path '{path}' is not under any init-volume symlinked directory. "
                f"Allowed prefixes: {SYMLINKED_PREFIXES}. "
                f"Add the directory to init-volume and SYMLINKED_PREFIXES if this is a new path."
            )

    def write(self, path: str, content: str | bytes) -> None:
        """Atomic write to a volume path.

        Creates parent directories as needed. Uses tmp+rename for
        atomicity — relay never sees a partial file.
        """
        self._validate_path(path)
        full = self.root / path
        full.parent.mkdir(parents=True, exist_ok=True)
        tmp = full.with_suffix(".tmp")
        tmp.write_bytes(content if isinstance(content, bytes) else content.encode())
        tmp.rename(full)

    def write_secret(self, path: str, content: str | bytes, mode: int = 0o600) -> None:
        """Atomic write with restricted permissions.

        Used for API keys and MCP secrets. Permissions propagate
        through Docker bind mount to the container.
        """
        self.write(path, content)
        (self.root / path).chmod(mode)

    def read(self, path: str) -> str:
        return (self.root / path).read_text()

    def read_bytes(self, path: str) -> bytes:
        return (self.root / path).read_bytes()

    def exists(self, path: str) -> bool:
        return (self.root / path).exists()

    def status(self) -> dict:
        """Read status.json — the relay's record of what it has applied.

        Returns {filename: sha256_hash_prefix} for each config file the
        relay has successfully read and acted on. Empty dict if the relay
        hasn't started or status.json doesn't exist yet.
        """
        path = self.root / "_abox" / "status.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def file_hash(self, path: str) -> str:
        """First 16 chars of SHA-256 hex digest. Sufficient for change detection."""
        return hashlib.sha256((self.root / path).read_bytes()).hexdigest()[:16]

    def is_converged(self) -> bool:
        """Check if the relay has applied all config files.

        Compares each managed config file's current hash against the hash
        recorded in status.json. Returns True when all hashes match —
        meaning the relay has read and applied every file the backend wrote.
        Files that don't exist yet are skipped (not yet provisioned).
        """
        status = self.status()
        for f in MANAGED_CONFIG_FILES:
            if not self.exists(f):
                continue
            if status.get(f) != self.file_hash(f):
                return False
        return True

    def pending_changes(self) -> list[str]:
        """Config files whose hashes don't match status.json.

        Useful for diagnostics — shows which files the relay hasn't
        applied yet. Returns file paths relative to volume root.
        """
        status = self.status()
        return [
            f for f in MANAGED_CONFIG_FILES
            if self.exists(f) and status.get(f) != self.file_hash(f)
        ]

    def inbox_delivered(self) -> bool:
        """Check if all inbox messages have been consumed.

        Compares inbox.pos (byte offset of last consumed message) against
        inbox.jsonl file size. When they match, the relay has read every
        line the backend appended.
        """
        pos_path = self.root / "_abox" / "inbox.pos"
        inbox_path = self.root / "_abox" / "inbox.jsonl"
        if not inbox_path.exists():
            return True
        pos = int(pos_path.read_text()) if pos_path.exists() else 0
        return pos >= inbox_path.stat().st_size

    def append_inbox(self, message: dict) -> None:
        """Append one JSON-line message to the agent's inbox.

        Backend appends, relay consumes from inbox.pos offset.
        Messages survive relay crashes — unread lines persist.

        Note: concurrent appends from multiple backend processes could
        interleave. In practice, messages to a single agent are serialized
        through the GraphQL mutation layer.
        """
        path = self.root / "_abox" / "inbox.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps(message) + "\n")

    def mutate(self, path: str, content: str | bytes) -> ReloadCommand:
        """Write a reload-registered file and return the reload command.

        This is the ONLY way to write mutable runtime state. The caller
        must send the returned command via push_to_relay(). Using raw
        write() for reload-registered paths is an architectural violation
        caught by tests.

        Raises: ValueError if path is not in RELOAD_REGISTRY.
        """
        if path not in RELOAD_REGISTRY:
            raise ValueError(
                f"Volume.mutate() called with unregistered path '{path}'. "
                f"Registered paths: {sorted(RELOAD_REGISTRY.keys())}. "
                f"Use write() for provision-time config, mutate() for runtime state."
            )
        self.write(path, content)
        return ReloadCommand(path=path)

    def mutate_state(self, model: str, mode: str, allowed_tools: list) -> ReloadCommand:
        """Write _abox/state.json and return the reload command.

        Convenience wrapper around mutate() that centralizes the state
        schema so callers dont construct the dict themselves.
        """
        state = {"model": model, "mode": mode, "allowed_tools": allowed_tools}
        return self.mutate("_abox/state.json", json.dumps(state))

    def initialize(self) -> None:
        """Create empty control plane files and directory structure for a new agent.

        Called during provisioning before any other volume writes.
        Creates the _abox/ directory with empty inbox/outbox files
        and zero-offset cursors, PLUS all directories that init-volume
        will symlink into the container.

        This must run before the container starts so that init-volume's
        existence checks pass. Without this, there's a race: init-volume
        checks for directories before the backend finishes writing to them,
        skips the symlinks, and the container never sees the files.

        Idempotent — safe to call multiple times.
        """
        abox = self.root / "_abox"
        abox.mkdir(parents=True, exist_ok=True)
        for f in ["inbox.jsonl", "outbox.jsonl"]:
            (abox / f).touch(exist_ok=True)
        for f in ["inbox.pos", "outbox.pos"]:
            p = abox / f
            if not p.exists():
                p.write_text("0")
        status = abox / "status.json"
        if not status.exists():
            status.write_text("{}")

        # Clear any stale "provisioning complete" marker from a previous boot.
        # Re-provisioning must re-establish readiness only after the new config
        # set has been fully written.
        sentinel = abox / "provisioned.ready"
        if sentinel.exists():
            sentinel.unlink()

        # Pre-create all directories that init-volume symlinks into the
        # container. This eliminates the race between init-volume's
        # [ -e "$dir" ] checks and backend's subsequent writes.
        for prefix in SYMLINKED_PREFIXES:
            if prefix == "_abox/":
                continue  # already created above
            (self.root / prefix.rstrip("/")).mkdir(parents=True, exist_ok=True)

    def mark_provisioned(self) -> None:
        """Write the provisioning-ready sentinel.

        The container boot oneshot (init-volume) waits for this file before it
        creates symlinks and allows services like svc-relay to start.
        """
        self.write(PROVISIONING_SENTINEL, "")
