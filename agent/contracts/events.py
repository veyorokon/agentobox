from __future__ import annotations

from enum import StrEnum


class RuntimeEvent(StrEnum):
    STARTUP_MODE_SELECTED = "startup.mode_selected"
    STARTUP_CONFIG_VALIDATED = "startup.config_validated"
    PROVISIONING_RELEASE_WAIT = "provisioning.release_wait"
    PROVISIONING_VALIDATION_FAILED = "provisioning.validation_failed"
    PROVISIONING_RELEASE_COMPLETE = "provisioning.release_complete"
    RUNTIME_READY = "runtime.ready"
    RUNTIME_UPDATED = "runtime.updated"
    TRANSPORT_CONNECTING = "transport.connecting"
    TRANSPORT_CONNECTED = "transport.connected"
    TRANSPORT_DEGRADED = "transport.degraded"
    TRANSPORT_FATAL = "transport.fatal"
    TRANSPORT_COMMAND_RECEIVED = "transport.command_received"
    PLATFORM_CREATED = "platform.created"
    PLATFORM_TERMINATED = "platform.terminated"
    SERVICE_STATE_CHANGED = "service.state_changed"
    SERVICE_READINESS_BLOCKED = "service.readiness_blocked"
    SERVICE_PROCESS_STARTED = "service.process_started"
    SERVICE_PROCESS_OUTPUT = "service.process_output"
    SERVICE_PROCESS_EXITED = "service.process_exited"
