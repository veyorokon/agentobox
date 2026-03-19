from __future__ import annotations

import json
import threading
from time import monotonic, sleep

import pytest

from agent.contracts.execution import ExecutorKind
from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.transport import ManagedTransport, TransportSnapshot, TransportState
from agent.provisioning.manifest import CANONICAL_PATHS, write_json
from agent.runtime.app import AgentApplication
from agent.runtime.bootstrap import ManagedBootstrap
from agent.runtime.config import ManagedConfig, RuntimeConfig
from agent.runtime.services import ServiceGraph, ServiceStatus


pytestmark = pytest.mark.contract


class FakeManagedTransport(ManagedTransport):
    def __init__(self, snapshot: TransportSnapshot):
        self._snapshot = snapshot

    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None

    def snapshot(self) -> TransportSnapshot:
        return self._snapshot


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

    def start_all(self) -> None:
        return None

    def stop_all(self) -> None:
        return None

    def statuses(self):
        return {
            "agentobox_relay": ServiceStatus(
                name="agentobox_relay",
                state=ServiceState.UP,
                required_for_readiness=True,
            )
        }


def _managed_config(tmp_path) -> RuntimeConfig:
    return RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.DOCKER,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )


def _write_managed_contract(root) -> None:
    (root / "home/agent").mkdir(parents=True, exist_ok=True)
    (root / "_abox").mkdir(parents=True, exist_ok=True)
    (root / CANONICAL_PATHS["relay_env"]).write_text("RELAY_AUTH_TOKEN=token\n")
    write_json(root / CANONICAL_PATHS["runtime_state"], {"mode": "managed"})
    write_json(root / CANONICAL_PATHS["runtime_status"], {})
    (root / CANONICAL_PATHS["provisioned_ready"]).write_text("token")


def test_managed_boot_contract_waits_for_provisioning_then_reaches_ready(tmp_path):
    config = _managed_config(tmp_path)
    transport = FakeManagedTransport(
        TransportSnapshot(
            enabled=True,
            state=TransportState.CONNECTED,
            connected=True,
            last_error="",
        )
    )

    writer = threading.Thread(
        target=_delayed_write_contract,
        args=(tmp_path,),
        kwargs={"delay_s": 0.05},
        daemon=True,
    )
    writer.start()

    result = ManagedBootstrap(config).wait_until_ready(timeout_s=2.0, poll_interval_s=0.01)
    assert result.root_dir == tmp_path
    assert result.attempts >= 2

    app = AgentApplication(
        config,
        transport=transport,
        ingress_factory=FakeIngressServer,
        service_group_factory=FakeServiceGroup,
    )
    app.boot()
    try:
        deadline = monotonic() + 2
        while monotonic() < deadline:
            status = app.status()
            if status.startup_stage is StartupStage.MANAGED_READY:
                break
            sleep(0.05)
        else:
            assert False, "managed app did not reach ready after bootstrap"

        assert status.runtime_state is RuntimeState.READY
        assert status.transport.connected is True
        assert status.services["agentobox_relay"] is ServiceState.UP

        deadline = monotonic() + 2
        while monotonic() < deadline:
            projected = json.loads((tmp_path / CANONICAL_PATHS["runtime_status"]).read_text())
            if projected["startup_stage"] == "managed_ready":
                break
            sleep(0.05)
        else:
            assert False, "projected managed status did not reach managed_ready"

        assert projected["transport"]["connected"] is True
        assert projected["runtime_state"] == "ready"
    finally:
        app.shutdown()
        writer.join(timeout=1.0)


def _delayed_write_contract(root, *, delay_s: float) -> None:
    sleep(delay_s)
    _write_managed_contract(root)
