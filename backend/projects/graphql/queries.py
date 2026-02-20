import strawberry
from strawberry import ID
from strawberry.types import Info

from projects.graphql.types import ProjectType


@strawberry.type
class ProjectQuery:
    @strawberry.field
    async def projects(self, info: Info) -> list[ProjectType]:
        from projects.models import Project

        user = info.context["request"].user
        return [p async for p in Project.objects.filter(owner=user)]

    @strawberry.field
    async def project(self, id: ID, info: Info) -> ProjectType | None:
        from projects.models import Project

        user = info.context["request"].user
        if not user.is_authenticated:
            return None
        return await Project.objects.filter(id=id, owner=user).afirst()
