"""Canonical runtime service declarations by platform and mode.

This module is the source of truth for which long-running services exist in a
given runtime shape. Platform adapters may change how services run, but not
which services exist or how they depend on one another.
"""

from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.services import ServiceSpec
from agent.runtime.services import ServiceGraph


def service_graph_for_platform(platform: PlatformKind, mode: AgentMode) -> ServiceGraph:
    """Return the canonical service graph for a platform/mode pair."""

    if platform is PlatformKind.LOCAL:
        return ServiceGraph([])
    if platform in {PlatformKind.DOCKER, PlatformKind.MODAL}:
        return ServiceGraph(_desktop_runtime_specs(mode))
    raise ValueError(f"Unsupported platform kind: {platform}")


def _desktop_runtime_specs(mode: AgentMode) -> list[ServiceSpec]:
    """Desktop-backed runtime services shared by Docker and Modal."""

    specs = [
        ServiceSpec(
            name="xvfb",
            command=("/usr/bin/Xvfb", ":99"),
            required_for_readiness=True,
        ),
        ServiceSpec(
            name="x11vnc",
            command=("/usr/bin/x11vnc", "-display", ":99"),
            depends_on=("xvfb",),
            required_for_readiness=True,
        ),
        ServiceSpec(
            name="websockify",
            command=("/usr/bin/websockify", "6080", "localhost:5900"),
            depends_on=("x11vnc",),
            required_for_readiness=False,
        ),
        ServiceSpec(
            name="mcp_gateway",
            command=("python3", "-m", "agent.mcp_gateway"),
            required_for_readiness=False,
        ),
        ServiceSpec(
            name="api_proxy",
            command=("python3", "-m", "agent.api_proxy"),
            required_for_readiness=False,
        ),
    ]
    if mode is AgentMode.MANAGED:
        specs.append(
            ServiceSpec(
                name="agentobox_relay",
                command=("python3", "-m", "agent.transports.agentobox.relay"),
                required_for_readiness=True,
            )
        )
    return specs
