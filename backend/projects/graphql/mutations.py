import strawberry
from strawberry import ID
from strawberry.types import Info

from projects.graphql.types import ProjectType


@strawberry.input
class CreateProjectInput:
    name: str
    default_runtime: str = "modal"


@strawberry.type
class ProjectMutation:
    @strawberry.mutation
    async def create_project(
        self, input: CreateProjectInput, info: Info
    ) -> ProjectType:
        ...

    @strawberry.mutation
    async def update_project(self, id: ID, name: str) -> ProjectType:
        ...

    @strawberry.mutation
    async def delete_project(self, id: ID) -> bool:
        ...
