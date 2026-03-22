from __future__ import annotations

from enum import StrEnum


class StartupStage(StrEnum):
    CONFIG_LOADING = "config_loading"
    CONFIG_VALIDATED = "config_validated"
    PROVISIONING_WAIT = "provisioning_wait"
    PROVISIONING_VALIDATED = "provisioning_validated"
    SERVICES_STARTING = "services_starting"
    RUNTIME_READY = "runtime_ready"
    TRANSPORT_CONNECTING = "transport_connecting"
    MANAGED_READY = "managed_ready"
    DEGRADED = "degraded"
    FATAL = "fatal"


class RuntimeState(StrEnum):
    STARTING = "starting"
    READY = "ready"
    BUSY = "busy"
    DEGRADED = "degraded"
    STOPPED = "stopped"
    FATAL = "fatal"


class ServiceState(StrEnum):
    UP = "up"
    DOWN = "down"
    DEGRADED = "degraded"

