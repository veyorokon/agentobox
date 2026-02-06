import strawberry_django
from strawberry import auto

from projects import models


@strawberry_django.type(models.Project)
class ProjectType:
    id: auto
    name: auto
    default_runtime: auto
    created_at: auto
