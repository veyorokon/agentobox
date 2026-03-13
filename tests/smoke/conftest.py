"""
Smoke test fixtures.

Session-scoped: auth_token, docker_client, gql
Module-scoped: smoke_project

Config via env vars:
  ABOX_API_URL   - GraphQL endpoint (default: http://localhost:8000/graphql)
  ABOX_TEST_USER - Login username (default: demo)
  ABOX_TEST_PASS - Login password (default: demo)
  SMOKE_RUNTIME  - Runtime to test: "docker" or "modal" (default: docker)
"""

from __future__ import annotations

import os
import sys
import uuid

import docker
import httpx
import pytest

# Reuse e2e helpers — they're stable and well-tested.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "e2e"))
from helpers.graphql import AboxGraphQL
from helpers.docker_ops import DockerOps
from helpers.polling import poll_agent_status

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")
TEST_USER = os.environ.get("ABOX_TEST_USER", "demo")
TEST_PASS = os.environ.get("ABOX_TEST_PASS", "demo")
SMOKE_RUNTIME = os.environ.get("SMOKE_RUNTIME", "docker")


@pytest.fixture(scope="session")
def backend_health():
    """Verify backend is reachable.

    In CI (SMOKE_CI=1), unreachable backend is a hard failure — the
    deploy gate must not silently pass with "all skipped".
    In local dev, we skip gracefully so you can run the suite without
    the full stack up.
    """
    try:
        resp = httpx.post(
            API_URL,
            json={"query": "{ __typename }"},
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
        resp.raise_for_status()
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        if os.environ.get("CI") or os.environ.get("SMOKE_CI"):
            pytest.fail(f"Backend unreachable at {API_URL}: {exc}")
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
            "variables": {"input": {"username": TEST_USER, "password": TEST_PASS}},
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
def gql(auth_token) -> AboxGraphQL:
    """Session-scoped GraphQL client."""
    client = AboxGraphQL(API_URL, auth_token, timeout=60.0)
    yield client
    client.close()


@pytest.fixture(scope="session")
def docker_client():
    """Docker client — only created if runtime is docker."""
    if SMOKE_RUNTIME != "docker":
        yield None
        return
    import platform
    docker_host = os.environ.get("DOCKER_HOST")
    if docker_host:
        client = docker.DockerClient(base_url=docker_host)
    elif (
        platform.system() == "Darwin"
        and not os.path.exists("/var/run/docker.sock")
    ):
        home = os.path.expanduser("~")
        client = docker.DockerClient(base_url=f"unix://{home}/.docker/run/docker.sock")
    else:
        client = docker.from_env()
    yield client
    client.close()


@pytest.fixture(scope="session")
def docker_ops(docker_client):
    """Docker operations helper."""
    if docker_client is None:
        yield None
        return
    yield DockerOps(docker_client)


@pytest.fixture(scope="module")
def smoke_project(gql) -> dict:
    """Create a throwaway project for smoke tests. Cleaned up after."""
    project_name = f"smoke-{uuid.uuid4().hex[:8]}"
    project = gql.create_project(project_name)
    yield project
    try:
        gql.delete_project(project["id"])
    except Exception:
        pass
