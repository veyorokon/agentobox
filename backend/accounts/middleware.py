from django.contrib.auth.models import AnonymousUser

from accounts.auth import decode_token
from accounts.models import User


class TokenAuthMiddleware:
    """Sets request._token_user from JWT/API key if present.
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
