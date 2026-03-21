"""Process entrypoint for the new agent runtime.

This module is intentionally small. `AgentApplication` owns runtime wiring;
the entrypoint owns OS-process concerns like signal handling and the outer
serve-forever loop. Keeping those separate makes the runtime easier to test
and lets the eventual image entrypoint stay thin.
"""

from __future__ import annotations

import signal
from threading import Event, current_thread, main_thread
from time import sleep
from typing import Callable

from agent.contracts.events import RuntimeEvent
from agent.runtime.app import AgentApplication
from agent.runtime.config import RuntimeConfig
from agent.runtime.logging import configure_logging_context, emit_event


ApplicationFactory = Callable[[RuntimeConfig], AgentApplication]


def _runtime_fatal_reason(app: AgentApplication) -> str | None:
    """Return the runtime fatal reason if the app exposes status."""

    status_fn = getattr(app, "status", None)
    if not callable(status_fn):
        return None
    status = status_fn()
    return getattr(status, "fatal", None)


def run_forever(
    app: AgentApplication,
    *,
    stop_event: Event | None = None,
    poll_interval_s: float = 1.0,
    install_signal_handlers: bool = True,
) -> None:
    """Run the application until an OS signal or external stop event arrives."""

    managed_stop = stop_event is None
    stop_event = stop_event or Event()
    if install_signal_handlers and current_thread() is main_thread():
        _install_signal_handlers(stop_event)
    try:
        emit_event("runtime.booting")
        app.boot()
        while not stop_event.is_set():
            fatal_reason = _runtime_fatal_reason(app)
            if fatal_reason:
                raise RuntimeError(fatal_reason)
            sleep(poll_interval_s)
    except BaseException as exc:
        emit_event(
            RuntimeEvent.RUNTIME_FATAL.value,
            error_class=type(exc).__name__,
            error=str(exc),
        )
        raise
    finally:
        emit_event(
            RuntimeEvent.RUNTIME_SHUTDOWN.value,
            stop_requested=stop_event.is_set(),
        )
        app.shutdown()
        if managed_stop:
            stop_event.set()


def main(app_factory: ApplicationFactory = AgentApplication) -> None:
    """Build runtime config from env and run the application process."""

    config = RuntimeConfig.from_env()
    configure_logging_context(
        mode=config.mode.value,
        platform=config.platform.value,
        profile=config.profile.value,
        agent_id=config.managed.agent_id if config.managed else "",
        image_ref=config.build.image_ref,
        git_commit=config.build.git_commit,
        root_dir=config.root_dir,
    )
    run_forever(app_factory(config))


def _install_signal_handlers(stop_event: Event) -> None:
    """Translate process signals into a cooperative runtime shutdown."""

    def _request_shutdown(_signum, _frame) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)
