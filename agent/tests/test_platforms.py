import sys

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.platform.docker import DockerPlatformAdapter
from agent.platform.factory import build_platform
from agent.platform.local import LocalPlatformAdapter
from agent.platform.modal import ModalPlatformAdapter


def test_platform_factory():
    assert isinstance(build_platform(PlatformKind.LOCAL), LocalPlatformAdapter)
    assert isinstance(build_platform(PlatformKind.DOCKER), DockerPlatformAdapter)
    assert isinstance(build_platform(PlatformKind.MODAL), ModalPlatformAdapter)


def test_local_platform_exec_runs_command():
    platform = build_platform(PlatformKind.LOCAL)
    result = platform.exec([sys.executable, "-c", "print('hello from local platform')"])

    assert result.exit_code == 0
    assert result.stdout.strip() == "hello from local platform"
    assert result.stderr == ""


def test_local_platform_has_empty_service_graph():
    platform = build_platform(PlatformKind.LOCAL)

    graph = platform.service_graph(AgentMode.STANDALONE)

    assert graph.startup_order() == []


def test_docker_and_modal_share_canonical_standalone_service_graph():
    docker_graph = build_platform(PlatformKind.DOCKER).service_graph(AgentMode.STANDALONE)
    modal_graph = build_platform(PlatformKind.MODAL).service_graph(AgentMode.STANDALONE)

    docker_names = [spec.name for spec in docker_graph.startup_order()]
    modal_names = [spec.name for spec in modal_graph.startup_order()]
    assert docker_names == modal_names == ["xvfb", "x11vnc", "websockify", "mcp_gateway", "api_proxy"]


def test_managed_service_graph_adds_agentobox_relay():
    graph = build_platform(PlatformKind.MODAL).service_graph(AgentMode.MANAGED)

    names = [spec.name for spec in graph.startup_order()]
    relay = graph.specs["agentobox_relay"]
    assert names[-1] == "agentobox_relay"
    assert relay.required_for_readiness is True
