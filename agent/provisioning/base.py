from __future__ import annotations

from pathlib import Path

from agent.contracts.provisioning import ProvisioningReport, ProvisioningProvider


class BaseProvisioningProvider(ProvisioningProvider):
    def prepare(self, root: Path) -> ProvisioningReport:
        raise NotImplementedError

