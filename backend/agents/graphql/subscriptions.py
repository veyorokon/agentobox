from typing import AsyncGenerator

import strawberry
from strawberry import ID

from agents.graphql.types import AgentEventType, AgentType


@strawberry.type
class AgentSubscription:
    @strawberry.subscription
    async def agent_updated(
        self, project_id: ID
    ) -> AsyncGenerator[AgentType, None]:
        ...
        yield  # type: ignore[misc]

    @strawberry.subscription
    async def new_event(
        self, project_id: ID
    ) -> AsyncGenerator[AgentEventType, None]:
        ...
        yield  # type: ignore[misc]
