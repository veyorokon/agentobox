from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock

from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.status import BuildMetadata, RuntimeSnapshot, StatusDocument
from agent.contracts.transport import TransportSnapshot, TransportState


@dataclass
class MutableRuntimeState:
    mode: AgentMode
    platform: PlatformKind
    profile: RuntimeProfile
    build: BuildMetadata
    startup_stage: StartupStage = StartupStage.CONFIG_LOADING
    runtime_state: RuntimeState = RuntimeState.STARTING
    session_id: str = ""
    client_active: bool = False
    task_id: str = ""
    task_state: str = "idle"
    transport_enabled: bool = False
    transport_state: TransportState = TransportState.DISABLED
    transport_connected: bool = False
    transport_error: str = ""
    services: dict[str, ServiceState] = field(default_factory=dict)
    degraded: list[str] = field(default_factory=list)
    fatal: str | None = None


class RuntimeStateStore:
    def __init__(
        self,
        mode: AgentMode,
        platform: PlatformKind,
        profile: RuntimeProfile = RuntimeProfile.CORE,
        build: BuildMetadata = BuildMetadata(),
    ):
        self._lock = Lock()
        self._state = MutableRuntimeState(
            mode=mode,
            platform=platform,
            profile=profile,
            build=build,
        )

    def update_stage(self, stage: StartupStage) -> None:
        with self._lock:
            self._state.startup_stage = stage

    def update_runtime_state(self, state: RuntimeState) -> None:
        with self._lock:
            self._state.runtime_state = state

    def set_service(self, name: str, state: ServiceState) -> None:
        with self._lock:
            self._state.services[name] = state

    def set_transport(self, *, enabled: bool, state: TransportState, connected: bool, last_error: str = "") -> None:
        with self._lock:
            self._state.transport_enabled = enabled
            self._state.transport_state = state
            self._state.transport_connected = connected
            self._state.transport_error = last_error

    def apply_transport_snapshot(self, snapshot: TransportSnapshot) -> None:
        self.set_transport(
            enabled=snapshot.enabled,
            state=snapshot.state,
            connected=snapshot.connected,
            last_error=snapshot.last_error,
        )

    def set_task(self, *, task_id: str, task_state: str, client_active: bool) -> None:
        with self._lock:
            self._state.task_id = task_id
            self._state.task_state = task_state
            self._state.client_active = client_active

    def set_session(self, session_id: str) -> None:
        with self._lock:
            self._state.session_id = session_id

    def add_degraded(self, reason: str) -> None:
        with self._lock:
            if reason not in self._state.degraded:
                self._state.degraded.append(reason)

    def clear_degraded(self, reason: str) -> None:
        with self._lock:
            self._state.degraded = [r for r in self._state.degraded if r != reason]

    def set_fatal(self, reason: str) -> None:
        with self._lock:
            self._state.fatal = reason
            self._state.startup_stage = StartupStage.FATAL
            self._state.runtime_state = RuntimeState.FATAL

    def on_standalone_runtime_ready(self) -> None:
        with self._lock:
            self._state.startup_stage = StartupStage.RUNTIME_READY
            self._state.runtime_state = RuntimeState.READY
            self._state.transport_enabled = False
            self._state.transport_state = TransportState.DISABLED
            self._state.transport_connected = False
            self._state.transport_error = ""

    def on_managed_transport_connecting(self, snapshot: TransportSnapshot) -> None:
        with self._lock:
            self._state.startup_stage = StartupStage.TRANSPORT_CONNECTING
            self._state.runtime_state = RuntimeState.STARTING
            self._state.transport_enabled = snapshot.enabled
            self._state.transport_state = snapshot.state
            self._state.transport_connected = snapshot.connected
            self._state.transport_error = snapshot.last_error
            self._state.degraded = [r for r in self._state.degraded if not r.startswith("transport:")]

    def on_managed_transport_connected(self, snapshot: TransportSnapshot) -> None:
        with self._lock:
            self._state.startup_stage = StartupStage.MANAGED_READY
            self._state.runtime_state = RuntimeState.READY
            self._state.transport_enabled = snapshot.enabled
            self._state.transport_state = snapshot.state
            self._state.transport_connected = snapshot.connected
            self._state.transport_error = snapshot.last_error
            self._state.degraded = [r for r in self._state.degraded if not r.startswith("transport:")]

    def on_managed_transport_degraded(self, snapshot: TransportSnapshot) -> None:
        reason = f"transport:{snapshot.last_error or snapshot.state.value}"
        with self._lock:
            self._state.startup_stage = StartupStage.DEGRADED
            self._state.runtime_state = RuntimeState.DEGRADED
            self._state.transport_enabled = snapshot.enabled
            self._state.transport_state = snapshot.state
            self._state.transport_connected = snapshot.connected
            self._state.transport_error = snapshot.last_error
            self._state.degraded = [r for r in self._state.degraded if not r.startswith("transport:")]
            self._state.degraded.append(reason)

    def on_managed_transport_fatal(self, snapshot: TransportSnapshot) -> None:
        reason = snapshot.last_error or "transport fatal"
        with self._lock:
            self._state.transport_enabled = snapshot.enabled
            self._state.transport_state = snapshot.state
            self._state.transport_connected = snapshot.connected
            self._state.transport_error = snapshot.last_error
            self._state.degraded = [r for r in self._state.degraded if not r.startswith("transport:")]
        self.set_fatal(reason)

    def transition_transport(self, snapshot: TransportSnapshot) -> None:
        if not snapshot.enabled:
            self.set_transport(
                enabled=False,
                state=snapshot.state,
                connected=snapshot.connected,
                last_error=snapshot.last_error,
            )
            return
        if snapshot.state is TransportState.CONNECTED and snapshot.connected:
            self.on_managed_transport_connected(snapshot)
            return
        if snapshot.state is TransportState.CONNECTING:
            self.on_managed_transport_connecting(snapshot)
            return
        if snapshot.state is TransportState.FATAL:
            self.on_managed_transport_fatal(snapshot)
            return
        self.on_managed_transport_degraded(snapshot)

    def snapshot(self) -> StatusDocument:
        with self._lock:
            runtime = RuntimeSnapshot(
                session_id=self._state.session_id,
                client_active=self._state.client_active,
                task_id=self._state.task_id,
                task_state=self._state.task_state,
            )
            transport = TransportSnapshot(
                enabled=self._state.transport_enabled,
                state=self._state.transport_state,
                connected=self._state.transport_connected,
                last_error=self._state.transport_error,
            )
            return StatusDocument(
                mode=self._state.mode,
                platform=self._state.platform,
                profile=self._state.profile,
                build=self._state.build,
                startup_stage=self._state.startup_stage,
                runtime_state=self._state.runtime_state,
                runtime=runtime,
                transport=transport,
                services=dict(self._state.services),
                degraded=list(self._state.degraded),
                fatal=self._state.fatal,
            )
