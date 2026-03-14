from __future__ import annotations

from pathlib import Path

from agent.contracts.provisioning import ProvisioningReport
from agent.provisioning.base import BaseProvisioningProvider
from agent.provisioning.manifest import CANONICAL_PATHS, standalone_manifest, write_json
from agent.provisioning.validate import validate_manifest


class StandaloneProvisioningProvider(BaseProvisioningProvider):
    def __init__(self, config):
        self._config = config

    def prepare(self, root: Path) -> ProvisioningReport:
        manifest = standalone_manifest()
        (root / "home/agent/workspace").mkdir(parents=True, exist_ok=True)
        (root / "tmp/abox-theme").mkdir(parents=True, exist_ok=True)
        (root / "mnt/abox-state/secrets").mkdir(parents=True, exist_ok=True)
        (root / "_abox").mkdir(parents=True, exist_ok=True)

        write_json(root / CANONICAL_PATHS["runtime_state"], {"mode": "standalone", "model": "", "allowed_tools": []})
        write_json(root / CANONICAL_PATHS["runtime_status"], {})
        (root / CANONICAL_PATHS["provisioned_ready"]).touch()

        validate_manifest(root, manifest)
        return ProvisioningReport(manifest=manifest, root=root)

