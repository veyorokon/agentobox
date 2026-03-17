"""Runtime-owned projection of live state onto canonical filesystem artifacts.

The runtime's live source of truth remains in memory. This module is only
responsible for publishing selected projections, such as `_abox/status.json`,
so other components can observe the runtime without becoming the authority for
its state.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Protocol

from agent.contracts.status import StatusDocument
from agent.provisioning.manifest import CANONICAL_PATHS


class StatusProjector(Protocol):
    """Writes live runtime status into runtime-visible durable artifacts."""

    def project(self, status: StatusDocument) -> bool: ...


class RuntimeStatusProjector:
    """Publish `StatusDocument` snapshots to canonical `_abox/status.json`.

    The file is replaced atomically so readers never observe a partially
    written JSON document.
    """

    def __init__(self, root_dir: Path):
        self._status_path = root_dir / CANONICAL_PATHS["runtime_status"]
        self._last_payload: dict | None = None

    def project(self, status: StatusDocument) -> bool:
        payload = status.to_dict()
        if payload == self._last_payload:
            return False
        self._status_path.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps(payload, indent=2)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=self._status_path.parent,
            delete=False,
        ) as tmp:
            tmp.write(body)
            tmp_path = Path(tmp.name)
        tmp_path.replace(self._status_path)
        self._last_payload = payload
        return True
