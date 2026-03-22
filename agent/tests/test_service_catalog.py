from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.runtime.service_catalog import service_graph_for_platform


def test_service_catalog_core_profile_is_empty():
    graph = service_graph_for_platform(
        PlatformKind.DOCKER,
        AgentMode.STANDALONE,
        RuntimeProfile.CORE,
    )

    assert graph.startup_order() == []


def test_service_catalog_desktop_profile_declares_dependencies():
    graph = service_graph_for_platform(
        PlatformKind.MODAL,
        AgentMode.MANAGED,
        RuntimeProfile.DESKTOP,
    )

    assert graph.specs["x11vnc"].depends_on == ("xvfb",)
    assert graph.specs["websockify"].depends_on == ("x11vnc",)
    required = [spec.name for spec in graph.required_services()]
    assert required == ["xvfb", "x11vnc", "websockify", "awesome"]
