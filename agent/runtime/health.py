from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.status import StatusDocument


def livez_payload() -> dict:
    return {"status": "ok"}


def readyz_payload(status: StatusDocument) -> tuple[int, dict]:
    data = status.to_dict()
    if status.fatal:
        return 503, {"status": "not_ready", **data}
    if status.mode is AgentMode.STANDALONE:
        ready = status.runtime_state.value in {"ready", "busy"} and status.startup_stage.value in {
            "runtime_ready",
            "managed_ready",
        }
        return (200 if ready else 503), {"status": "ready" if ready else "not_ready", **data}

    ready = (
        status.runtime_state.value in {"ready", "busy"}
        and status.transport.connected
        and status.transport.enabled
    )
    return (200 if ready else 503), {"status": "ready" if ready else "not_ready", **data}

