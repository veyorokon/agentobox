from __future__ import annotations

from agent.contracts.transport import TransportSnapshot, TransportState


def disabled_transport_snapshot() -> TransportSnapshot:
    return TransportSnapshot(
        enabled=False,
        state=TransportState.DISABLED,
        connected=False,
        last_error="",
    )

