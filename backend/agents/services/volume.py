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
              .credentials.json           # CC OAuth credential file
              skills/                     # per-agent skill assignments
            .relay_env                    # relay process env vars
            CLAUDE.md                     # agent-private instructions
            .claude.json                  # onboarding state
            .mcp.json                     # agent-private MCP config
          tmp/abox-theme/                 # mirrors /tmp/abox-theme/
            tokens.json                   # source: backend writes CSS tokens
            theme.css                     # derived: converter writes
            awesome.lua                   # derived: converter writes
            theme.json                    # derived: reference copy
          run/                            # mirrors /run/
            secrets/
              proxy_key                   # API proxy key (0600)
              mcp-{name}/{KEY}            # per-MCP scoped secrets
          mnt/abox-state/                 # mirrors /mnt/abox-state/
            secrets/env                   # shell-sourceable secrets export
          _abox/                          # control plane (NOT mirrored into container)
            state.json                    # {model, mode, allowed_tools}
            status.json                   # runtime status document (agent-owned projection)
            inbox.jsonl                   # messages to agent (backend appends)
            inbox.cursor.json             # durable runtime-owned inbox cursor
            provisioned.ready             # managed bootstrap release sentinel

## From agent perspective (inside container)

    Boot oneshot (init-volume) creates symlinks before any service starts.
    AGENT_ID env var selects the agent's subdir within the shared volume:

        /home/agent/.claude       → /vol/agents/$AGENT_ID/home/agent/.claude
        /home/agent/.relay_env    → /vol/agents/$AGENT_ID/home/agent/.relay_env
        /tmp/abox-theme           → /vol/agents/$AGENT_ID/tmp/abox-theme
        /run/secrets              → /vol/agents/$AGENT_ID/run/secrets
        /mnt/abox-state           → /vol/agents/$AGENT_ID/mnt/abox-state

    The agent sees a normal filesystem. It doesn't know about the volume.
    Backend writes are immediately visible because they're the same files.

## Runtime status

    _abox/status.json remains an agent-owned machine artifact written by the
    runtime. Backend-visible runtime truth is consumed from the control-plane
    projection published by the runtime over relay.

## Delivery guarantee

    Backend appends to inbox.jsonl and sends a reload. The runtime tracks its
    durable read position in _abox/inbox.cursor.json, so unread messages
    survive relay crashes without a backend-visible delivery cursor.

## Shared workspace

    - /workspace is the shared project mount presented inside the container
    - when a host/project workspace is mounted, it is project-shared state, not
      agent-private volume authority
    - /etc/sudoers.d/ (system file, still written via runtime.exec)
    - /opt/abox/ (image-baked scripts, not agent state)
