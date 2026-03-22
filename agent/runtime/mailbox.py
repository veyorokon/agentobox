"""Small synchronized mailboxes for runtime cross-thread handoff."""

from __future__ import annotations

from collections import deque
from threading import Lock
from typing import Generic, TypeVar


T = TypeVar("T")


class DrainingMailbox(Generic[T]):
    """Thread-safe append-and-drain mailbox."""

    def __init__(self):
        self._lock = Lock()
        self._items: deque[T] = deque()

    def publish(self, item: T) -> None:
        with self._lock:
            self._items.append(item)

    def drain(self) -> list[T]:
        with self._lock:
            items = list(self._items)
            self._items.clear()
        return items
