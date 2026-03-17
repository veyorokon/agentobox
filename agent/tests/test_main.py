from threading import Event, Thread
from time import sleep

from agent.main import run_forever


class FakeApp:
    def __init__(self):
        self.booted = False
        self.stopped = False

    def boot(self) -> None:
        self.booted = True

    def shutdown(self) -> None:
        self.stopped = True


def test_run_forever_boots_and_shuts_down_on_stop_event():
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