"""

import json
from pathlib import Path

from agents.services.project_volume import (
    AgentMachinePaths,
    LocalProjectVolumeStore,
    ProjectVolumeStore,
)
from agents.services.relay_commands import ReloadCommand
from agents.services.themes import format_theme_document
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
    "mnt/abox-state/",   # explicit: ln -sfn
    "_abox/",            # control plane — accessed directly via /vol/, not symlinked
)

# Provision-time readiness sentinel.
# init-volume waits for this file before creating symlinks and releasing
# longrun services. This is stronger than checking for _abox/ alone because
# _abox is created early by initialize(), before the rest of provisioning
# files necessarily exist.
PROVISIONING_SENTINEL = "_abox/provisioned.ready"

# Config files the backend manages. Some are runtime-reloadable
# (`_abox/state.json`, theme tokens); others are agent-private files that
# Claude reads fresh on the next invocation (`CLAUDE.md`, `.mcp.json`).
MANAGED_CONFIG_FILES = [
    "home/agent/.claude/settings.json",
    "home/agent/CLAUDE.md",
    "home/agent/.mcp.json",
    "home/agent/.claude.json",
    "home/agent/.relay_env",
    "tmp/abox-theme/tokens.json",
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
}

# Flattened set of all state fields owned by the volume.
# Used by arch tests to verify no DB dual-writes.
VOLUME_OWNED_FIELDS: set[str] = set().union(*RELOAD_REGISTRY.values())


class AgentMachine:
    """Filesystem interface for one agent's canonical machine surface.

    All paths are relative to the volume root and mirror container paths
    exactly (Mirror, Don't Map principle). A path like "home/agent/.claude/settings.json"
    on the volume corresponds to /home/agent/.claude/settings.json in the
    container, connected via symlink.

    Write operations are atomic: write to .tmp then os.rename(). Both
    files live on the same filesystem (Docker named volume), so rename
    is guaranteed atomic by POSIX.

    Usage:
        machine = agent.machine                     # from Agent model property
        machine.write("home/agent/.claude/settings.json", json_content)
        machine.write_secret("run/secrets/proxy_key", key, mode=0o600)
        machine.append_inbox({"type": "task", "task_id": "...", "input": {...}})
    """

    def __init__(
        self,
        project_id: str,
        agent_id: str,
        *,
        store: ProjectVolumeStore | None = None,
    ):
        self._machine = AgentMachinePaths(project_id=project_id, agent_id=agent_id)
        self._store = store or LocalProjectVolumeStore(Path(app_config.volume_root))
        self.root = self._store.local_machine_root(self._machine)

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
        body = content if isinstance(content, bytes) else content.encode()
        self._store.write_bytes(self._machine, path, body)

    def write_secret(self, path: str, content: str | bytes, mode: int = 0o600) -> None:
        """Atomic write with restricted permissions.

        Used for API keys and MCP secrets. Permissions propagate
        through Docker bind mount to the container.
        """
        self.write(path, content)
        self._store.chmod(self._machine, path, mode)

    def read(self, path: str) -> str:
        return self._store.read_text(self._machine, path)

    def read_bytes(self, path: str) -> bytes:
        return self._store.read_bytes(self._machine, path)

    def read_bytes_limited(self, path: str, max_bytes: int) -> tuple[bytes, bool]:
        """Read up to max_bytes from a file. Returns (data, was_truncated)."""
        return self._store.read_bytes_limited(self._machine, path, max_bytes)

    def exists(self, path: str) -> bool:
        return self._store.exists(self._machine, path)

    def remove_tree(self, path: str) -> None:
        self._validate_path(path)
        self._store.remove_tree(self._machine, path)

    def skill_dir(self, safe_name: str) -> str:
        return self._machine.skill_dir(safe_name)

    def skill_file(self, safe_name: str) -> str:
        return self._machine.skill_file(safe_name)

    def mounted_root(self) -> str:
        return self._machine.mounted_root()

    def mounted_path(self, path: str) -> str:
        return self._machine.mounted_path(path)

    def archive_entry(self, path: str = "") -> str:
        return self._machine.archive_entry(path)

    def runtime_log_tail(self, limit: int = 20) -> list[dict]:
        """Read the last structured runtime log events from _abox/logs/runtime.jsonl."""
        path = "_abox/logs/runtime.jsonl"
        if not self.exists(path):
            return []
        lines = [line for line in self.read(path).splitlines() if line.strip()]
        tail = lines[-max(1, limit):]
        events: list[dict] = []
        for line in tail:
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                events.append(payload)
        return events

    def write_runtime_diagnostics(self, payload: dict) -> None:
        """Persist the latest runtime crash diagnostics bundle for this agent."""
        self.write("_abox/runtime-diagnostics.json", json.dumps(payload, indent=2, sort_keys=True))

    def append_inbox(self, message: dict) -> None:
        """Append one JSON-line message to the agent's inbox.

        Backend appends, runtime consumes using its durable inbox cursor.

        Note: concurrent appends from multiple backend processes could
        interleave. In practice, messages to a single agent are serialized
        through the GraphQL mutation layer.
        """
        self._store.append_text(self._machine, "_abox/inbox.jsonl", json.dumps(message) + "\n")

    def append_task(self, *, task_id: str, content: list, role: str = "user") -> None:
        """Append one canonical task envelope to the agent inbox."""

        self.append_inbox({
            "type": "task",
            "task_id": task_id,
            "input": {
                "role": role,
                "content": content,
            },
        })

    def write_theme_document(self, tokens: dict[str, str], *, name: str = "") -> None:
        """Write the canonical runtime theme document to tokens.json."""

        self.write("tmp/abox-theme/tokens.json", format_theme_document(tokens, name=name))

    def mutate_theme_document(self, tokens: dict[str, str], *, name: str = "") -> ReloadCommand:
        """Write the canonical runtime theme document and return a reload command."""

        return self.mutate("tmp/abox-theme/tokens.json", format_theme_document(tokens, name=name))

    def write_state_document(self, model: str, mode: str, allowed_tools: list) -> None:
        """Write the canonical runtime state document to _abox/state.json."""

        self.write("_abox/state.json", json.dumps({
            "model": model,
            "mode": mode,
            "allowed_tools": allowed_tools,
        }))

    def write_mcp_config(self, content: str | bytes) -> None:
        """Write the canonical agent-private MCP config document."""

        self.write("home/agent/.mcp.json", content)

    def write_secrets_env_document(self, content: str | bytes) -> None:
        """Write the shared shell-sourceable secrets export."""

        self.write_secret("mnt/abox-state/secrets/env", content)

    def write_mcp_secret(self, server_name: str, key: str, value: str | bytes) -> None:
        """Write one scoped MCP secret under the canonical machine path."""

        self.write_secret(f"run/secrets/mcp-{server_name}/{key}", value)

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
        Creates the _abox/ directory with the canonical control-plane files,
        PLUS all directories that init-volume
        will symlink into the container.

        This must run before the container starts so that init-volume's
        existence checks pass. Without this, there's a race: init-volume
        checks for directories before the backend finishes writing to them,
        skips the symlinks, and the container never sees the files.

        Idempotent — safe to call multiple times.
        """
        self._store.mkdir(self._machine, "_abox")
        if not self.exists("_abox/inbox.jsonl"):
            self._store.write_bytes(self._machine, "_abox/inbox.jsonl", b"")
        if not self.exists("_abox/status.json"):
            self._store.write_bytes(self._machine, "_abox/status.json", b"{}")

        # Clear any stale "provisioning complete" marker from a previous boot.
        # Re-provisioning must re-establish readiness only after the new config
        # set has been fully written.
        self._store.unlink(self._machine, "_abox/provisioned.ready")

        # Pre-create all directories that init-volume symlinks into the
        # container. This eliminates the race between init-volume's
        # [ -e "$dir" ] checks and backend's subsequent writes.
        for prefix in SYMLINKED_PREFIXES:
            if prefix == "_abox/":
                continue  # already created above
            self._store.mkdir(self._machine, prefix.rstrip("/"))

        # Ensure workspace dir exists even without a host bind mount.
        # The executor uses this as cwd for Claude Code.
        self._store.mkdir(self._machine, "workspace")

    def mark_provisioned(self, token: str = "") -> None:
        """Write the provisioning-ready sentinel.

        The container boot oneshot (init-volume) waits for this file before it
        creates symlinks and allows services like svc-relay to start.
        """
        self.write(PROVISIONING_SENTINEL, token)


# Compatibility alias while the codebase converges on the machine vocabulary.
Volume = AgentMachine
