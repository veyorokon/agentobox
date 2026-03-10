"""Shared constants for architecture tests.

These tests are cross-boundary — they read source files from both backend/
and agent/ to verify structural invariants. No Django dependency.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
AGENT_DIR = REPO_ROOT / "agent"
SERVICES_DIR = BACKEND_DIR / "agents" / "services"
RELAY_PATH = AGENT_DIR / "claude" / "rootfs" / "opt" / "abox" / "relay.py"

# Agent-side Python roots (base image + claude overlay)
AGENT_PY_ROOTS = [
    AGENT_DIR / "rootfs" / "opt" / "abox",
    AGENT_DIR / "claude" / "rootfs" / "opt" / "abox",
]
