import strawberry_django
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
