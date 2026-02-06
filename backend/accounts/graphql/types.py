import strawberry
import strawberry_django
from strawberry import auto

from accounts import models


@strawberry_django.type(models.User)
class UserType:
    id: auto
    username: auto
    email: auto
