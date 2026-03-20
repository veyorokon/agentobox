"""Canonical runtime service declarations by platform and runtime profile.

This module is the source of truth for which long-running external services
exist for a given runtime shape. Platform adapters may change how services
run, but not which services exist or how they depend on one another.
"""

from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.services import ServiceSpec
from agent.runtime.services import ServiceGraph


def service_graph_for_platform(
    platform: PlatformKind,
    mode: AgentMode,
    profile: RuntimeProfile = RuntimeProfile.CORE,
) -> ServiceGraph:
    """Return the canonical service graph for a platform/profile pair."""

    if platform is PlatformKind.LOCAL:
        return ServiceGraph([])
    if platform in {PlatformKind.DOCKER, PlatformKind.MODAL}:
        if profile is RuntimeProfile.CORE:
            return ServiceGraph([])
        if profile is RuntimeProfile.DESKTOP:
            return ServiceGraph(_desktop_runtime_specs(mode))
    raise ValueError(f"Unsupported platform kind: {platform}")


def _desktop_runtime_specs(mode: AgentMode) -> list[ServiceSpec]:
    """Desktop-backed runtime services shared by Docker and Modal."""

    _ = mode
    return [
        ServiceSpec(
            name="xvfb",
            command=("python", "-m", "agent.runtime.desktop.xvfb"),
            required_for_readiness=True,
        ),
        ServiceSpec(
            name="x11vnc",
            command=("python", "-m", "agent.runtime.desktop.x11vnc"),
            depends_on=("xvfb",),
            required_for_readiness=True,
        ),
        ServiceSpec(
            name="websockify",
            command=("python", "-m", "agent.runtime.desktop.websockify"),
            depends_on=("x11vnc",),
            required_for_readiness=True,
        ),
        ServiceSpec(
            name="awesome",
            command=("python", "-m", "agent.runtime.desktop.awesome"),
            depends_on=("xvfb",),
            required_for_readiness=True,
        ),
        ServiceSpec(
            name="firefox",
            command=("python", "-m", "agent.runtime.desktop.firefox"),
            depends_on=("awesome",),
            # Firefox is an app-level desktop service, not a prerequisite for
            # the VNC desktop surface itself being previewable.
            required_for_readiness=False,
        ),
    ]
