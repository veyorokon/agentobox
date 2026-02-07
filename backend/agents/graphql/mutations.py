import strawberry
from strawberry import ID

from agents.graphql.types import AgentType


@strawberry.input
class CreateAgentInput:
    project_id: ID
    name: str
    goal_text: str
    context_path: str
    runtime: str = "modal"


@strawberry.input
class SendMessageInput:
    agent_id: ID
    message: str


@strawberry.type
class AgentMutation:
    @strawberry.mutation
    async def create_agent(self, input: CreateAgentInput) -> AgentType:
        from agents.services.lifecycle import create_agent

        return await create_agent(
            project_id=input.project_id,
            name=input.name,
            goal_text=input.goal_text,
            context_path=input.context_path,
            runtime_name=input.runtime,
        )

    @strawberry.mutation
    async def kill_agent(self, agent_id: ID) -> bool:
        from agents.services.lifecycle import kill_agent

        return await kill_agent(agent_id)

    @strawberry.mutation
    async def send_message(self, input: SendMessageInput) -> bool:
        from agents.services.comms import send_message

        return await send_message(input.agent_id, input.message)
