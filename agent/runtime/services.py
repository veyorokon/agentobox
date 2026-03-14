"""Runtime-owned service graph and supervision primitives.

This layer is intentionally small and explicit. It provides one canonical
dependency graph and one managed-process supervision model so image startup
does not regress into shell-script ordering and ad hoc process wrappers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol

from agent.contracts.lifecycle import ServiceState
from agent.contracts.services import ServiceSpec
from agent.runtime.process import ManagedProcess


class ServiceGraphError(ValueError):
    """Raised when the declared service graph is invalid."""

    pass


@dataclass(frozen=True)
class ServiceStatus:
    """Observed status for one runtime-owned service."""

    name: str
    state: ServiceState
    required_for_readiness: bool


class ServiceGraph:
    """Declarative service dependency graph with deterministic ordering."""

    def __init__(self, specs: list[ServiceSpec]):
        self._specs = {spec.name: spec for spec in specs}
        if len(self._specs) != len(specs):
            raise ServiceGraphError("service names must be unique")
        for spec in specs:
            for dependency in spec.depends_on:
                if dependency not in self._specs:
                    raise ServiceGraphError(
                        f"service {spec.name} depends on unknown service {dependency}"
                    )

    @property
    def specs(self) -> dict[str, ServiceSpec]:
        return dict(self._specs)

    def startup_order(self) -> list[ServiceSpec]:
        resolved: list[ServiceSpec] = []
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(name: str) -> None:
            if name in visited:
                return
            if name in visiting:
                raise ServiceGraphError(f"cycle detected at service {name}")
            visiting.add(name)
            spec = self._specs[name]
            for dependency in spec.depends_on:
                visit(dependency)
            visiting.remove(name)
            visited.add(name)
            resolved.append(spec)

        for name in self._specs:
            visit(name)
        return resolved

    def shutdown_order(self) -> list[ServiceSpec]:
        return list(reversed(self.startup_order()))

    def required_services(self) -> list[ServiceSpec]:
        return [spec for spec in self.startup_order() if spec.required_for_readiness]


ProcessFactory = Callable[[ServiceSpec], ManagedProcess]


class ServiceGroup(Protocol):
    """Operational interface for starting and observing a declared service graph."""

    def start_all(self) -> None: ...

    def stop_all(self) -> None: ...

    def statuses(self) -> dict[str, ServiceStatus]: ...


class ManagedServiceGroup:
    """Default service-group implementation backed by managed subprocesses."""

    def __init__(self, graph: ServiceGraph, process_factory: ProcessFactory | None = None):
        self._graph = graph
        self._process_factory = process_factory or ManagedProcess
        self._processes: dict[str, ManagedProcess] = {}

    def start_all(self) -> None:
        for spec in self._graph.startup_order():
            process = self._process_factory(spec)
            process.start()
            self._processes[spec.name] = process

    def stop_all(self) -> None:
        for spec in self._graph.shutdown_order():
            process = self._processes.get(spec.name)
            if process is None:
                continue
            process.stop()

    def statuses(self) -> dict[str, ServiceStatus]:
        statuses: dict[str, ServiceStatus] = {}
        for spec in self._graph.startup_order():
            process = self._processes.get(spec.name)
            if process is None:
                state = ServiceState.DOWN
            else:
                state = ServiceState.UP if process.poll() is None else ServiceState.DOWN
            statuses[spec.name] = ServiceStatus(
                name=spec.name,
                state=state,
                required_for_readiness=spec.required_for_readiness,
            )
        return statuses
