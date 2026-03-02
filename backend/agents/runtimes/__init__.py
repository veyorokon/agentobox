"""
Runtime registry — maps runtime names to Runtime protocol implementations.

get_runtime("docker") returns DockerRuntime, get_runtime("modal") returns
ModalRuntime. Instances are cached after first creation. Imports are lazy
(inside the match arms) to avoid pulling in docker-py or modal SDK when
only one runtime is used.
"""
import structlog

from agents.runtimes.base import Runtime

log = structlog.get_logger("abox.runtime")

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
    except Exception:  # intentional: log with context before re-raising — caller gets the original exception
        log.exception("runtime.get_failed", runtime=name)
        raise
    _cache[name] = instance
    return instance
