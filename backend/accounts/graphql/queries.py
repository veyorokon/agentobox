import strawberry
from strawberry.types import Info

from accounts.graphql.types import UserType


@strawberry.type
class AccountQuery:
    @strawberry.field
    async def me(self, info: Info) -> UserType | None:
        user = info.context["request"].user
        if user.is_authenticated:
            return user
        return None
