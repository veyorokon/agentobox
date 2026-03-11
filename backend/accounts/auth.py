from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings

from accounts.models import User

ALGORITHM = "HS256"
TOKEN_LIFETIME = timedelta(days=7)


def encode_token(user: User) -> str:
    payload = {
        "user_id": user.pk,
        "exp": datetime.now(timezone.utc) + TOKEN_LIFETIME,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def _extract_user_id(payload: dict) -> str | int | None:
    """Extract user ID from JWT payload — supports both our tokens and allauth's."""
    return payload.get("user_id") or payload.get("sub")


def decode_token(token: str) -> User | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    uid = _extract_user_id(payload)
    if not uid:
        return None
    try:
        return User.objects.get(pk=uid)
    except User.DoesNotExist:
        return None


async def adecode_token(token: str) -> User | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    uid = _extract_user_id(payload)
    if not uid:
        return None
    try:
        return await User.objects.aget(pk=uid)
    except User.DoesNotExist:
        return None


async def authenticate_request(request) -> User | None:
    """Extract user from Authorization header (Bearer token or API key)."""
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
