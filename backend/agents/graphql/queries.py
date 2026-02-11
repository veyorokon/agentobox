from datetime import timedelta

import strawberry
from django.utils import timezone
from strawberry import ID

from agents.graphql.types import AgentEventType, AgentType, SecretGroupType, TimelineEntryType

# Agents with no heartbeat for this long are marked as error
STALE_HEARTBEAT_SECONDS = 30


@strawberry.type
class AgentQuery:
    @strawberry.field
    async def agents(self, project_id: ID) -> list[AgentType]:
        from agents.models import Agent, AgentStatus

        # Lazy reap: mark agents with stale heartbeats as error
        stale = timezone.now() - timedelta(seconds=STALE_HEARTBEAT_SECONDS)
        await Agent.objects.filter(
            project_id=project_id,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
            last_heartbeat_at__lt=stale,
        ).aupdate(status=AgentStatus.ERROR)

        return [
            a async for a in Agent.objects.filter(
                project_id=project_id
            ).exclude(status=AgentStatus.STOPPED)
        ]

    @strawberry.field
    async def agent(self, agent_id: ID) -> AgentType | None:
        from agents.models import Agent

        try:
            return await Agent.objects.aget(id=agent_id)
        except Agent.DoesNotExist:
            return None

    @strawberry.field
    async def events(self, project_id: ID, limit: int = 100) -> list[AgentEventType]:
        from agents.models import AgentEvent

        return [
            e async for e in AgentEvent.objects.filter(
                agent__project_id=project_id
            ).select_related("agent").order_by("-created_at")[:limit]
        ]

    @strawberry.field
    async def timeline(
        self, project_id: ID, limit: int = 200, offset: int = 0,
    ) -> list[TimelineEntryType]:
        """
        Unified timeline: Messages + AgentEvents for a project, sorted newest-first.

        Replaces the need to call per-agent message queries + separate events queries.
        """
        from agents.models import AgentEvent, Message

        fetch_limit = limit + offset

        messages = [
            m async for m in Message.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("-created_at")[:fetch_limit]
        ]

        events = [
            e async for e in AgentEvent.objects.filter(
                agent__project_id=project_id,
            ).select_related("agent").order_by("-created_at")[:fetch_limit]
        ]

        entries: list[TimelineEntryType] = []
        for m in messages:
            entries.append(TimelineEntryType(
                id=f"msg_{m.id}",
                entry_type="message",
                agent_id=str(m.agent_id),
                agent_name=m.agent.name,
                summary=None,
                data={
                    "role": m.role,
                    "parts": m.parts,
                    "message_id": m.message_id,
                    "turn_number": m.turn_number,
                    "session_id": m.session_id,
                },
                created_at=m.created_at,
            ))
        for e in events:
            entries.append(TimelineEntryType(
                id=f"evt_{e.id}",
                entry_type=e.event_type,
                agent_id=str(e.agent_id),
                agent_name=e.agent.name,
                summary=e.summary or None,
                data=e.data,
                created_at=e.created_at,
            ))

        entries.sort(key=lambda x: x.created_at, reverse=True)
        return entries[offset:offset + limit]

    @strawberry.field
    async def secret_groups(self, project_id: ID) -> list[SecretGroupType]:
        """List secret groups for a project (names and key names only, never values)."""
        from agents.models import SecretGroup

        return [
            sg async for sg in SecretGroup.objects.filter(
                project_id=project_id
            ).order_by("name")
        ]
