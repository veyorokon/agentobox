from datetime import timedelta

import strawberry
from django.utils import timezone
from strawberry import ID

from agents.graphql.types import AgentEventType, AgentType

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
