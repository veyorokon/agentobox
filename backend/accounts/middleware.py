from accounts.auth import adecode_token, decode_token
from accounts.models import User


class TokenAuthMiddleware:
    """Sets request.user from JWT/API key if present.
    Runs after AuthenticationMiddleware so session auth takes priority."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Only try token auth if session auth didn't authenticate
        if not request.user.is_authenticated:
            user = self._get_user_from_token(request)
            if user is not None:
                request.user = user
        return self.get_response(request)

    async def __acall__(self, request):
        """Async path for ASGI (Daphne). Avoids sync DB queries on event loop."""
        if not request.user.is_authenticated:
            user = await self._aget_user_from_token(request)
            if user is not None:
                request.user = user
        response = await self.get_response(request)
        return response

    def _get_user_from_token(self, request):
        auth_header = request.headers.get("Authorization", "")

        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            return decode_token(token)

        if auth_header.startswith("ApiKey "):
            api_key = auth_header[7:]
            try:
                return User.objects.get(api_key=api_key)
            except User.DoesNotExist:
                return None

        return None

    async def _aget_user_from_token(self, request):
        auth_header = request.headers.get("Authorization", "")

        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            return await adecode_token(token)

        if auth_header.startswith("ApiKey "):
            api_key = auth_header[7:]
            try:
                return await User.objects.aget(api_key=api_key)
            except User.DoesNotExist:
                return None

        return None
