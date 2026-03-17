from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.status import BuildMetadata, RuntimeSnapshot, StatusDocument
from agent.contracts.transport import TransportSnapshot, TransportState


def test_status_document_shape():
    status = StatusDocument(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        profile=RuntimeProfile.CORE,
        build=BuildMetadata(
            image_ref="agentobox-agent-runtime:latest",
            image_digest="sha256:abc123",
            git_commit="deadbeef",
        ),
        startup_stage=StartupStage.RUNTIME_READY,
        runtime_state=RuntimeState.READY,
        runtime=RuntimeSnapshot(),
        transport=TransportSnapshot(
            enabled=False,
            state=TransportState.DISABLED,
            connected=False,
        ),
        services={"ingress_http": ServiceState.UP},
    )
    payload = status.to_dict()
    assert payload["status_version"] == "2"
    assert payload["mode"] == "standalone"
    assert payload["platform"] == "local"
    assert payload["profile"] == "core"
    assert payload["build"]["image_ref"] == "agentobox-agent-runtime:latest"
    assert payload["build"]["image_digest"] == "sha256:abc123"
    assert payload["build"]["git_commit"] == "deadbeef"
    assert payload["transport"]["enabled"] is False
    assert payload["services"]["ingress_http"] == "up"
    assert payload["degraded"] == []
    assert payload["fatal"] is None
