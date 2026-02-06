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
class AuthPayload:
    user: UserType
    token: str


@strawberry.type
class AccountMutation:
    @strawberry.mutation
    async def login(self, input: LoginInput) -> AuthPayload:
        from django.contrib.auth import authenticate

        from accounts.auth import encode_token

        user = await authenticate_async(input.username, input.password)
        if user is None:
            raise ValueError("Invalid credentials")
        return AuthPayload(user=user, token=encode_token(user))

    @strawberry.mutation
    async def register(self, input: RegisterInput) -> AuthPayload:
        from accounts.auth import encode_token
        from accounts.models import User

        if await User.objects.filter(username=input.username).aexists():
            raise ValueError("Username already taken")

        user = User(username=input.username, email=input.email)
        user.set_password(input.password)
        await user.asave()
        return AuthPayload(user=user, token=encode_token(user))

    @strawberry.mutation
    async def create_api_key(self, info: Info) -> str:
        user = info.context["request"].user
        if not user.is_authenticated:
            raise PermissionError("Authentication required")
        # generate_api_key does a sync save, use sync_to_async
        from asgiref.sync import sync_to_async

        return await sync_to_async(user.generate_api_key)()


async def authenticate_async(username: str, password: str):
    from accounts.models import User

    try:
        user = await User.objects.aget(username=username)
    except User.DoesNotExist:
        return None
    # check_password is CPU-bound, fine for auth
    if user.check_password(password):
        return user
    return None
