from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.runtime.service_catalog import service_graph_for_platform


def test_desktop_profile_uses_python_launchers():
    graph = service_graph_for_platform(
        PlatformKind.DOCKER,
        AgentMode.MANAGED,
        RuntimeProfile.DESKTOP,
    )

    assert graph.specs["xvfb"].command == ("python", "-m", "agent.runtime.desktop.xvfb")
    assert graph.specs["x11vnc"].command == ("python", "-m", "agent.runtime.desktop.x11vnc")
    assert graph.specs["websockify"].command == ("python", "-m", "agent.runtime.desktop.websockify")
    assert graph.specs["awesome"].command == ("python", "-m", "agent.runtime.desktop.awesome")
    assert graph.specs["browser"].command == ("python", "-m", "agent.runtime.desktop.browser")


def test_core_profile_has_no_desktop_services():
    graph = service_graph_for_platform(
        PlatformKind.DOCKER,
        AgentMode.MANAGED,
        RuntimeProfile.CORE,
    )

    assert graph.startup_order() == []
