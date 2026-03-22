"""Managed runtime bootstrap.

This module owns the boot-time wait/validate behavior for managed mode before
the long-lived runtime process starts. It keeps the provisioning contract
explicit and prevents image entrypoints from reintroducing ad hoc shell loops.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import monotonic, sleep
from typing import Callable

from agent.contracts.mode import AgentMode
from agent.contracts.events import RuntimeEvent
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.provisioning.providers.managed import ManagedProvisioningProvider
from agent.provisioning.validate import ProvisioningValidationError
from agent.runtime.config import RuntimeConfig
from agent.runtime.logging import emit_event


Sleeper = Callable[[float], None]
Clock = Callable[[], float]


class ManagedBootstrapError(RuntimeError):
    """Raised when the managed runtime cannot satisfy its provisioning contract."""


@dataclass(frozen=True)
class ManagedBootstrapResult:
    root_dir: Path
    provisioned_ready_path: Path
    attempts: int


class ManagedBootstrap:
    """Wait for and validate managed provisioning before runtime startup."""

    def __init__(
        self,
        config: RuntimeConfig,
        *,
        provider: ManagedProvisioningProvider | None = None,
        sleeper: Sleeper = sleep,
        clock: Clock = monotonic,
    ):
        if config.mode is not AgentMode.MANAGED:
            raise ValueError("ManagedBootstrap requires AGENTOBOX_MODE=managed")
        self._config = config
        self._provider = provider or ManagedProvisioningProvider(config)
        self._sleeper = sleeper
        self._clock = clock

    def wait_until_ready(
        self,
        *,
        timeout_s: float = 120.0,
        poll_interval_s: float = 0.25,
    ) -> ManagedBootstrapResult:
        """Block until the managed provisioning contract is satisfied."""

        deadline = self._clock() + timeout_s
        started_at = self._clock()
        attempts = 0
        last_error = ""
        root_dir = self._config.root_dir
        provisioned_ready_path = root_dir / CANONICAL_PATHS["provisioned_ready"]

        while self._clock() < deadline:
            attempts += 1
            try:
                self._provider.prepare(root_dir)
                emit_event(
                    RuntimeEvent.PROVISIONING_RELEASE_COMPLETE.value,
                    source="managed_bootstrap",
                    attempts=attempts,
                    elapsed_s=round(self._clock() - started_at, 3),
                    root_dir=str(root_dir),
                )
                return ManagedBootstrapResult(
                    root_dir=root_dir,
                    provisioned_ready_path=provisioned_ready_path,
                    attempts=attempts,
                )
            except ProvisioningValidationError as exc:
                last_error = str(exc)
                if attempts == 1 or attempts % 10 == 0:
                    emit_event(
                        RuntimeEvent.PROVISIONING_VALIDATION_FAILED.value,
                        source="managed_bootstrap",
                        attempts=attempts,
                        elapsed_s=round(self._clock() - started_at, 3),
                        next_poll_s=poll_interval_s,
                        root_dir=str(root_dir),
                        error=last_error,
                    )
                self._sleeper(poll_interval_s)

        raise ManagedBootstrapError(
            "managed provisioning did not become ready within "
            f"{timeout_s:.1f}s (attempts={attempts}, last_error={last_error or 'unknown'})"
        )
