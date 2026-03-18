"""Lifecycle coordination for the agent runtime.

This module owns transition policy. The app wires components together; the
coordinator decides how component facts become canonical runtime state.
"""

from __future__ import annotations

from agent.contracts.events import RuntimeEvent
from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.transport import TransportSnapshot, TransportState
from agent.runtime.config import RuntimeConfig
from agent.runtime.logging import configure_logging_context, emit_event
from agent.runtime.state import RuntimeStateStore
from agent.runtime.services import ServiceStatus


class LifecycleCoordinator:
    """Translate boot, service, and transport facts into canonical state."""

    def __init__(self, config: RuntimeConfig, state: RuntimeStateStore):
        self._config = config
        self._state = state
        self._last_transport_snapshot: TransportSnapshot | None = None
        self._last_service_statuses: dict[str, ServiceStatus] | None = None
        self._last_blocked_required: tuple[str, ...] | None = None

    def begin_boot(self) -> None:
        configure_logging_context(
            mode=self._config.mode.value,
            platform=self._config.platform.value,
            profile=self._config.profile.value,
            agent_id=self._config.managed.agent_id if self._config.managed else "",
            image_ref=self._config.build.image_ref,
            git_commit=self._config.build.git_commit,
            root_dir=self._config.root_dir,
        )
        self._state.update_stage(StartupStage.CONFIG_LOADING)
        self._state.update_runtime_state(RuntimeState.STARTING)
        self._state.set_service("ingress_http", ServiceState.DOWN)
        self._state.set_service("managed_transport", ServiceState.DOWN)
        emit_event(RuntimeEvent.STARTUP_MODE_SELECTED.value, mode=self._config.mode.value)

    def on_config_validated(self) -> None:
        self._state.update_stage(StartupStage.CONFIG_VALIDATED)
        emit_event(RuntimeEvent.STARTUP_CONFIG_VALIDATED.value)

    def on_provisioning_wait(self) -> None:
        self._state.update_stage(StartupStage.PROVISIONING_WAIT)
        emit_event(RuntimeEvent.PROVISIONING_RELEASE_WAIT.value, root_dir=str(self._config.root_dir))

    def on_provisioning_validated(self) -> None:
        self._state.update_stage(StartupStage.PROVISIONING_VALIDATED)
        emit_event(RuntimeEvent.PROVISIONING_RELEASE_COMPLETE.value)

    def on_services_starting(self) -> None:
        self._state.update_stage(StartupStage.SERVICES_STARTING)

    def on_platform_created(self) -> None:
        emit_event(RuntimeEvent.PLATFORM_CREATED.value, platform=self._config.platform.value)

    def on_ingress_started(self) -> None:
        self._state.set_service("ingress_http", ServiceState.UP)

    def on_standalone_runtime_ready(self) -> None:
        self._state.on_standalone_runtime_ready()
        emit_event(RuntimeEvent.RUNTIME_READY.value)

    def sync_services(self, statuses: dict[str, ServiceStatus], *, force: bool = False) -> None:
        if not force and statuses == self._last_service_statuses:
            return
        previous = self._last_service_statuses or {}
        self._last_service_statuses = dict(statuses)
        for service in statuses.values():
            self._state.set_service(service.name, service.state)
            prior = previous.get(service.name)
            if force or prior is None or prior.state is not service.state:
                emit_event(
                    RuntimeEvent.SERVICE_STATE_CHANGED.value,
                    service=service.name,
                    state=service.state.value,
                    required_for_readiness=service.required_for_readiness,
                )
        blocked_required = tuple(
            sorted(
                service.name
                for service in statuses.values()
                if service.required_for_readiness and service.state is not ServiceState.UP
            )
        )
        if force or blocked_required != self._last_blocked_required:
            self._last_blocked_required = blocked_required
            emit_event(
                RuntimeEvent.SERVICE_READINESS_BLOCKED.value,
                blocked_required=list(blocked_required),
                blocked_count=len(blocked_required),
            )

    def sync_transport(self, snapshot: TransportSnapshot, *, force: bool = False) -> None:
        if not force and snapshot == self._last_transport_snapshot:
            return
        self._last_transport_snapshot = snapshot
        self._state.transition_transport(snapshot)
        if snapshot.state is TransportState.CONNECTED and snapshot.connected:
            self._state.set_service("managed_transport", ServiceState.UP)
            emit_event(RuntimeEvent.RUNTIME_READY.value, mode=self._config.mode.value)
            return
        self._state.set_service("managed_transport", ServiceState.DEGRADED)

    def on_shutdown_started(self) -> None:
        self._state.set_service("ingress_http", ServiceState.DOWN)
        self._state.set_service("managed_transport", ServiceState.DOWN)

    def on_platform_terminated(self) -> None:
        emit_event(RuntimeEvent.PLATFORM_TERMINATED.value, platform=self._config.platform.value)

    def on_shutdown_complete(self) -> None:
        self._state.update_runtime_state(RuntimeState.STOPPED)

    @property
    def mode(self) -> AgentMode:
        return self._config.mode
