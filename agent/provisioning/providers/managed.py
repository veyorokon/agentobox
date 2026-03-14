from __future__ import annotations

from pathlib import Path

from agent.contracts.provisioning import ProvisioningReport
from agent.provisioning.base import BaseProvisioningProvider
from agent.provisioning.manifest import managed_manifest
from agent.provisioning.validate import validate_manifest


class ManagedProvisioningProvider(BaseProvisioningProvider):
    def __init__(self, config):
        self._config = config

    def prepare(self, root: Path) -> ProvisioningReport:
        manifest = managed_manifest()
        # Managed mode requires an external provider to populate the canonical
        # runtime-visible files before startup is released. This provider does
        # not create them — it validates that the managed provisioning contract
        # has already been satisfied.
        validate_manifest(root, manifest)
        return ProvisioningReport(manifest=manifest, root=root)
