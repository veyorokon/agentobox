from __future__ import annotations

import json

from agent.contracts.execution import ExecutorKind
from agent.contracts.lifecycle import RuntimeState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.transport import TransportSnapshot, TransportState
from agent.runtime.config import ManagedConfig, RuntimeConfig
from agent.runtime.lifecycle import LifecycleCoordinator
from agent.runtime.logging import configure_logging_context
from agent.runtime.state import RuntimeStateStore


def _managed_config(tmp_path):
    return RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.MODAL,
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


def test_lifecycle_coordinator_transitions_managed_transport(tmp_path):
    state = RuntimeStateStore(mode=AgentMode.MANAGED, platform=PlatformKind.MODAL)
    lifecycle = LifecycleCoordinator(_managed_config(tmp_path), state)

    lifecycle.begin_boot()
    lifecycle.on_config_validated()
    lifecycle.on_provisioning_wait()
    lifecycle.on_provisioning_validated()
    lifecycle.on_services_starting()
    lifecycle.sync_transport(
        TransportSnapshot(
            enabled=True,
            state=TransportState.CONNECTING,
            connected=False,
            last_error="",
        ),
        force=True,
    )

    connecting = state.snapshot()
    assert connecting.startup_stage is StartupStage.TRANSPORT_CONNECTING
    assert connecting.runtime_state is RuntimeState.STARTING

    lifecycle.sync_transport(
        TransportSnapshot(
            enabled=True,
            state=TransportState.CONNECTED,
            connected=True,
            last_error="",
        )
    )

    ready = state.snapshot()
    assert ready.startup_stage is StartupStage.MANAGED_READY
    assert ready.runtime_state is RuntimeState.READY
    assert ready.transport.connected is True


def test_lifecycle_coordinator_transitions_fatal_transport(tmp_path):
    state = RuntimeStateStore(mode=AgentMode.MANAGED, platform=PlatformKind.MODAL)
    lifecycle = LifecycleCoordinator(_managed_config(tmp_path), state)

    lifecycle.sync_transport(
        TransportSnapshot(
            enabled=True,
            state=TransportState.FATAL,
            connected=False,
            last_error="bad token",
        ),
        force=True,
    )

    status = state.snapshot()
    assert status.startup_stage is StartupStage.FATAL
    assert status.runtime_state is RuntimeState.FATAL
    assert status.fatal == "bad token"


def test_lifecycle_begin_boot_preserves_runtime_log_sink(tmp_path):
    configure_logging_context(
        mode="managed",
        platform="docker",
        profile="desktop",
        agent_id="agent-123",
        image_ref="agentobox-agent-runtime-desktop-managed:latest",
        git_commit="deadbeef",
        root_dir=tmp_path,
    )
    state = RuntimeStateStore(mode=AgentMode.MANAGED, platform=PlatformKind.MODAL)
    lifecycle = LifecycleCoordinator(_managed_config(tmp_path), state)

    lifecycle.begin_boot()
    lifecycle.on_config_validated()

    log_path = tmp_path / "_abox" / "logs" / "runtime.jsonl"
    events = [json.loads(line)["event"] for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert "startup.mode_selected" in events
    assert "startup.config_validated" in events
