from __future__ import annotations

import json
import threading
from typing import Callable

from agent.contracts.transport import ManagedTransport, TransportSnapshot, TransportState
from agent.contracts.events import RuntimeEvent
from agent.runtime.logging import emit_event
from agent.transports.agentobox.codec import encode_upstream_message, parse_downstream_command
from agent.transports.agentobox.config import AgentoboxTransportConfig
from agent.transports.agentobox.session import NullRelaySession, RelaySession


WS_FATAL_CLOSE_CODES = {4001, 4003, 4004}


class FatalTransportError(RuntimeError):
    pass


TransportConnector = Callable[[AgentoboxTransportConfig, "AgentoboxTransportClient", RelaySession], None]


class AgentoboxTransportClient(ManagedTransport):
    def __init__(
        self,
        config: AgentoboxTransportConfig,
        connector: TransportConnector | None = None,
        session: RelaySession | None = None,
    ):
        self._config = config
        self._connector = connector or self._default_connector
        self._session = session or NullRelaySession()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._snapshot = TransportSnapshot(
            enabled=True,
            state=TransportState.CONNECTING,
            connected=False,
            last_error="",
        )
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop_event.clear()
        with self._lock:
            self._snapshot = TransportSnapshot(
                enabled=True,
                state=TransportState.CONNECTING,
                connected=False,
                last_error="",
            )
        emit_event(RuntimeEvent.TRANSPORT_CONNECTING.value, callback_url=self._config.callback_url)
        self._thread = threading.Thread(target=self._run_connector, name="agentobox-transport", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=1)
        with self._lock:
            self._snapshot = TransportSnapshot(
                enabled=True,
                state=TransportState.DEGRADED,
                connected=False,
                last_error="stopped",
            )

    def snapshot(self) -> TransportSnapshot:
        with self._lock:
            return self._snapshot

    def wait_for_stop(self, timeout: float | None = None) -> bool:
        return self._stop_event.wait(timeout)

    def mark_connected(self) -> None:
        with self._lock:
            self._snapshot = TransportSnapshot(
                enabled=True,
                state=TransportState.CONNECTED,
                connected=True,
                last_error="",
            )
        emit_event(RuntimeEvent.TRANSPORT_CONNECTED.value, ws_url=self._config.ws_url())

    def mark_degraded(self, error: str) -> None:
        with self._lock:
            self._snapshot = TransportSnapshot(
                enabled=True,
                state=TransportState.DEGRADED,
                connected=False,
                last_error=error,
            )
        emit_event(RuntimeEvent.TRANSPORT_DEGRADED.value, error=error)

    def mark_fatal(self, error: str) -> None:
        with self._lock:
            self._snapshot = TransportSnapshot(
                enabled=True,
                state=TransportState.FATAL,
                connected=False,
                last_error=error,
            )
        emit_event(RuntimeEvent.TRANSPORT_FATAL.value, error=error)

    def _run_connector(self) -> None:
        try:
            self._connector(self._config, self, self._session)
        except FatalTransportError as exc:
            self.mark_fatal(str(exc))
            return
        except Exception as exc:  # intentional: transport startup failure should degrade the runtime instead of crashing the process
            self.mark_degraded(str(exc))
            return

        if self._stop_event.is_set():
            return
        snapshot = self.snapshot()
        if snapshot.state is TransportState.CONNECTING:
            self.mark_degraded("transport connector exited unexpectedly")

    def _default_connector(
        self,
        config: AgentoboxTransportConfig,
        _client: "AgentoboxTransportClient",
        session: RelaySession,
    ) -> None:
        try:
            from websockets.exceptions import ConnectionClosed, InvalidStatus
            from websockets.sync.client import connect
        except ImportError as exc:  # pragma: no cover - dependency is exercised in integration, not unit tests
            raise RuntimeError("websockets is required for managed transport") from exc

        try:
            with connect(
                config.ws_url(),
                additional_headers=config.auth_headers(),
                open_timeout=10,
                max_size=16 * 2**20,
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                self.mark_connected()
                session.on_connected()
                while not self._stop_event.is_set():
                    session.on_transport_poll()
                    for outbound in session.drain_outbound_messages():
                        ws.send(json.dumps(encode_upstream_message(outbound)))
                    try:
                        message = ws.recv(timeout=0.25)
                    except TimeoutError:
                        continue
                    except ConnectionClosed as exc:
                        session.on_disconnected()
                        code = exc.rcvd.code if exc.rcvd else 0
                        reason = exc.rcvd.reason if exc.rcvd else ""
                        if code in WS_FATAL_CLOSE_CODES:
                            raise FatalTransportError(
                                f"backend rejected transport connection: code={code} reason={reason}"
                            ) from exc
                        raise RuntimeError(
                            f"transport websocket closed: code={code} reason={reason}"
                        ) from exc
                    command = parse_downstream_command(message if isinstance(message, dict) else json.loads(message))
                    session.on_command(command)
                for outbound in session.drain_outbound_messages():
                    ws.send(json.dumps(encode_upstream_message(outbound)))
        except InvalidStatus as exc:
            code = exc.response.status_code if hasattr(exc, "response") else 0
            if code in WS_FATAL_CLOSE_CODES:
                raise FatalTransportError(f"backend rejected transport connection: status={code}") from exc
            raise RuntimeError(f"transport websocket connect failed: status={code}") from exc
