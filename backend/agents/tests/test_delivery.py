"""Tests for cursor-based message delivery guarantees.

Verifies that the backfill query (StreamEvent.id > last_delivered_event_id)
correctly filters to only un-delivered user events, and that the cursor
snapshot on disconnect captures the right value.
"""

import pytest
from django.test import TestCase

from agents.models import Agent, StreamEvent
from projects.models import Project


@pytest.mark.django_db
class TestCursorBackfill(TestCase):
    """Cursor-based backfill returns only un-delivered user events."""

    def setUp(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.user = User.objects.create_user(username="vahid-eyorokon", password="test")
        self.project = Project.objects.create(name="test-project", owner=self.user)
        self.agent = Agent.objects.create(
            name="test-agent",
            project=self.project,
            runtime="docker",
            last_delivered_event_id=0,
        )

    def _create_event(self, event_type="user", data=None):
        return StreamEvent.objects.create(
            agent=self.agent,
            session_id="sess-1",
            event_type=event_type,
            data=data or {"type": "user", "message": {"role": "user", "content": "hello"}},
        )

    def test_backfill_returns_events_after_cursor(self):
        """Only events with id > cursor are returned."""
        e1 = self._create_event()
        e2 = self._create_event()
        e3 = self._create_event()

        # Cursor at e2 — only e3 should be returned
        self.agent.last_delivered_event_id = e2.id
        self.agent.save(update_fields=["last_delivered_event_id"])

        pending = list(
            StreamEvent.objects.filter(
                agent_id=self.agent.id,
                event_type="user",
                id__gt=self.agent.last_delivered_event_id,
            ).order_by("id")
        )
        assert len(pending) == 1
        assert pending[0].id == e3.id

    def test_backfill_filters_to_user_events_only(self):
        """Non-user events (system, status) are excluded from backfill."""
        e_user = self._create_event(event_type="user")
        e_system = self._create_event(event_type="system", data={"type": "system"})
        e_user2 = self._create_event(event_type="user")

        # Cursor before all events
        self.agent.last_delivered_event_id = 0

        pending = list(
            StreamEvent.objects.filter(
                agent_id=self.agent.id,
                event_type="user",
                id__gt=self.agent.last_delivered_event_id,
            ).order_by("id")
        )
        assert len(pending) == 2
        assert pending[0].id == e_user.id
        assert pending[1].id == e_user2.id

    def test_backfill_empty_when_cursor_is_current(self):
        """No events returned when cursor equals the latest event."""
        e1 = self._create_event()
        e2 = self._create_event()

        self.agent.last_delivered_event_id = e2.id
        self.agent.save(update_fields=["last_delivered_event_id"])

        pending = list(
            StreamEvent.objects.filter(
                agent_id=self.agent.id,
                event_type="user",
                id__gt=self.agent.last_delivered_event_id,
            ).order_by("id")
        )
        assert len(pending) == 0

    def test_cursor_snapshot_captures_max_user_event_id(self):
        """Disconnect cursor should be the max user StreamEvent.id."""
        self._create_event(event_type="user")
        self._create_event(event_type="system", data={"type": "system"})
        e3 = self._create_event(event_type="user")
        # system event created after — should NOT be the cursor
        self._create_event(event_type="status", data={"type": "status"})

        max_user_id = (
            StreamEvent.objects.filter(
                agent_id=self.agent.id, event_type="user",
            ).order_by("-id").values_list("id", flat=True).first() or 0
        )

        assert max_user_id == e3.id

    def test_backfill_scoped_to_agent(self):
        """Backfill only returns events for the specific agent."""
        other_agent = Agent.objects.create(
            name="other-agent", project=self.project, runtime="docker",
        )
        self._create_event()  # belongs to self.agent
        StreamEvent.objects.create(
            agent=other_agent, session_id="sess-2",
            event_type="user",
            data={"type": "user", "message": {"role": "user", "content": "hi"}},
        )

        pending = list(
            StreamEvent.objects.filter(
                agent_id=self.agent.id,
                event_type="user",
                id__gt=0,
            ).order_by("id")
        )
        assert len(pending) == 1
        assert pending[0].agent_id == self.agent.id
