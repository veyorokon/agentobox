import structlog

from agents.runtimes.base import Runtime

log = structlog.get_logger("agents.runtime")


def get_runtime(name: str) -> Runtime:
    try:
        match name:
            case "docker":
                from agents.runtimes.docker import DockerRuntime

                return DockerRuntime()
            case "modal":
                from agents.runtimes.modal import ModalRuntime

                return ModalRuntime()
            case _:
                raise ValueError(f"Unknown runtime: {name}")
    except Exception:
        log.exception("get_runtime_failed", runtime=name)
        raise
