import strawberry
from strawberry import ID
from strawberry.scalars import JSON

from agents.graphql.types import AgentFeedbackType, AgentType


@strawberry.input
class CreateAgentInput:
    project_id: ID
    name: str
    runtime: str = "modal"
    mcp_servers: JSON | None = None
    workspace_path: str = ""
    instructions: str = ""


@strawberry.input
class SendMessageInput:
    agent_id: ID
    message: str


@strawberry.input
class RateFeedbackInput:
    agent_id: ID
    message_id: ID | None = None
    rating: int
    comment: str = ""


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
            workspace_path=input.workspace_path,
            instructions=input.instructions,
        )

    @strawberry.mutation
    async def kill_agent(self, agent_id: ID) -> bool:
        from agents.services.lifecycle import kill_agent

        return await kill_agent(agent_id)

    @strawberry.mutation
    async def interrupt_agent(self, agent_id: ID) -> bool:
        from agents.services.comms import interrupt_agent

        return await interrupt_agent(agent_id)

    @strawberry.mutation
    async def send_message(self, input: SendMessageInput) -> bool:
        from agents.services.comms import send_message

        return await send_message(input.agent_id, input.message)

    @strawberry.mutation
    async def rate_agent(self, input: RateFeedbackInput) -> AgentFeedbackType | None:
        from agents.models import Agent, AgentFeedback, AgentMessage

        if input.rating not in (1, 2, 3):
            raise ValueError("rating must be 1, 2, or 3")

        agent = await Agent.objects.aget(id=input.agent_id)

        # Resolve message FK — skip if synthetic ID (e.g. "evt-123" from event stream)
        message = None
        message_id_int = None
        if input.message_id:
            try:
                message_id_int = int(input.message_id)
                message = await AgentMessage.objects.aget(id=message_id_int)
            except (ValueError, AgentMessage.DoesNotExist):
                pass  # Synthetic or missing ID — proceed without message FK

        # Toggle: if same agent+message+rating exists, delete it (undo)
        lookup = {"agent": agent, "message": message}
        existing = await AgentFeedback.objects.filter(**lookup).afirst()
        if existing:
            if existing.rating == input.rating:
                await existing.adelete()
                return None  # Toggled off
            # Different rating — update in place
            existing.rating = input.rating
            existing.comment = input.comment
            await existing.asave(update_fields=["rating", "comment"])
            return existing

        return await AgentFeedback.objects.acreate(
            agent=agent,
            message=message,
            session_id=agent.session_id,
            rating=input.rating,
            comment=input.comment,
        )

