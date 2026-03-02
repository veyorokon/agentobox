"""
Root e2e test fixtures.

Session-scoped: auth_token, docker_client, backend_health
Module-scoped: test_project
Function-scoped: gql, docker_ops

Config via env vars (all have sensible defaults for local dev):
  ABOX_API_URL   - GraphQL endpoint (default: http://localhost:8000/graphql)
  ABOX_DASH_URL  - Dashboard URL (default: http://localhost:5051)
  ABOX_TEST_USER - Login username (default: demo)
  ABOX_TEST_PASS - Login password (default: demo)
"""

from __future__ import annotations

import os
import uuid

import docker
import httpx
import pytest

from helpers.graphql import AboxGraphQL

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")
DASH_URL = os.environ.get("ABOX_DASH_URL", "http://localhost:5051")
TEST_USER = os.environ.get("ABOX_TEST_USER", "demo")
TEST_PASS = os.environ.get("ABOX_TEST_PASS", "demo")


# ---------------------------------------------------------------------------
# Session fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def backend_health():
    """Verify backend is reachable. Skip all tests if not."""
    try:
        resp = httpx.post(
            API_URL,
            json={"query": "{ __typename }"},
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
        resp.raise_for_status()
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        pytest.skip(f"Backend unreachable at {API_URL}: {exc}")


@pytest.fixture(scope="session")
def auth_token(backend_health) -> str:
    """Login once per test session. Returns Bearer token."""
    resp = httpx.post(
        API_URL,
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
def docker_client() -> docker.DockerClient:
    """Docker client for the test session.

    Respects DOCKER_HOST env var. Falls back to Docker Desktop socket
    on macOS if the default /var/run/docker.sock doesn't exist.
    """
    import platform

    docker_host = os.environ.get("DOCKER_HOST")
    if docker_host:
        client = docker.DockerClient(base_url=docker_host)
    elif (
        platform.system() == "Darwin"
        and not os.path.exists("/var/run/docker.sock")
    ):
        # Docker Desktop on macOS uses a user-scoped socket
        home = os.path.expanduser("~")
        socket_path = f"unix://{home}/.docker/run/docker.sock"
        client = docker.DockerClient(base_url=socket_path)
    else:
        client = docker.from_env()
    yield client
    client.close()


# ---------------------------------------------------------------------------
# Module fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def test_project(auth_token) -> dict:
    """Create a throwaway project per test module. Cleaned up after."""
    gql = AboxGraphQL(API_URL, auth_token)
    project_name = f"e2e-test-{uuid.uuid4().hex[:8]}"
    project = gql.create_project(project_name)
    yield project
    try:
        gql.delete_project(project["id"])
    except Exception:
        pass  # best-effort cleanup
    gql.close()


# ---------------------------------------------------------------------------
# Function fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def gql(auth_token) -> AboxGraphQL:
    """Fresh GraphQL client per test."""
    client = AboxGraphQL(API_URL, auth_token)
    yield client
    client.close()


@pytest.fixture
def docker_ops(docker_client) -> "DockerOps":
    """Docker operations helper."""
    from helpers.docker_ops import DockerOps

    return DockerOps(docker_client)
