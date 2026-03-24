from __future__ import annotations

import os
import signal
import struct
import subprocess
import termios
import threading
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from agent.transports.agentobox.commands import TerminalProgram

TerminalPublisher = Callable[[str, str, dict], None]


@dataclass
class PtySession:
    terminal_id: str
    cwd: Path
    publisher: TerminalPublisher
    cols: int = 120
    rows: int = 34
    shell: str = ""
    program: TerminalProgram = TerminalProgram.SHELL
    process: subprocess.Popen[bytes] | None = None
    master_fd: int | None = None
    slave_fd: int | None = None
    reader_thread: threading.Thread | None = None
    buffer: deque[str] = field(default_factory=lambda: deque(maxlen=256))

    def open(self) -> None:
        if self.process and self.process.poll() is None:
            self.publisher(
                self.terminal_id,
                "opened",
                {
                    "terminal_id": self.terminal_id,
                    "cols": self.cols,
                    "rows": self.rows,
                    "program": self.program.value,
                },
            )
            snapshot = "".join(self.buffer)
            if snapshot:
                self.publisher(self.terminal_id, "frame", {"data": snapshot})
            return

        master_fd, slave_fd = os.openpty()
        shell = self.shell or os.environ.get("SHELL", "/bin/bash")
        env = os.environ.copy()
        env.setdefault("TERM", "xterm-256color")
        argv = [shell, "-l"] if self.program is TerminalProgram.SHELL else ["claude"]
        actual_program = self.program

        def _setup_ctty():
            """Make the slave PTY the controlling terminal for this session.

            start_new_session=True calls setsid(), but does not assign a
            controlling terminal. Without TIOCSCTTY, the kernel will not
            deliver SIGWINCH when the master winsize changes.
            """
            import fcntl
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

        try:
            proc = subprocess.Popen(
                argv,
                cwd=str(self.cwd),
                env=env,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                start_new_session=True,
                preexec_fn=_setup_ctty,
                close_fds=True,
            )
        except FileNotFoundError:
            if self.program is not TerminalProgram.CLAUDE:
                raise
            self.publisher(
                self.terminal_id,
                "error",
                {"error": "claude executable not found; falling back to shell"},
            )
            actual_program = TerminalProgram.SHELL
            proc = subprocess.Popen(
                [shell, "-l"],
                cwd=str(self.cwd),
                env=env,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                start_new_session=True,
                preexec_fn=_setup_ctty,
                close_fds=True,
            )
        self.program = actual_program
        self.master_fd = master_fd
        self.slave_fd = slave_fd
        self.process = proc
        self._apply_winsize()
        try:
            os.close(slave_fd)
        except OSError:
            pass
        self.slave_fd = None

        self.reader_thread = threading.Thread(
            target=self._read_loop,
            name=f"agent-pty-{self.terminal_id}",
            daemon=True,
        )
        self.reader_thread.start()
        self.publisher(
            self.terminal_id,
            "opened",
            {
                "terminal_id": self.terminal_id,
                "cols": self.cols,
                "rows": self.rows,
                "program": self.program.value,
                "pid": proc.pid,
            },
        )

    def input(self, data: str) -> None:
        if not data or self.master_fd is None:
            return
        os.write(self.master_fd, data.encode("utf-8", errors="ignore"))

    def resize(self, cols: int, rows: int) -> None:
        cols = max(1, cols)
        rows = max(1, rows)
        if cols == self.cols and rows == self.rows:
            return
        self.cols = cols
        self.rows = rows
        self._apply_winsize()

    def close(self) -> None:
        proc = self.process
        if proc and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except OSError:
                pass
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        if self.slave_fd is not None:
            try:
                os.close(self.slave_fd)
            except OSError:
                pass
            self.slave_fd = None

    def _apply_winsize(self) -> None:
        if self.master_fd is None:
            return
        winsize = struct.pack("HHHH", self.rows, self.cols, 0, 0)
        try:
            termios.tcsetwinsize(self.master_fd, (self.rows, self.cols))
        except AttributeError:
            import fcntl

            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            return

        # Belt+suspenders: explicitly send SIGWINCH to the process group.
        # The ioctl should deliver SIGWINCH via the controlling terminal,
        # but if TIOCSCTTY was not set (e.g. older image), this ensures
        # the process still receives the signal.
        proc = self.process
        if proc and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGWINCH)
            except (OSError, ProcessLookupError):
                pass

    def _read_loop(self) -> None:
        assert self.master_fd is not None
        try:
            while True:
                chunk = os.read(self.master_fd, 4096)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace")
                self.buffer.append(text)
                self.publisher(self.terminal_id, "frame", {"data": text})
        except OSError as exc:
            self.publisher(self.terminal_id, "error", {"error": str(exc), "error_type": type(exc).__name__})
        finally:
            exit_code = self.process.wait(timeout=1) if self.process else 0
            self.publisher(self.terminal_id, "exited", {"exit_code": exit_code})
            if self.master_fd is not None:
                try:
                    os.close(self.master_fd)
                except OSError:
                    pass
                self.master_fd = None


class PtySessionManager:
    def __init__(self, cwd: Path, publisher: TerminalPublisher):
        self._cwd = cwd
        self._publisher = publisher
        self._lock = threading.Lock()
        self._sessions: dict[str, PtySession] = {}

    def open(
        self,
        terminal_id: str,
        *,
        cols: int = 120,
        rows: int = 34,
        program: TerminalProgram = TerminalProgram.SHELL,
    ) -> None:
        with self._lock:
            session = self._sessions.get(terminal_id)
            if session is None:
                session = PtySession(terminal_id=terminal_id, cwd=self._cwd, publisher=self._publisher)
                self._sessions[terminal_id] = session
            session.program = program
            session.resize(cols, rows)
            session.open()

    def input(self, terminal_id: str, data: str) -> None:
        with self._lock:
            session = self._sessions.get(terminal_id)
        if session is not None:
            session.input(data)

    def resize(self, terminal_id: str, *, cols: int, rows: int) -> None:
        with self._lock:
            session = self._sessions.get(terminal_id)
        if session is not None:
            session.resize(cols, rows)

    def close(self, terminal_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(terminal_id, None)
        if session is not None:
            session.close()

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close()
