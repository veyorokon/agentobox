from __future__ import annotations

from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.status import BuildMetadata, RuntimeSnapshot, StatusDocument
from agent.contracts.transport import TransportSnapshot, TransportState
from agent.runtime.health import readyz_payload


def _managed_desktop_status(*, x11vnc: ServiceState = ServiceState.UP) -> StatusDocument:
    return StatusDocument(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.MODAL,
        profile=RuntimeProfile.DESKTOP,
        build=BuildMetadata(),
        startup_stage=StartupStage.MANAGED_READY,
        runtime_state=RuntimeState.READY,
        runtime=RuntimeSnapshot(),
        transport=TransportSnapshot(
            enabled=True,
            state=TransportState.CONNECTED,
            connected=True,
            last_error="",
        ),
        services={
            "xvfb": ServiceState.UP,
            "x11vnc": x11vnc,
            "websockify": ServiceState.UP,
            "awesome": ServiceState.UP,
        },
    )


def test_readyz_requires_desktop_services_for_managed_runtime():
    code, payload = readyz_payload(_managed_desktop_status(x11vnc=ServiceState.DOWN))
    assert code == 503
    assert payload["status"] == "not_ready"


def test_readyz_accepts_fully_ready_desktop_runtime():
    code, payload = readyz_payload(_managed_desktop_status())
    assert code == 200
    assert payload["status"] == "ready"
