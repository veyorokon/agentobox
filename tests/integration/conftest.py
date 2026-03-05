"""
Integration test fixtures.

Tests connect to the running docker compose stack as an external client.
No mocks — real backend, real Redis, real Postgres.

Prereqs:
  docker compose up -d
  make seed  (demo user exists)

Env vars (all have sensible defaults for local dev):
  ABOX_API_URL   - GraphQL endpoint  (default: http://localhost:8000/graphql)
  ABOX_WS_URL    - WebSocket base    (default: ws://localhost:8000)
  ABOX_TEST_USER - Login username     (default: demo)
  ABOX_TEST_PASS - Login password     (default: demo)
"""

from __future__ import annotations

import os
import secrets
import uuid

import httpx
import pytest

# Add integration dir to sys.path so test modules can import integ_helpers
# and add e2e dir so we can reuse the GraphQL helper
import sys

_integ_dir = os.path.dirname(__file__)
_e2e_dir = os.path.join(os.path.dirname(__file__), "..", "e2e")
if _integ_dir not in sys.path:
    sys.path.insert(0, _integ_dir)
if _e2e_dir not in sys.path:
    sys.path.insert(0, _e2e_dir)

from helpers.graphql import AboxGraphQL

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")
WS_URL = os.environ.get("ABOX_WS_URL", "ws://localhost:8000")
TEST_USER = os.environ.get("ABOX_TEST_USER", "demo")
TEST_PASS = os.environ.get("ABOX_TEST_PASS", "demo")


# ---------------------------------------------------------------------------
# Session fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def backend_url() -> str:
    return API_URL


@pytest.fixture(scope="session")
def ws_url() -> str:
    return WS_URL


@pytest.fixture(scope="session")
def _check_stack(backend_url):
    """Fail fast if docker compose stack isn't running."""
    try:
        resp = httpx.post(
            backend_url,
            json={"query": "{ __typename }"},
            headers={"Content-Type": "application/json"},
            timeout=5.0,
        )
        resp.raise_for_status()
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        pytest.skip(f"Backend unreachable at {backend_url}: {exc}")


@pytest.fixture(scope="session")
def auth_token(_check_stack, backend_url) -> str:
    """Login once per session. Returns Bearer token."""
    resp = httpx.post(
        backend_url,
        json={
            "query": """
                mutation ($input: LoginInput!) {
                    login(input: $input) { token }
                }
            """,
            "variables": {
                "input": {"username": TEST_USER, "password": TEST_PASS}
            },
        },
        headers={"Content-Type": "application/json"},
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        pytest.fail(f"Login failed: {data['errors']}")
    return data["data"]["login"]["token"]


@pytest.fixture(scope="session")
def gql_session(auth_token, backend_url) -> AboxGraphQL:
    """Session-scoped GraphQL client."""
    client = AboxGraphQL(backend_url, auth_token)
    yield client
    client.close()


@pytest.fixture
def gql(auth_token, backend_url) -> AboxGraphQL:
    """Function-scoped GraphQL client."""
    client = AboxGraphQL(backend_url, auth_token)
    yield client
    client.close()


# ---------------------------------------------------------------------------
# Project + agent fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def test_project(gql_session) -> dict:
    """Create a throwaway project per test module."""
    name = f"integ-test-{uuid.uuid4().hex[:8]}"
    project = gql_session.create_project(name)
    yield project
    try:
        gql_session.delete_project(project["id"])
    except Exception:
        pass  # intentional: best-effort cleanup


@pytest.fixture
def relay_ws_url(ws_url) -> str:
    """Base URL for relay WebSocket connections."""
    return f"{ws_url}/ws/relay"
