import strawberry
from strawberry import ID

from agents.graphql.types import AgentType


@strawberry.type
class AgentQuery:
    @strawberry.field
    async def agents(self, project_id: ID) -> list[AgentType]:
        from agents.models import Agent, AgentStatus

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
