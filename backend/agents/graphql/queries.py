import strawberry
from strawberry import ID

from agents.graphql.types import AgentType, CaseType, GoalType


@strawberry.type
class AgentQuery:
    @strawberry.field
    async def agents(self, project_id: ID) -> list[AgentType]:
        from agents.models import Agent, AgentStatus

        return [
            a async for a in Agent.objects.filter(
                project_id=project_id
            ).exclude(status=AgentStatus.TERMINATED)
        ]

    @strawberry.field
    async def agent(self, agent_id: ID) -> AgentType | None:
        from agents.models import Agent

        try:
            return await Agent.objects.aget(id=agent_id)
        except Agent.DoesNotExist:
            return None

    @strawberry.field
    async def goals(self, project_id: ID) -> list[GoalType]:
        from agents.models import Goal

        return [g async for g in Goal.objects.filter(project_id=project_id)]

    @strawberry.field
    async def cases(self, project_id: ID, limit: int = 20) -> list[CaseType]:
        from agents.models import Case

        return [c async for c in Case.objects.all()[:limit]]
