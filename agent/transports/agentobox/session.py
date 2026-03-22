"""Managed relay session interfaces for Agentobox transport.

The websocket client owns transport connectivity. Relay session objects own
what to do once connected: receive commands, apply them to the local runtime,
and eventually emit upstream events/results. Keeping this seam explicit avoids
recreating the old relay monolith inside the transport client.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from agent.transports.agentobox.commands import DownstreamCommand
from agent.transports.agentobox.upstream import UpstreamMessage


@dataclass(frozen=True)
class RelaySessionContext:
    agent_id: str


class RelaySession(Protocol):
    """Runtime-facing behavior that executes on top of an open transport."""

    def on_connected(self) -> None: ...

    def on_command(self, command: DownstreamCommand) -> None: ...

    def on_disconnected(self) -> None: ...

    def on_transport_poll(self) -> None: ...

    def drain_outbound_messages(self) -> list[UpstreamMessage]: ...


class NullRelaySession:
    """Minimal session implementation used until real agent runtime bridging exists."""

    def __init__(self):
        self.connected = False
        self.commands: list[DownstreamCommand] = []

    def on_connected(self) -> None:
        self.connected = True

    def on_command(self, command: DownstreamCommand) -> None:
        self.commands.append(command)

    def on_disconnected(self) -> None:
        self.connected = False

    def on_transport_poll(self) -> None:
        return None

    def drain_outbound_messages(self) -> list[UpstreamMessage]:
        return []
