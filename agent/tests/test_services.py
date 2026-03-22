from __future__ import annotations

from agent.contracts.lifecycle import ServiceState
from agent.contracts.services import ServiceSpec
from agent.runtime.services import ManagedServiceGroup, ServiceGraph, ServiceGraphError


def test_service_graph_orders_dependencies():
    graph = ServiceGraph(
        [
            ServiceSpec(name="relay", command=("relay",), depends_on=("ingress",)),
            ServiceSpec(name="ingress", command=("ingress",), depends_on=("runtime",)),
            ServiceSpec(name="runtime", command=("runtime",)),
        ]
    )

    assert [spec.name for spec in graph.startup_order()] == ["runtime", "ingress", "relay"]
    assert [spec.name for spec in graph.shutdown_order()] == ["relay", "ingress", "runtime"]


def test_service_graph_rejects_cycles():
    try:
        ServiceGraph(
            [
                ServiceSpec(name="a", command=("a",), depends_on=("b",)),
                ServiceSpec(name="b", command=("b",), depends_on=("a",)),
            ]
        ).startup_order()
        assert False, "expected ServiceGraphError"
    except ServiceGraphError as exc:
        assert "cycle detected" in str(exc)


def test_managed_service_group_starts_in_dependency_order_and_reports_status():
    started: list[str] = []
    stopped: list[str] = []

    class FakeProcess:
        def __init__(self, spec: ServiceSpec):
            self.spec = spec
            self._running = False

        def start(self) -> None:
            started.append(self.spec.name)
            self._running = True

        def stop(self) -> int:
            stopped.append(self.spec.name)
            self._running = False
            return 0

        def poll(self):
            return None if self._running else 0

    graph = ServiceGraph(
        [
            ServiceSpec(name="runtime", command=("runtime",)),
            ServiceSpec(name="ingress", command=("ingress",), depends_on=("runtime",)),
            ServiceSpec(name="relay", command=("relay",), depends_on=("ingress",), required_for_readiness=False),
        ]
    )
    group = ManagedServiceGroup(graph, process_factory=FakeProcess)
    group.start_all()

    statuses = group.statuses()
    assert started == ["runtime", "ingress", "relay"]
    assert statuses["runtime"].state is ServiceState.UP
    assert statuses["relay"].required_for_readiness is False

    group.stop_all()
    assert stopped == ["relay", "ingress", "runtime"]
