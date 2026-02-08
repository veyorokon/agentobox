import strawberry
from strawberry import ID
from strawberry.scalars import JSON

from agents.graphql.types import AgentType


@strawberry.input
class CreateAgentInput:
    project_id: ID
    name: str
    runtime: str = "modal"
    mcp_servers: JSON | None = None


@strawberry.input
class SendMessageInput:
    agent_id: ID
    message: str


@strawberry.input
class AttachMcpInput:
    agent_id: ID
    server_name: str
    command: str
    args: list[str]


@strawberry.type
class AgentMutation:
    @strawberry.mutation
    async def create_agent(self, input: CreateAgentInput) -> AgentType:
        from agents.services.lifecycle import create_agent
        from agents.services.provision import resolve_mcp_servers

        # mcp_servers can be a list of names (resolved via registry) or a full dict
        mcp_config = None
        if input.mcp_servers:
            if isinstance(input.mcp_servers, list):
                mcp_config = resolve_mcp_servers(input.mcp_servers)
            elif isinstance(input.mcp_servers, dict):
                mcp_config = input.mcp_servers

        return await create_agent(
            project_id=input.project_id,
            name=input.name,
            runtime_name=input.runtime,
            mcp_servers=mcp_config,
        )

    @strawberry.mutation
    async def kill_agent(self, agent_id: ID) -> bool:
        from agents.services.lifecycle import kill_agent

        return await kill_agent(agent_id)

    @strawberry.mutation
    async def send_message(self, input: SendMessageInput) -> bool:
        from agents.services.comms import send_message

        return await send_message(input.agent_id, input.message)

    @strawberry.mutation
    async def attach_mcp(self, input: AttachMcpInput) -> bool:
        from agents.services.comms import attach_mcp

        return await attach_mcp(
            input.agent_id, input.server_name, input.command, input.args
        )
