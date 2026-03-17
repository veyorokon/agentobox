"""Shared constants for architecture tests.

These tests are cross-boundary — they read source files from both backend/
and agent/ to verify structural invariants. No Django dependency.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
AGENT_DIR = REPO_ROOT / "agent"
SERVICES_DIR = BACKEND_DIR / "agents" / "services"

# Agent runtime Python source
AGENT_RUNTIME_DIR = AGENT_DIR / "runtime"
AGENT_CONTRACTS_DIR = AGENT_DIR / "contracts"
AGENT_TRANSPORTS_DIR = AGENT_DIR / "transports"
