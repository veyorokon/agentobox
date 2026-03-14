from __future__ import annotations

from agent.contracts.transport import ManagedTransport, TransportSnapshot, TransportState


class DisabledTransport(ManagedTransport):
    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None

    def snapshot(self) -> TransportSnapshot:
        return TransportSnapshot(
            enabled=False,
            state=TransportState.DISABLED,
            connected=False,
            last_error="",
        )

