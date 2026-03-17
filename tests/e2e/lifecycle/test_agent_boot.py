"""Agent boot health e2e tests for the managed runtime.

Bootstrap smoke proves the runtime contract itself:
  1. backend can create and provision the agent container
  2. the managed runtime reaches idle/ready
  3. canonical runtime files are readable from the container
  4. local ingress health/status endpoints report managed readiness
  5. theme artifacts are generated when theme tokens exist

This suite intentionally avoids provider-specific execution dependencies.
CI bootstrap uses the `echo` executor override so basic boot health is not
coupled to Anthropic credentials or network conditions.
"""

from __future__ import annotations

import json
import time
import uuid

import os

import pytest

from helpers.graphql import AboxGraphQL
from helpers.polling import poll_agent_status

API_URL = os.environ.get("ABOX_API_URL", "http://localhost:8000/graphql")

pytestmark = [pytest.mark.e2e, pytest.mark.agent, pytest.mark.slow]

# Timeouts
BOOT_TIMEOUT_S = 90
BOOT_POLL_INTERVAL_S = 3
SERVICE_CHECK_TIMEOUT_S = 30
MESSAGE_TIMEOUT_S = 120


@pytest.mark.bootstrap
class TestAgentBoot:
    """Verify an agent boots correctly with the new managed runtime contract."""

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

    # -- Runtime health checks --

    def test_healthz_ready(self, booted_agent):
        """Ingress health must report managed readiness."""
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["curl", "-sf", "http://localhost:8080/healthz"],
        )
        assert exit_code == 0, f"healthz request failed (exit={exit_code}): {output}"
        payload = json.loads(output)
        assert payload["status"] == "ready"
        assert payload["startup_stage"] == "managed_ready"
        assert payload["runtime_state"] in {"ready", "busy"}
        assert payload["transport"]["connected"] is True
        assert payload["build"]["image_ref"], f"missing build metadata: {payload}"

    def test_status_projection_reports_managed_ready(self, booted_agent):
        """Status endpoint and projected status file must agree on readiness."""
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        exit_code, output = docker_ops.exec_in_container(
            container.id,
            ["curl", "-sf", "http://localhost:8080/status"],
        )
        assert exit_code == 0, f"status request failed (exit={exit_code}): {output}"
        status = json.loads(output)
        assert status["startup_stage"] == "managed_ready"
        assert status["runtime_state"] in {"ready", "busy"}
        assert status["transport"]["connected"] is True

        exit_code, projected = docker_ops.exec_in_container(
            container.id,
            [
                "python3",
                "-c",
                (
                    "import json, os; "
                    "aid = os.environ['AGENT_ID']; "
                    "from pathlib import Path; "
                    "p = Path('/vol/agents') / aid / '_abox' / 'status.json'; "
                    "print(p.read_text())"
                ),
            ],
            user="agent",
        )
        assert exit_code == 0, f"projected status not readable: {projected}"
        projected_status = json.loads(projected)
        assert projected_status["startup_stage"] == "managed_ready"
        assert projected_status["transport"]["connected"] is True

    # -- Volume and symlink checks --

    def test_volume_inbox_accessible(self, booted_agent):
        """Runtime must be able to read canonical inbox.jsonl under the agent root."""
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

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
        """Projected status.json must exist at the canonical runtime path."""
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
        """Critical bridged runtime paths must resolve inside the container."""
        container = booted_agent["container"]
        docker_ops = booted_agent["docker_ops"]

        critical_paths = [
            "/home/agent/.claude/settings.json",
            "/home/agent/.relay_env",
            "/home/agent/CLAUDE.md",
            "/home/agent/.mcp.json",
        ]

        missing = []
        for path in critical_paths:
            exit_code, _ = docker_ops.exec_in_container(
                container.id, ["test", "-e", path],
            )
            if exit_code != 0:
                missing.append(path)

        assert not missing, (
            f"Critical bridged paths missing: {missing}. "
            f"Provisioning/bridge contract is broken."
        )

    def test_mcp_config_valid(self, booted_agent):
        """MCP config must be valid JSON and use SSE transport semantics."""
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
            assert server_type != "http", (
                f"MCP server '{name}' uses type 'http' — must be 'sse'. "
                f"CC SDK will hang during initialize."
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
