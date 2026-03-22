import strawberry_django
import strawberry
from strawberry import auto
from strawberry.scalars import JSON

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
