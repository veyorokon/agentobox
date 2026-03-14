"""Top-level runtime composition root.

`AgentApplication` wires together provisioning, lifecycle, transport, local
ingress, task execution, and runtime-owned services. Transition policy lives
in `LifecycleCoordinator`; this class is intentionally a composition root,
not the runtime state machine itself.
"""

from __future__ import annotations

import threading
from time import sleep
from typing import Callable

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformAdapter
from agent.contracts.transport import ManagedTransport
from agent.platform.factory import build_platform
from agent.provisioning.providers.managed import ManagedProvisioningProvider
from agent.provisioning.providers.standalone import StandaloneProvisioningProvider
from agent.runtime.config import RuntimeConfig
from agent.runtime.ingress import LocalIngressServer
from agent.runtime.lifecycle import LifecycleCoordinator
from agent.runtime.managed_session import ManagedRelaySession
from agent.runtime.runner import TaskRunner
from agent.runtime.state import RuntimeStateStore
from agent.runtime.services import ManagedServiceGroup, ServiceGraph, ServiceGroup
from agent.transports.factory import build_transport


ServiceGroupFactory = Callable[[ServiceGraph], ServiceGroup]


class AgentApplication:
    def __init__(
        self,
        config: RuntimeConfig,
        *,
        platform: PlatformAdapter | None = None,
        transport: ManagedTransport | None = None,
        ingress_factory=LocalIngressServer,
        service_group_factory: ServiceGroupFactory = ManagedServiceGroup,
    ):
        self.config = config
        self.state = RuntimeStateStore(mode=config.mode, platform=config.platform)
        self.lifecycle = LifecycleCoordinator(config, self.state)
        self.runner = TaskRunner(self.state)
        self.http_server: LocalIngressServer | None = None
        self.platform = platform or build_platform(config.platform)
        self.transport = transport or self._build_default_transport()
        self.ingress_factory = ingress_factory
        self.service_group_factory = service_group_factory
        self.service_group: ServiceGroup | None = None
        self._observer_stop = threading.Event()
        self._observer_thread: threading.Thread | None = None

    def boot(self) -> None:
        self.lifecycle.begin_boot()

        self.lifecycle.on_config_validated()
        provider = (
            ManagedProvisioningProvider(self.config)
            if self.config.mode is AgentMode.MANAGED
            else StandaloneProvisioningProvider(self.config)
        )

        self.lifecycle.on_provisioning_wait()
        provider.prepare(self.config.root_dir)
        self.lifecycle.on_provisioning_validated()

        self.lifecycle.on_services_starting()
        self.platform.create()
        self.lifecycle.on_platform_created()
        service_graph = self.platform.service_graph(self.config.mode)
        self.service_group = self.service_group_factory(service_graph)
        self.service_group.start_all()
        self.lifecycle.sync_services(self.service_group.statuses(), force=True)
        self.runner.start()
        self.http_server = self.ingress_factory(self.config.bind_host, self.config.port, self)
        self.http_server.start()
        self.lifecycle.on_ingress_started()

        self.transport.start()
        self._start_runtime_observer()
        if self.config.mode is AgentMode.STANDALONE:
            self.lifecycle.on_standalone_runtime_ready()
        else:
            self._sync_transport_state(force=True)

    def shutdown(self) -> None:
        self._observer_stop.set()
        if self._observer_thread:
            self._observer_thread.join(timeout=1)
        self.transport.stop()
        if self.http_server:
            self.http_server.stop()
        self.lifecycle.on_shutdown_started()
        if self.service_group:
            self.service_group.stop_all()
        self.runner.stop()
        self.platform.terminate()
        self.lifecycle.on_platform_terminated()
        self.lifecycle.on_shutdown_complete()

    def status(self):
        return self.state.snapshot()

    def submit_task(self, input_text: str):
        return self.runner.submit(input_text)

    def get_task(self, task_id: str):
        return self.runner.get(task_id)

    def _build_default_transport(self) -> ManagedTransport:
        if self.config.mode is AgentMode.STANDALONE:
            return build_transport(self.config)
        return build_transport(
            self.config,
            session=ManagedRelaySession(self.config.root_dir, self.runner),
        )

    def _start_runtime_observer(self) -> None:
        self._observer_stop.clear()
        self._observer_thread = threading.Thread(
            target=self._observe_runtime_facets,
            name="agent-runtime-observer",
            daemon=True,
        )
        self._observer_thread.start()

    def _observe_runtime_facets(self) -> None:
        while not self._observer_stop.is_set():
            self._sync_service_state()
            self._sync_transport_state()
            sleep(0.1)

    def _sync_service_state(self, *, force: bool = False) -> None:
        if not self.service_group:
            return
        self.lifecycle.sync_services(self.service_group.statuses(), force=force)

    def _sync_transport_state(self, *, force: bool = False) -> None:
        if self.config.mode is AgentMode.STANDALONE:
            return
        self.lifecycle.sync_transport(self.transport.snapshot(), force=force)


def main() -> None:
    config = RuntimeConfig.from_env()
    app = AgentApplication(config)
    app.boot()
    import signal
    import sys
    from time import sleep

    def _shutdown(*_args) -> None:
        app.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)
    while True:
        sleep(3600)


if __name__ == "__main__":
    main()
