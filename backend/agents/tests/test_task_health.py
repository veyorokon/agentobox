from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from agents.services.task_health import classify_task_health


def test_classify_task_health_returns_none_without_started_at():
    assert classify_task_health(
        runtime_task_state="running",
        task_started_at=None,
        last_execution_event_at=None,
    ) is None


def test_classify_task_health_in_progress_before_silent_threshold():
    now = timezone.now()
    result = classify_task_health(
        runtime_task_state="running",
        task_started_at=now - timedelta(seconds=10),
        last_execution_event_at=None,
        now=now,
    )
    assert result is not None
    assert result["kind"] == "in_progress"


def test_classify_task_health_silent_when_no_execution_events_past_threshold():
    now = timezone.now()
    result = classify_task_health(
        runtime_task_state="running",
        task_started_at=now - timedelta(seconds=45),
        last_execution_event_at=None,
        now=now,
    )
    assert result is not None
    assert result["kind"] == "silent"
    assert result["seconds_since_execution_event"] is None


def test_classify_task_health_hung_when_execution_activity_stalls():
    now = timezone.now()
    result = classify_task_health(
        runtime_task_state="running",
        task_started_at=now - timedelta(seconds=200),
        last_execution_event_at=now - timedelta(seconds=130),
        now=now,
    )
    assert result is not None
    assert result["kind"] == "hung"
    assert result["seconds_since_execution_event"] == 130


def test_classify_task_health_failed_fast_without_execution_events():
    now = timezone.now()
    result = classify_task_health(
        runtime_task_state="failed",
        task_started_at=now - timedelta(seconds=5),
        last_execution_event_at=None,
        now=now,
    )
    assert result is not None
    assert result["kind"] == "failed_fast"


def test_classify_task_health_failed_fast_with_short_execution_window():
    now = timezone.now()
    result = classify_task_health(
        runtime_task_state="failed",
        task_started_at=now - timedelta(seconds=8),
        last_execution_event_at=now - timedelta(seconds=2),
        now=now,
    )
    assert result is not None
    assert result["kind"] == "failed_fast"


def test_classify_task_health_failed_after_longer_execution_activity():
    now = timezone.now()
    result = classify_task_health(
        runtime_task_state="failed",
        task_started_at=now - timedelta(seconds=90),
        last_execution_event_at=now - timedelta(seconds=40),
        now=now,
    )
    assert result is not None
    assert result["kind"] == "failed"


def test_classify_task_health_returns_none_for_completed_task():
    now = timezone.now()
    assert classify_task_health(
        runtime_task_state="completed",
        task_started_at=now - timedelta(seconds=20),
        last_execution_event_at=now - timedelta(seconds=1),
        now=now,
    ) is None
