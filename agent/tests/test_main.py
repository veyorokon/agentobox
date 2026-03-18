from threading import Event, Thread
from time import sleep

from agent.main import run_forever
from agent.runtime.logging import configure_logging_context


class FakeApp:
    def __init__(self):
        self.booted = False
        self.stopped = False

    def boot(self) -> None:
        self.booted = True

    def shutdown(self) -> None:
        self.stopped = True


def test_run_forever_boots_and_shuts_down_on_stop_event():
    configure_logging_context(mode="standalone", platform="local", agent_id="agent-xyz")
    app = FakeApp()
    stop_event = Event()
    thread = Thread(
        target=run_forever,
        kwargs={
            "app": app,
            "stop_event": stop_event,
            "poll_interval_s": 0.01,
            "install_signal_handlers": False,
        },
        daemon=True,
    )
    thread.start()
    sleep(0.05)
    stop_event.set()
    thread.join(timeout=1.0)

    assert app.booted is True
    assert app.stopped is True


def test_run_forever_emits_shutdown_and_fatal(capsys):
    configure_logging_context(mode="standalone", platform="local", agent_id="agent-xyz")

    class CrashingApp(FakeApp):
        def boot(self) -> None:
            super().boot()
            raise RuntimeError("boom")

    app = CrashingApp()
    try:
        run_forever(app, poll_interval_s=0.01, install_signal_handlers=False)
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert str(exc) == "boom"

    lines = [line for line in capsys.readouterr().err.splitlines() if line.strip()]
    assert any('"event": "runtime.booting"' in line for line in lines)
    assert any('"event": "runtime.fatal"' in line for line in lines)
    assert any('"event": "runtime.shutdown"' in line for line in lines)
    assert app.stopped is True
