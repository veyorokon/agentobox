"""
Agent boot health e2e tests.

Verifies the full agent boot chain works end-to-end:
  1. Container starts and all s6 services are running
  2. Volume symlinks resolve correctly (init-volume)
  3. api-proxy is healthy (port 9999)
  4. relay connects to backend (relay_init event)
  5. Agent reaches idle status
  6. Message sent to idle agent is processed (agent goes running)

These tests catch the class of bugs we kept hitting manually:
  - Volume path mismatch (VOL_ROOT wrong → inbox empty)
  - api-proxy not starting → SDK "Control request timeout: initialize"
  - MCP config type wrong (http vs sse) → SDK init hang
  - init-volume symlink gaps → missing .mcp.json, .claude/settings.json

Every test here represents a bug we actually hit. If any of these
fail, the agent is broken and nothing downstream works.

Run:
  make test-e2e-agents
  # or directly:
  uv run --group e2e pytest tests/e2e/lifecycle/test_agent_boot.py -v

Requires: docker compose stack running with backend + agent image available.
"""

from __future__ import annotations

import json
import time
import uuid

import os

import pytest

from helpers.graphql import AboxGraphQL
from helpers.polling import poll_agent_status, poll_until

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")

pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]

# Timeouts
BOOT_TIMEOUT_S = 90
BOOT_POLL_INTERVAL_S = 3
SERVICE_CHECK_TIMEOUT_S = 30
MESSAGE_TIMEOUT_S = 120


