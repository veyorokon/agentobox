import structlog

from agents.runtimes.base import Runtime

log = structlog.get_logger("agents.runtime")

_cache: dict[str, Runtime] = {}


def get_runtime(name: str) -> Runtime:
    if name in _cache:
        return _cache[name]
    try:
        match name:
            case "docker":
                from agents.runtimes.docker import DockerRuntime

                instance = DockerRuntime()
            case "modal":
                from agents.runtimes.modal import ModalRuntime

                instance = ModalRuntime()
            case _:
                raise ValueError(f"Unknown runtime: {name}")
    except Exception:
        log.exception("get_runtime_failed", runtime=name)
        raise
    _cache[name] = instance
    return instance
