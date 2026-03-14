from __future__ import annotations

import os
import subprocess
import threading

from agent.contracts.events import RuntimeEvent
from agent.contracts.services import ServiceOutputStream, ServiceSpec
from agent.runtime.logging import emit_event


class ManagedProcess:
    def __init__(self, spec: ServiceSpec):
        self.spec = spec
        self._process: subprocess.Popen[str] | None = None
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        if self._process is not None:
            raise RuntimeError(f"process {self.spec.name} already started")
        env = os.environ.copy()
        env.update(self.spec.env)
        self._process = subprocess.Popen(
            self.spec.command,
            cwd=self.spec.cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        emit_event(
            RuntimeEvent.SERVICE_PROCESS_STARTED.value,
            service=self.spec.name,
            pid=self._process.pid,
            command=list(self.spec.command),
        )
        assert self._process.stdout is not None
        assert self._process.stderr is not None
        self._threads = [
            threading.Thread(
                target=self._pump_stream,
                args=(ServiceOutputStream.STDOUT, self._process.stdout),
                name=f"{self.spec.name}-stdout",
                daemon=True,
            ),
            threading.Thread(
                target=self._pump_stream,
                args=(ServiceOutputStream.STDERR, self._process.stderr),
                name=f"{self.spec.name}-stderr",
                daemon=True,
            ),
        ]
        for thread in self._threads:
            thread.start()

    def wait(self, timeout: float | None = None) -> int:
        if self._process is None:
            raise RuntimeError(f"process {self.spec.name} not started")
        exit_code = self._process.wait(timeout=timeout)
        for thread in self._threads:
            thread.join(timeout=timeout)
        emit_event(
            RuntimeEvent.SERVICE_PROCESS_EXITED.value,
            service=self.spec.name,
            exit_code=exit_code,
        )
        return exit_code

    def stop(self, timeout: float = 5) -> int:
        if self._process is None:
            return 0
        if self._process.poll() is None:
            self._process.terminate()
            try:
                return self.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                self._process.kill()
        return self.wait(timeout=timeout)

    def poll(self) -> int | None:
        if self._process is None:
            return None
        return self._process.poll()

    def _pump_stream(self, stream: ServiceOutputStream, handle) -> None:
        for raw_line in handle:
            line = raw_line.rstrip("\n")
            emit_event(
                RuntimeEvent.SERVICE_PROCESS_OUTPUT.value,
                service=self.spec.name,
                stream=stream.value,
                line=line,
            )
