import re

import strawberry
from strawberry import ID
from strawberry.types import Info

from projects.graphql.types import ProjectType


def _sanitize_name(value: str) -> str:
    """Strip HTML tags and trim whitespace from a name."""
    return re.sub(r"<[^>]*>", "", value).strip()


@strawberry.input
class CreateProjectInput:
    name: str


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

        name = _sanitize_name(input.name)
        if not name:
            raise ValueError("Project name cannot be empty")

        project = await Project.objects.acreate(
            name=name,
            owner=user,
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

        name = _sanitize_name(name)
        if not name:
            raise ValueError("Project name cannot be empty")

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
