import json

from agent.contracts.lifecycle import RuntimeState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.status import BuildMetadata, RuntimeSnapshot, StatusDocument
from agent.contracts.transport import TransportSnapshot, TransportState
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.projection import RuntimeStatusProjector


def test_runtime_status_projector_writes_canonical_status_file(tmp_path):
    projector = RuntimeStatusProjector(tmp_path)
    written = projector.project(
        StatusDocument(
            mode=AgentMode.STANDALONE,
            platform=PlatformKind.LOCAL,
            profile=RuntimeProfile.CORE,
            build=BuildMetadata(image_ref="agentobox-agent-runtime:latest"),
            startup_stage=StartupStage.RUNTIME_READY,
            runtime_state=RuntimeState.READY,
            runtime=RuntimeSnapshot(task_id="task-1", task_state="completed"),
            transport=TransportSnapshot(
                enabled=False,
                state=TransportState.DISABLED,
                connected=False,
            ),
        )
    )

    assert written is True
    payload = json.loads((tmp_path / CANONICAL_PATHS["runtime_status"]).read_text())
    assert payload["startup_stage"] == "runtime_ready"
    assert payload["build"]["image_ref"] == "agentobox-agent-runtime:latest"
    assert payload["runtime"]["task_id"] == "task-1"


def test_runtime_status_projector_skips_identical_payloads(tmp_path):
    projector = RuntimeStatusProjector(tmp_path)
    status = StatusDocument(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        profile=RuntimeProfile.CORE,
        build=BuildMetadata(),
        startup_stage=StartupStage.RUNTIME_READY,
        runtime_state=RuntimeState.READY,
        runtime=RuntimeSnapshot(),
        transport=TransportSnapshot(
            enabled=False,
            state=TransportState.DISABLED,
            connected=False,
        ),
    )

    assert projector.project(status) is True
    assert projector.project(status) is False
