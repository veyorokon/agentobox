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
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.acreate(
            name=input.name,
            owner=user,
            default_runtime=input.default_runtime,
        )
        return project

    @strawberry.mutation
    async def update_project(
        self, id: ID, name: str, info: Info
    ) -> ProjectType:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        project = await Project.objects.aget(id=id, owner=user)
        project.name = name
        await project.asave(update_fields=["name"])
        return project

    @strawberry.mutation
    async def delete_project(self, id: ID, info: Info) -> bool:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")

        deleted, _ = await Project.objects.filter(id=id, owner=user).adelete()
        return deleted > 0
