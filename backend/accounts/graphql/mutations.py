import strawberry
from strawberry.types import Info

from accounts.graphql.types import UserType


@strawberry.input
class LoginInput:
    username: str
    password: str


@strawberry.input
class RegisterInput:
    username: str
    email: str
    password: str


@strawberry.type
class AccountMutation:
    @strawberry.mutation
    async def login(self, input: LoginInput, info: Info) -> UserType | None:
        ...

    @strawberry.mutation
    async def register(self, input: RegisterInput) -> UserType:
        ...

    @strawberry.mutation
    async def create_api_key(self, info: Info) -> str:
        ...
