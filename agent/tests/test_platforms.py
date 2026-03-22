import sys

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
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


def test_docker_platform_exec_runs_command():
    platform = build_platform(PlatformKind.DOCKER)
    result = platform.exec([sys.executable, "-c", "print('hello from docker platform')"])

    assert result.exit_code == 0
    assert result.stdout.strip() == "hello from docker platform"
    assert result.stderr == ""


def test_modal_platform_exec_runs_command():
    platform = build_platform(PlatformKind.MODAL)
    result = platform.exec([sys.executable, "-c", "print('hello from modal platform')"])

    assert result.exit_code == 0
    assert result.stdout.strip() == "hello from modal platform"
    assert result.stderr == ""


def test_local_platform_has_empty_service_graph():
    platform = build_platform(PlatformKind.LOCAL)

    graph = platform.service_graph(AgentMode.STANDALONE, RuntimeProfile.CORE)

    assert graph.startup_order() == []


def test_docker_and_modal_share_canonical_core_service_graph():
    docker_graph = build_platform(PlatformKind.DOCKER).service_graph(
        AgentMode.STANDALONE, RuntimeProfile.CORE
    )
    modal_graph = build_platform(PlatformKind.MODAL).service_graph(
        AgentMode.STANDALONE, RuntimeProfile.CORE
    )

    docker_names = [spec.name for spec in docker_graph.startup_order()]
    modal_names = [spec.name for spec in modal_graph.startup_order()]
    assert docker_names == modal_names == []


def test_desktop_service_graph_declares_visual_stack():
    graph = build_platform(PlatformKind.MODAL).service_graph(
        AgentMode.MANAGED, RuntimeProfile.DESKTOP
    )

    names = [spec.name for spec in graph.startup_order()]
    assert names == ["xvfb", "x11vnc", "websockify", "awesome"]
