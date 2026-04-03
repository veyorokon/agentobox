from asgiref.sync import sync_to_async
import strawberry_django
import strawberry
from strawberry import auto
from strawberry.scalars import JSON

from gda.graphql.types import GDAOverviewType, build_gda_overview_type
from projects import models


@strawberry_django.type(models.Project)
class ProjectType:
    id: auto
    name: auto
    description: auto
    settings: JSON
    created_at: auto
    archived_at: auto

    @strawberry.field
    def theme_document(self) -> JSON:
        return self.resolved_theme_document()

    @strawberry.field
    def theme_tokens(self) -> JSON:
        return self.resolved_theme_tokens()

    @strawberry.field
    async def gda_overview(self) -> GDAOverviewType | None:
        return await sync_to_async(build_gda_overview_type, thread_sensitive=True)(self)
