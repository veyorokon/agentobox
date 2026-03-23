from __future__ import annotations

from datetime import datetime

from django.utils import timezone


# Explicit watchdog thresholds for executor task health classification.
# Keep these small and boring until live evidence says otherwise.
FAILED_FAST_WINDOW_S = 10
SILENT_TASK_GRACE_S = 30
HUNG_TASK_GRACE_S = 120

ACTIVE_TASK_STATES = {"running"}
TERMINAL_FAILED_STATES = {"failed"}


def classify_task_health(
    *,
    runtime_task_state: str | None,
    task_started_at: datetime | None,
    last_execution_event_at: datetime | None,
    now: datetime | None = None,
) -> dict | None:
    """Derive executor task health from persisted timestamps and runtime state.

    Returns None when there is no currently classifiable task signal.

    Kinds:
    - in_progress: active task with recent or not-yet-required execution activity
    - silent: task has been running long enough that zero execution events is abnormal
    - hung: task had execution activity, then stalled past the hang threshold
    - failed_fast: task failed within the failed-fast window or without any execution events
    - failed: task failed, but not in the failed-fast shape
    """

    state = str(runtime_task_state or "").strip()
    if not task_started_at or not state:
        return None

    now = now or timezone.now()
    started_age_s = max(0, int((now - task_started_at).total_seconds()))
    last_event_age_s = (
        max(0, int((now - last_execution_event_at).total_seconds()))
        if last_execution_event_at
        else None
    )
    first_event_offset_s = (
        max(0, int((last_execution_event_at - task_started_at).total_seconds()))
        if last_execution_event_at
        else None
    )

    if state in ACTIVE_TASK_STATES:
        if last_execution_event_at is None:
            kind = "silent" if started_age_s >= SILENT_TASK_GRACE_S else "in_progress"
            reason = (
                "Task has been running past the silent threshold with no execution events"
                if kind == "silent"
                else "Task is running and still within the silent grace window"
            )
        else:
            kind = "hung" if last_event_age_s is not None and last_event_age_s >= HUNG_TASK_GRACE_S else "in_progress"
            reason = (
                "Task execution activity stalled past the hang threshold"
                if kind == "hung"
                else "Task is running with recent execution activity"
            )
    elif state in TERMINAL_FAILED_STATES:
        if last_execution_event_at is None or (
            first_event_offset_s is not None and first_event_offset_s <= FAILED_FAST_WINDOW_S
        ):
            kind = "failed_fast"
            reason = (
                "Task failed without any execution events"
                if last_execution_event_at is None
                else "Task failed within the failed-fast window"
            )
        else:
            kind = "failed"
            reason = "Task failed after execution activity"
    else:
        return None

    return {
        "kind": kind,
        "reason": reason,
        "runtime_task_state": state,
        "task_started_at": task_started_at,
        "last_execution_event_at": last_execution_event_at,
        "seconds_since_task_started": started_age_s,
        "seconds_since_execution_event": last_event_age_s,
        "thresholds": {
            "failed_fast_window_s": FAILED_FAST_WINDOW_S,
            "silent_task_grace_s": SILENT_TASK_GRACE_S,
            "hung_task_grace_s": HUNG_TASK_GRACE_S,
        },
    }
