from __future__ import annotations

from time import monotonic, sleep

from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.transport import ManagedTransport, TransportSnapshot, TransportState
from agent.provisioning.manifest import CANONICAL_PATHS, write_json
from agent.runtime.app import AgentApplication
from agent.runtime.config import ManagedConfig, RuntimeConfig
from agent.runtime.services import ServiceGraph, ServiceStatus


class FakeManagedTransport(ManagedTransport):
    def __init__(self, initial: TransportSnapshot):
        self._snapshot = initial

    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None

    def snapshot(self) -> TransportSnapshot:
        return self._snapshot

    def set_snapshot(self, snapshot: TransportSnapshot) -> None:
        self._snapshot = snapshot


class FakeIngressServer:
    def __init__(self, host: str, port: int, app_ref):
        self.host = host
        self.port = port

    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None


class FakeServiceGroup:
    def __init__(self, graph: ServiceGraph):
        self.graph = graph
        self.started = False
        self.stopped = False

    def start_all(self) -> None:
        self.started = True

    def stop_all(self) -> None:
        self.stopped = True

    def statuses(self):
        return {
            "agentobox_relay": ServiceStatus(
                name="agentobox_relay",
                state=ServiceState.UP,
                required_for_readiness=True,
            )
        }


def _managed_config(tmp_path):
    (tmp_path / "home/agent").mkdir(parents=True, exist_ok=True)
    (tmp_path / "_abox").mkdir(parents=True, exist_ok=True)
    (tmp_path / CANONICAL_PATHS["relay_env"]).write_text("RELAY_AUTH_TOKEN=test\n")
    write_json(tmp_path / CANONICAL_PATHS["runtime_state"], {"mode": "managed"})
    write_json(tmp_path / CANONICAL_PATHS["runtime_status"], {})
    (tmp_path / CANONICAL_PATHS["provisioned_ready"]).touch()

    return RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.MODAL,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )


def test_managed_app_transitions_to_degraded_when_transport_fails(tmp_path):
    transport = FakeManagedTransport(
        TransportSnapshot(
            enabled=True,
            state=TransportState.DEGRADED,
            connected=False,
            last_error="boom",
        )
    )
    app = AgentApplication(
        _managed_config(tmp_path),
        transport=transport,
        ingress_factory=FakeIngressServer,
        service_group_factory=FakeServiceGroup,
    )

    app.boot()
    try:
        status = app.status()
        assert status.startup_stage is StartupStage.DEGRADED
        assert status.runtime_state is RuntimeState.DEGRADED
        assert status.services["agentobox_relay"] is ServiceState.UP
        assert status.transport.enabled is True
        assert status.transport.state is TransportState.DEGRADED
        assert status.transport.connected is False
        assert status.transport.last_error == "boom"
    finally:
        app.shutdown()


def test_managed_app_observes_transport_and_becomes_ready(tmp_path):
    transport = FakeManagedTransport(
        TransportSnapshot(
            enabled=True,
            state=TransportState.CONNECTING,
            connected=False,
            last_error="",
        )
    )
    app = AgentApplication(
        _managed_config(tmp_path),
        transport=transport,
        ingress_factory=FakeIngressServer,
        service_group_factory=FakeServiceGroup,
    )

    app.boot()
    try:
        initial = app.status()
        assert initial.startup_stage is StartupStage.TRANSPORT_CONNECTING
        assert initial.runtime_state is RuntimeState.STARTING

        transport.set_snapshot(
            TransportSnapshot(
                enabled=True,
                state=TransportState.CONNECTED,
                connected=True,
                last_error="",
            )
        )

        deadline = monotonic() + 2
        while monotonic() < deadline:
            status = app.status()
            if status.startup_stage is StartupStage.MANAGED_READY:
                break
            sleep(0.05)
        else:
            assert False, "managed app did not observe transport readiness"

        assert status.runtime_state is RuntimeState.READY
        assert status.services["agentobox_relay"] is ServiceState.UP
        assert status.transport.connected is True
        assert status.transport.state is TransportState.CONNECTED
    finally:
        app.shutdown()