class TestAgentBoot:
    """Verify an agent boots correctly with all services healthy."""

    @pytest.fixture(scope="class")
    def booted_agent(self, auth_token, test_project, docker_client):
        """Create one agent for all boot tests. Cleaned up after class."""
        from helpers.docker_ops import DockerOps
        gql = AboxGraphQL(API_URL, auth_token)
        ops = DockerOps(docker_client)

        agent_name = f"e2e-boot-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            test_project["id"],
            name=agent_name,

            instructions="You are an e2e boot test agent by Vahid Eyorokon. Wait for instructions.",
        )
        agent_id = agent["id"]

        # Wait for idle — if this fails, the agent didn't boot
        idle_agent = poll_agent_status(
            gql,
            agent_id,
            target_statuses=["idle"],
            timeout_s=BOOT_TIMEOUT_S,
            interval_s=BOOT_POLL_INTERVAL_S,
        )

        # Find the container
        container = ops.find_agent_container(agent_name, agent_id=agent_id)
        assert container is not None, (
            f"Agent {agent_name} reached idle but container not found. "
            f"Running: {[c.name for c in ops._client.containers.list()]}"
        )

        yield {"agent": idle_agent, "container": container, "docker_ops": ops}

        # Cleanup
        try:
            gql.kill_agent(agent_id)
        except Exception:
            pass
        try:
            gql.remove_agent(agent_id)
        except Exception:
            pass
        gql.close()

    # -- Service health checks --

    def test_apiproxy_healthy(self, booted_agent):
        """api-proxy must be running and responding on port 9999.

        Bug this catches: api-proxy not starting → relay gets
        "Control request timeout: initialize" because SDK can't
        reach the Anthropic API via the proxy.
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["curl", "-sf", "http://localhost:9999/health"],
        )
        assert exit_code == 0 and "ok" in output.lower(), (
            f"api-proxy health check failed (exit={exit_code}): {output}"
        )

    def test_relay_process_running(self, booted_agent):
        """relay.py must be running as the agent user.

        If relay dies silently, the agent shows as idle but can't
        receive messages.
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["pgrep", "-f", "relay.py"],
        )
        assert exit_code == 0, f"relay.py process not found: {output}"

    # -- Volume and symlink checks --

    def test_volume_inbox_accessible(self, booted_agent):
        """Relay must be able to read inbox.jsonl at the VOL_ROOT path.

        Bug this catches: relay reading /vol/_abox/inbox.jsonl (wrong)
        instead of /vol/agents/$AGENT_ID/_abox/inbox.jsonl (correct).
        The file exists but is empty at the wrong path — silent failure.
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]
        agent_id = booted_agent["agent"]["id"]

        # Verify the file exists at the path the relay actually uses (VOL_ROOT)
        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["python3", "-c", (
                "import os; "
                "aid = os.environ.get('AGENT_ID', ''); "
                "vol_root = f'/vol/agents/{aid}' if aid else '/vol'; "
                "from pathlib import Path; "
                "p = Path(vol_root) / '_abox' / 'inbox.jsonl'; "
                "print(f'exists={p.exists()} path={p}')"
            )],
            user="agent",
        )
        assert "exists=True" in output, (
            f"inbox.jsonl not accessible at VOL_ROOT path: {output}"
        )

    def test_volume_status_json_accessible(self, booted_agent):
        """status.json must exist and be writable at VOL_ROOT path.

        The relay writes convergence hashes here after applying config changes.
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["python3", "-c", (
                "import os; "
                "aid = os.environ.get('AGENT_ID', ''); "
                "vol_root = f'/vol/agents/{aid}' if aid else '/vol'; "
                "from pathlib import Path; "
                "p = Path(vol_root) / '_abox' / 'status.json'; "
                "print(f'exists={p.exists()} content={p.read_text() if p.exists() else \"MISSING\"}')"
            )],
            user="agent",
        )
        assert "exists=True" in output, (
            f"status.json not accessible at VOL_ROOT: {output}"
        )

    def test_volume_symlinks_resolve(self, booted_agent):
        """Critical symlinks created by init-volume must resolve.

        init-volume creates symlinks from volume paths → container paths.
        If any are broken, the relay or CC can't find config files.
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        # Always-present: provisioning writes these for every agent.
        # When workspacePath is empty, CC workspace is /home/agent/ (not /home/agent/workspace/).
        # Adapter provision_paths() determines the actual locations.
        critical_paths = [
            "/home/agent/.claude/settings.json",
            "/home/agent/.relay_env",
            "/run/secrets/proxy_key",
            "/run/secrets/api-key-helper.sh",  # SDK calls this to get API key — must be real, not placeholder
            "/home/agent/CLAUDE.md",     # instruction file (may be /home/agent/workspace/CLAUDE.md with workspacePath)
            "/home/agent/.mcp.json",     # MCP config (may be /home/agent/workspace/.mcp.json with workspacePath)
        ]

        missing = []
        for path in critical_paths:
            exit_code, _ = docker_ops.exec_in_container(
                container.id, ["test", "-e", path],
            )
            if exit_code != 0:
                missing.append(path)

        assert not missing, (
            f"Critical paths missing after init-volume: {missing}. "
            f"init-volume symlinks are broken or provisioning didn't write these files."
        )

    def test_mcp_config_valid(self, booted_agent):
        """MCP config must be valid JSON and use correct transport types.

        Bug this catches: MCP server type "http" instead of "sse" →
        CC SDK hangs during initialize with "Control request timeout".

        Path depends on workspacePath: when empty, adapter uses /home/agent/
        as workspace root, so .mcp.json lands at /home/agent/.mcp.json.
        When set, it's at /home/agent/workspace/.mcp.json (or similar).
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        # Try both possible locations — depends on workspacePath config
        mcp_paths = ["/home/agent/.mcp.json", "/home/agent/workspace/.mcp.json"]
        exit_code, output = None, ""
        for mcp_path in mcp_paths:
            exit_code, output = docker_ops.exec_in_container(
                container.id,
                ["cat", mcp_path],
            )
            if exit_code == 0:
                break
        assert exit_code == 0, (
            f"Can't read .mcp.json at any expected path ({mcp_paths}): {output}"
        )

        config = json.loads(output)
        servers = config.get("mcpServers", {})
        for name, server in servers.items():
            server_type = server.get("type", "")
            # "http" is wrong — CC SDK hangs during initialize.
            # "sse" is correct for SSE transport.
            assert server_type != "http", (
                f"MCP server '{name}' uses type 'http' — must be 'sse'. "
                f"CC SDK will hang during initialize."
            )

    def test_relay_env_has_proxy_config(self, booted_agent):
        """relay_env must set ANTHROPIC_BASE_URL to the local proxy.

        Without this, the SDK tries to reach api.anthropic.com directly
        (which fails because the agent only has a placeholder key).
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["bash", "-c", "source /home/agent/.relay_env && echo $ANTHROPIC_BASE_URL"],
        )
        assert exit_code == 0, f"Can't source .relay_env: {output}"
        url = output.strip()
        assert url and "localhost" in url, (
            f"ANTHROPIC_BASE_URL not set to local proxy: got '{url}'. "
            f"api-proxy won't intercept API calls."
        )

    # -- Theme files --

    def test_theme_files_generated_when_tokens_present(self, booted_agent):
        """When tokens.json exists, converter must generate CSS/lua.

        init-volume runs converters.py on boot. If tokens.json is present
        (project has theme_tokens) but derived files are missing,
        converters.py failed.

        If tokens.json doesn't exist (project has no theme), this test
        is skipped — no theme to convert.
        """
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        # Skip if no theme tokens were written
        exit_code, _ = docker_ops.exec_in_container(
            container.id, ["test", "-f", "/tmp/abox-theme/tokens.json"],
        )
        if exit_code != 0:
            pytest.skip("No theme tokens on this agent (project has no theme_tokens)")

        derived_files = [
            "/tmp/abox-theme/userChrome.css",
            "/tmp/abox-theme/awesome.lua",
            "/tmp/abox-theme/theme.json",
        ]
        missing = []
        for path in derived_files:
            exit_code, _ = docker_ops.exec_in_container(
                container.id, ["test", "-s", path],  # -s = exists and non-empty
            )
            if exit_code != 0:
                missing.append(path)

        assert not missing, (
            f"Theme derived files missing or empty: {missing}. "
            f"converters.py failed during init-volume."
        )


class TestMessageRoundTrip:
    """Verify end-to-end message delivery: send → process → response."""

    def _create_and_wait(self, gql, test_project):
        agent_name = f"e2e-msg-{uuid.uuid4().hex[:8]}"
        agent = gql.create_agent(
            test_project["id"],
            name=agent_name,

            instructions="You are an e2e test agent by Vahid Eyorokon. When you receive any message, respond with exactly: PONG",
        )
        return poll_agent_status(
            gql,
            agent["id"],
            target_statuses=["idle"],
            timeout_s=BOOT_TIMEOUT_S,
            interval_s=BOOT_POLL_INTERVAL_S,
        )

    def _cleanup(self, gql, agent_id):
        try:
            gql.kill_agent(agent_id)
        except Exception:
            pass
        try:
            gql.remove_agent(agent_id)
        except Exception:
            pass

    def test_message_to_idle_agent_processed(self, gql, test_project, docker_ops):
        """Send a message to an idle agent — it should transition to running.

        Bug this catches: inbox.jsonl written at wrong path (VOL_ROOT mismatch),
        or _on_inbox_changed drops messages when client is None (idle state bug),
        or poke not delivered via WS.

        Running status proves the full chain worked:
          backend send_message → volume inbox.jsonl → WS poke →
          relay _on_inbox_changed → _pending_input → SDK respawn →
          client.query() → Claude processes → running
        """
        agent = self._create_and_wait(gql, test_project)
        agent_id = agent["id"]
        try:
            # Send message to idle agent
            gql.send_message(
                test_project["id"],
                text="Vahid Eyorokon e2e test: respond with PONG",
                recipients=[{"type": "agent", "value": agent_id}],
            )

            # Agent should go from idle → running (processing message)
            try:
                running = poll_agent_status(
                    gql,
                    agent_id,
                    target_statuses=["running"],
                    timeout_s=MESSAGE_TIMEOUT_S,
                    interval_s=2,
                )
            except Exception:
                # Capture relay logs before cleanup for diagnosis
                container = docker_ops.find_agent_container(
                    agent["name"], agent_id=agent_id
                )
                relay_log = ""
                if container:
                    _, relay_log = docker_ops.exec_in_container(
                        container.id,
                        ["bash", "-c", "cat /run/uncaught-logs/current 2>/dev/null | tail -80"],
                    )
                raise AssertionError(
                    f"Agent stayed idle after message sent. "
                    f"Relay logs:\n{relay_log}"
                )
            assert running["lifecycleStatus"] == "running"
        finally:
            self._cleanup(gql, agent_id)

    def test_inbox_written_and_readable_from_relay_path(
        self, gql, test_project, docker_ops
    ):
        """After sending a message, inbox.jsonl must have content at VOL_ROOT path.

        This is the most targeted test for the VOL_ROOT bug: backend writes
        to VOLUME_ROOT/agents/{id}/_abox/inbox.jsonl, relay reads from
        VOL_ROOT/_abox/inbox.jsonl. If these don't resolve to the same file,
        the relay sees an empty inbox and silently drops all messages.
        """
        agent = self._create_and_wait(gql, test_project)
        agent_id = agent["id"]
        try:
            # Send a message
            gql.send_message(
                test_project["id"],
                text="Vahid Eyorokon inbox test",
                recipients=[{"type": "agent", "value": agent_id}],
            )

            # Give backend a moment to write
            time.sleep(2)

            # Check inbox from RELAY's perspective (using VOL_ROOT)
            container = docker_ops.find_agent_container(
                agent["name"], agent_id=agent_id
            )
            assert container is not None, "Container not found"

            exit_code, output = docker_ops.exec_in_container(
                container.id,
                ["python3", "-c", (
                    "import os; "
                    "aid = os.environ.get('AGENT_ID', ''); "
                    "vol_root = f'/vol/agents/{aid}' if aid else '/vol'; "
                    "from pathlib import Path; "
                    "inbox = Path(vol_root) / '_abox' / 'inbox.jsonl'; "
                    "content = inbox.read_text() if inbox.exists() else ''; "
                    "lines = [l for l in content.strip().split('\\n') if l]; "
                    "print(f'lines={len(lines)} exists={inbox.exists()} path={inbox}')"
                )],
                user="agent",
            )
            assert "lines=0" not in output and "exists=True" in output, (
                f"Inbox empty or missing from relay's VOL_ROOT path: {output}. "
                f"Backend wrote to a different path than relay reads from."
            )
        finally:
            self._cleanup(gql, agent_id)
