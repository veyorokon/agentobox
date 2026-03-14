from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.runtime.service_catalog import service_graph_for_platform


def test_service_catalog_declares_desktop_dependencies():
    graph = service_graph_for_platform(PlatformKind.DOCKER, AgentMode.STANDALONE)

    assert graph.specs["x11vnc"].depends_on == ("xvfb",)
    assert graph.specs["websockify"].depends_on == ("x11vnc",)


def test_service_catalog_marks_required_readiness_services():
    graph = service_graph_for_platform(PlatformKind.MODAL, AgentMode.MANAGED)

    required = [spec.name for spec in graph.required_services()]
    assert required == ["xvfb", "x11vnc", "agentobox_relay"]
