"""
Polling utilities for async state transitions.

All e2e state waits go through these helpers. Never use bare
time.sleep() loops in tests — use poll_until with a predicate.
"""

from __future__ import annotations

import time
from typing import Callable, TypeVar

T = TypeVar("T")


class PollTimeout(Exception):
    """Raised when polling exceeds the timeout."""

    def __init__(self, description: str, timeout_s: float, last_value=None):
        self.description = description
        self.timeout_s = timeout_s
        self.last_value = last_value
        super().__init__(
            f"Timed out after {timeout_s}s waiting for: {description}. "
            f"Last value: {last_value}"
        )


def poll_until(
    fn: Callable[[], T],
    predicate: Callable[[T], bool],
    timeout_s: float = 60.0,
    interval_s: float = 2.0,
    description: str = "condition",
) -> T:
    """Poll fn() until predicate(result) is truthy. Returns the matching result.

    Raises PollTimeout if the predicate is not satisfied within timeout_s.
    """
    deadline = time.monotonic() + timeout_s
    last_value = None
    while time.monotonic() < deadline:
        last_value = fn()
        if predicate(last_value):
            return last_value
        time.sleep(interval_s)
    raise PollTimeout(description, timeout_s, last_value)


def poll_agent_status(
    gql,
    agent_id: str,
    target_statuses: list[str],
    timeout_s: float = 90.0,
    interval_s: float = 3.0,
) -> dict:
    """Wait for an agent to reach one of the target lifecycle statuses.

    Returns the full agent dict when the status matches.
    Raises PollTimeout if not reached within timeout_s.
    """

    def fetch():
        return gql.query_agent(agent_id)

    def check(agent):
        if agent is None:
            return False
        return agent["lifecycleStatus"] in target_statuses

    return poll_until(
        fetch,
        check,
        timeout_s=timeout_s,
        interval_s=interval_s,
        description=f"agent {agent_id} status in {target_statuses}",
    )


def poll_feed_for(
    gql,
    project_id: str,
    predicate: Callable[[dict], bool],
    timeout_s: float = 30.0,
    interval_s: float = 2.0,
    description: str = "matching feed item",
) -> dict:
    """Wait for a feed item matching the predicate to appear.

    Returns the first matching feed item.
    Raises PollTimeout if not found within timeout_s.
    """

    def fetch():
        return gql.query_feed(project_id)

    def check(items):
        return any(predicate(item) for item in items)

    items = poll_until(
        fetch,
        check,
        timeout_s=timeout_s,
        interval_s=interval_s,
        description=description,
    )
    # Return the first matching item
    for item in items:
        if predicate(item):
            return item
    raise PollTimeout(description, timeout_s, items)
