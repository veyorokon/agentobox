"""Tests for auth token encode/decode and session-to-JWT exchange endpoint."""

import json

import jwt
import pytest
from django.conf import settings
from django.test import AsyncRequestFactory

from accounts.auth import adecode_token, decode_token, encode_token


# ---------------------------------------------------------------------------
# encode_token / decode_token (sync — no transaction needed)
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestEncodeDecodeToken:
    def test_roundtrip(self, user):
        """Token encodes user_id and decodes back to the same user."""
        token = encode_token(user)
        result = decode_token(token)
        assert result is not None
        assert result.pk == user.pk

    def test_decode_invalid_token(self):
        """Garbage token returns None."""
        assert decode_token("not-a-valid-jwt") is None

    def test_decode_wrong_secret(self, user):
        """Token signed with a different secret returns None."""
        payload = {"user_id": user.pk}
        token = jwt.encode(payload, "wrong-secret", algorithm="HS256")
        assert decode_token(token) is None

    def test_decode_expired_token(self, user):
        """Expired token returns None."""
        from datetime import datetime, timedelta, timezone

        payload = {
            "user_id": user.pk,
            "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
        }
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
        assert decode_token(token) is None

    def test_decode_nonexistent_user(self, db):
        """Token with a user_id that doesnt exist returns None."""
        payload = {"user_id": 99999}
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
        assert decode_token(token) is None

    def test_decode_allauth_sub_claim(self, user):
        """Allauth JWT uses 'sub' (string) instead of 'user_id' — both must work."""
        payload = {"sub": str(user.pk)}
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
        result = decode_token(token)
        assert result is not None
        assert result.pk == user.pk

    def test_decode_empty_payload(self):
        """Token with no user identifier returns None."""
        payload = {"foo": "bar"}
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
        assert decode_token(token) is None


# ---------------------------------------------------------------------------
# adecode_token (async — needs transaction=True for SQLite)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
class TestAsyncDecodeToken:
    async def test_roundtrip(self, user):
        token = encode_token(user)
        result = await adecode_token(token)
        assert result is not None
        assert result.pk == user.pk

    async def test_invalid_token(self):
        assert await adecode_token("garbage") is None

    async def test_sub_claim(self, user):
        """Async path also supports allauth 'sub' claim."""
        payload = {"sub": str(user.pk)}
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
        result = await adecode_token(token)
        assert result is not None
        assert result.pk == user.pk


# ---------------------------------------------------------------------------
# /_internal/session-token endpoint
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
class TestSessionTokenEndpoint:
    async def test_missing_session_key_returns_400(self, db):
        """Request without X-Session-Key header returns 400."""
        from agents.views import session_token

        factory = AsyncRequestFactory()
        request = factory.get("/_internal/session-token")
        response = await session_token(request)
        assert response.status_code == 400
        body = json.loads(response.content)
        assert "missing" in body["error"].lower()

    async def test_invalid_session_key_returns_401(self, db):
        """Request with a bogus session key returns 401."""
        from agents.views import session_token

        factory = AsyncRequestFactory()
        request = factory.get(
            "/_internal/session-token",
            headers={"x-session-key": "bogus-session-key-that-doesnt-exist"},
        )
        response = await session_token(request)
        assert response.status_code == 401
        body = json.loads(response.content)
        assert "invalid" in body["error"].lower() or "expired" in body["error"].lower()

    async def test_valid_session_returns_jwt(self, user):
        """Valid session key returns a JWT that decodes to the correct user."""
        from asgiref.sync import sync_to_async
        from django.contrib.sessions.backends.db import SessionStore

        from agents.views import session_token

        # Create a real session with _auth_user_id set (sync DB operation)
        def _create_session():
            s = SessionStore()
            s["_auth_user_id"] = str(user.pk)
            s.create()
            return s.session_key

        session_key = await sync_to_async(_create_session)()

        factory = AsyncRequestFactory()
        request = factory.get(
            "/_internal/session-token",
            headers={"x-session-key": session_key},
        )
        response = await session_token(request)
        assert response.status_code == 200

        body = json.loads(response.content)
        token = body.get("token")
        assert token is not None

        # The returned token should decode to this user
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        # allauth's create_access_token uses 'sub' claim
        uid = payload.get("sub") or payload.get("user_id")
        assert str(uid) == str(user.pk)


# ---------------------------------------------------------------------------
# authenticate_request (Bearer + ApiKey)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
class TestAuthenticateRequest:
    async def test_bearer_token(self, user):
        """Bearer token in Authorization header resolves user."""
        from accounts.auth import authenticate_request

        token = encode_token(user)
        factory = AsyncRequestFactory()
        request = factory.get("/", headers={"authorization": f"Bearer {token}"})
        result = await authenticate_request(request)
        assert result is not None
        assert result.pk == user.pk

    async def test_api_key(self, user):
        """ApiKey in Authorization header resolves user."""
        from accounts.auth import authenticate_request

        user.api_key = "test-api-key-vahid-eyorokon"
        await user.asave()

        factory = AsyncRequestFactory()
        request = factory.get(
            "/", headers={"authorization": "ApiKey test-api-key-vahid-eyorokon"}
        )
        result = await authenticate_request(request)
        assert result is not None
        assert result.pk == user.pk

    async def test_no_auth_header(self, db):
        """No Authorization header returns None."""
        from accounts.auth import authenticate_request

        factory = AsyncRequestFactory()
        request = factory.get("/")
        result = await authenticate_request(request)
        assert result is None

    async def test_invalid_bearer(self, db):
        """Invalid bearer token returns None."""
        from accounts.auth import authenticate_request

        factory = AsyncRequestFactory()
        request = factory.get("/", headers={"authorization": "Bearer garbage"})
        result = await authenticate_request(request)
        assert result is None
