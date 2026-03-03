"""OpenCode adapter tests — extraction, provisioning, real event parity.

Tests verify:
    1. Extraction correctness — display fields from OpenCode SSE/REST snapshots
    2. Provisioning — config builders produce valid opencode.json, AGENTS.md
    3. Real event parity — adapter handles actual OC v1.2.15 REST/SSE events
"""

import pytest

from agents.adapters.opencode import OpenCodeAdapter
from agents.tests.conftest import (
    SAMPLE_SNAPSHOTS, SAMPLE_EVENTS, REAL_OC_FIXTURES,
)


# ── OpenCode adapter extraction ──


class TestOpenCodeExtraction:
    """Principle: adapter extraction is a pure function of the snapshot.

    OpenCode snapshots use {message, parts, idle} instead of CC's
    {assistant, result}. The adapter navigates this structure deterministically.
    """

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    # -- last_output --

    def test_last_output_from_parts(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["assistant_only"]
        assert adapter.last_output(snap) == "I'll fix the bug in the login flow."

    def test_last_output_from_completed(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["with_idle"]
        assert adapter.last_output(snap) == "Fixed the authentication bug."

    def test_last_output_empty_snapshot(self, adapter):
        assert adapter.last_output({}) == ""

    def test_last_output_none_parts(self, adapter):
        assert adapter.last_output({"parts": None}) == ""

    def test_last_output_none_values(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["none_values"]
        assert adapter.last_output(snap) == ""

    # -- live_action --

    def test_live_action_during_running_tool(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["assistant_only"]
        assert adapter.live_action(snap) == "edit"

    def test_live_action_clears_after_idle(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["with_idle"]
        assert adapter.live_action(snap) == ""

    def test_live_action_empty_snapshot(self, adapter):
        assert adapter.live_action({}) == ""

    def test_live_action_none_snapshot(self, adapter):
        assert adapter.live_action(None) == ""

    # -- cost --

    def test_cost_from_message(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["with_idle"]
        assert adapter.cost(snap) == pytest.approx(0.045)

    def test_cost_zero_when_running(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["assistant_only"]
        assert adapter.cost(snap) == 0.0

    def test_cost_empty_snapshot(self, adapter):
        assert adapter.cost({}) == 0.0

    # -- duration --

    def test_duration_formatted(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["with_idle"]
        # 1772565849233 - 1772565724233 = 125000ms = 2m 05s
        assert adapter.duration(snap) == "2m 05s"

    def test_duration_empty(self, adapter):
        assert adapter.duration({}) == "0s"

    def test_duration_no_completed(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["assistant_only"]
        # No completed time → 0s
        assert adapter.duration(snap) == "0s"

    # -- duration_ms --

    def test_duration_ms_from_message(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["with_idle"]
        assert adapter.duration_ms(snap) == 125000

    def test_duration_ms_empty(self, adapter):
        assert adapter.duration_ms({}) == 0

    # -- turns --

    def test_turns_from_parts(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["with_idle"]
        assert adapter.turns(snap) == 1

    def test_turns_running(self, adapter):
        snap = SAMPLE_SNAPSHOTS["opencode"]["assistant_only"]
        assert adapter.turns(snap) == 1

    def test_turns_no_parts(self, adapter):
        assert adapter.turns({}) == 0

    # -- is_permission_request --

    def test_permission_request_detected(self, adapter):
        event = SAMPLE_EVENTS["opencode"]["permission_request"]
        result = adapter.is_permission_request(event)
        assert result is not None
        assert result["tool_use_id"] == "tooluse_test_001"
        assert "test.txt" in result["command"]
        assert result["risk"] == "edit"

    def test_normal_event_no_permission(self, adapter):
        event = SAMPLE_EVENTS["opencode"]["normal_assistant"]
        assert adapter.is_permission_request(event) is None

    def test_permission_empty_event(self, adapter):
        assert adapter.is_permission_request({}) is None

    # -- is_plan_proposal --

    def test_plan_proposal_always_none(self, adapter):
        """OpenCode has no plan proposal mechanism — always returns None."""
        for key in SAMPLE_EVENTS["opencode"]:
            assert adapter.is_plan_proposal(SAMPLE_EVENTS["opencode"][key]) is None

    def test_plan_empty_event(self, adapter):
        assert adapter.is_plan_proposal({}) is None

    # -- wire_to_mode / mode_to_wire --

    def test_wire_to_mode(self, adapter):
        assert adapter.wire_to_mode("allow") == "auto"
        assert adapter.wire_to_mode("ask") == "supervised"
        assert adapter.wire_to_mode("unknown") == ""

    def test_mode_to_wire(self, adapter):
        assert adapter.mode_to_wire("auto") == "allow"
        assert adapter.mode_to_wire("supervised") == "ask"
        assert adapter.mode_to_wire("unknown") == ""


# ── OpenCode provisioning config builders ──


class TestOpenCodeBuildSettings:
    """Verify OpenCodeAdapter.build_settings produces correct opencode.json."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def test_default_settings(self, adapter):
        import json
        result = json.loads(adapter.build_settings())
        assert result["permission"] == "allow"

    def test_supervised_mode(self, adapter):
        import json
        result = json.loads(adapter.build_settings(mode="supervised"))
        assert result["permission"] == "ask"

    def test_auto_mode(self, adapter):
        import json
        result = json.loads(adapter.build_settings(mode="auto"))
        assert result["permission"] == "allow"


class TestOpenCodeBuildInstructions:
    """Verify OpenCodeAdapter.build_instructions produces correct AGENTS.md."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def test_identity_section(self, adapter):
        md = adapter.build_instructions(
            project_name="TestProject",
            agent_name="backend",
        )
        assert "# TestProject" in md
        assert "**backend**" in md
        assert "a team member" in md

    def test_lead_role(self, adapter):
        md = adapter.build_instructions(
            project_name="TestProject",
            agent_name="team-lead",
            agent_role="lead",
            team_members=[
                {"name": "team-lead", "role": "lead", "instructions": "Lead"},
                {"name": "worker", "role": "worker", "instructions": "Code"},
            ],
        )
        assert "the team lead" in md
        assert "## Coordination" in md
        assert "teammate_spawn" in md

    def test_worker_gets_tasks_not_coordination(self, adapter):
        md = adapter.build_instructions(
            project_name="TestProject",
            agent_name="worker",
            agent_role="worker",
        )
        assert "## Tasks" in md
        assert "## Coordination" not in md

    def test_workspace_section_with_path(self, adapter):
        md = adapter.build_instructions(
            project_name="P",
            agent_name="a",
            workspace_path="/some/path",
        )
        assert "/home/agent/workspace" in md

    def test_workspace_section_without_path(self, adapter):
        md = adapter.build_instructions(
            project_name="P",
            agent_name="a",
        )
        assert "/home/agent" in md

    def test_team_roster(self, adapter):
        members = [
            {"name": "lead", "role": "lead", "instructions": "Coordinate"},
            {"name": "dev", "role": "worker", "instructions": "Code things"},
        ]
        md = adapter.build_instructions(
            project_name="P",
            agent_name="dev",
            team_members=members,
        )
        assert "**lead** (lead)" in md
        assert "**dev** (worker) (you)" in md
        assert "## Communication" in md

    def test_responsibilities_section(self, adapter):
        md = adapter.build_instructions(
            project_name="P",
            agent_name="a",
            instructions="Build the login page",
        )
        assert "## Responsibilities" in md
        assert "Build the login page" in md

    def test_mcp_instructions_injected(self, adapter):
        md = adapter.build_instructions(
            project_name="P",
            agent_name="a",
            mcp_instructions=["## Playwright\n\nUse browser tools."],
        )
        assert "## Playwright" in md
        assert "Use browser tools." in md

    def test_security_section_always_present(self, adapter):
        md = adapter.build_instructions(
            project_name="P",
            agent_name="a",
        )
        assert "## Security" in md
        assert "NEVER output API keys" in md

    def test_platform_section_mentions_team_tools(self, adapter):
        md = adapter.build_instructions(
            project_name="P",
            agent_name="a",
        )
        assert "**team** MCP server" in md
        assert "send_message" in md
        assert "task_create" in md


class TestOpenCodeBuildMcpConfig:
    """Verify OpenCodeAdapter.build_mcp_config produces valid MCP config."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def test_empty_config(self, adapter):
        import json
        result = json.loads(adapter.build_mcp_config())
        assert result["mcpServers"] == {}

    def test_with_coord_server(self, adapter):
        import json
        coord = {"url": "http://localhost:8000/mcp", "headers": {"Authorization": "Bearer tok"}}
        result = json.loads(adapter.build_mcp_config(coord_server=coord))
        assert "team" in result["mcpServers"]
        assert result["mcpServers"]["team"]["type"] == "remote"
        assert result["mcpServers"]["team"]["url"] == "http://localhost:8000/mcp"

    def test_with_local_server(self, adapter):
        import json
        servers = {"playwright": {"command": ["npx", "@playwright/mcp@latest"]}}
        result = json.loads(adapter.build_mcp_config(mcp_servers=servers))
        assert "playwright" in result["mcpServers"]
        assert result["mcpServers"]["playwright"]["type"] == "local"
        assert result["mcpServers"]["playwright"]["command"] == ["npx", "@playwright/mcp@latest"]

    def test_secret_envs_injected(self, adapter):
        import json
        servers = {"test": {"command": ["echo"]}}
        secrets = {"API_KEY": "secret123"}
        result = json.loads(adapter.build_mcp_config(mcp_servers=servers, secret_envs=secrets))
        assert result["mcpServers"]["test"]["environment"] == {"API_KEY": "secret123"}


class TestOpenCodeBuildApiKeyFiles:
    """Verify OpenCodeAdapter.build_api_key_files produces proxy key file spec."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def test_no_key_returns_empty(self, adapter):
        assert adapter.build_api_key_files("") == []

    def test_key_returns_proxy_key_only(self, adapter):
        files = adapter.build_api_key_files("sk-ant-real-key-12345")
        assert len(files) == 1
        proxy_key = files[0]
        assert proxy_key["path"] == "/run/secrets/proxy_key"
        assert proxy_key["content"] == "sk-ant-real-key-12345"
        assert proxy_key["mode"] == "0600"
        assert proxy_key["owner"] == "root:root"


class TestOpenCodeBuildOnboardingState:
    """Verify OpenCodeAdapter.build_onboarding_state returns empty."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def test_always_empty(self, adapter):
        assert adapter.build_onboarding_state() == ""
        assert adapter.build_onboarding_state(api_key="sk-ant-key") == ""


class TestOpenCodeBuildRelayEnv:
    """Verify OpenCodeAdapter.build_relay_env produces correct env file."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def _base_kwargs(self, api_key="sk-ant-real-key", model="anthropic/claude-sonnet-4-5-20250929"):
        return dict(
            agent_id="agent-123",
            agent_name="backend",
            team_name="test-team",
            parent_session_id="session-456",
            callback_url="http://localhost:8000",
            relay_token="token-abc",
            api_key=api_key,
            model=model,
            mode="auto",
        )

    def test_agent_type_is_opencode(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs())
        assert "AGENT_TYPE='opencode'" in env

    def test_opencode_port(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs())
        assert "OPENCODE_PORT='4096'" in env

    def test_anthropic_proxy_env(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs(model="anthropic/claude-sonnet-4-5-20250929"))
        assert "ANTHROPIC_API_KEY='proxy-placeholder'" in env
        assert "ANTHROPIC_BASE_URL='http://localhost:9999'" in env
        # Real key must NOT appear
        assert "sk-ant-real-key" not in env

    def test_openai_proxy_env(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs(model="openai/gpt-4.1"))
        assert "OPENAI_API_KEY='proxy-placeholder'" in env
        assert "OPENAI_BASE_URL='http://localhost:9999'" in env

    def test_google_proxy_env(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs(model="google/gemini-2.5-pro"))
        assert "GEMINI_API_KEY='proxy-placeholder'" in env
        assert "GEMINI_BASE_URL='http://localhost:9999'" in env

    def test_no_key_no_proxy(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs(api_key=""))
        assert "ANTHROPIC_BASE_URL" not in env
        assert "OPENAI_BASE_URL" not in env
        assert "proxy-placeholder" not in env

    def test_model_in_env(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs())
        assert "OPENCODE_MODEL=" in env
        assert "anthropic/claude-sonnet-4-5-20250929" in env


class TestOpenCodeProvisionPaths:
    """Verify OpenCodeAdapter.provision_paths returns correct file paths."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    def test_paths(self, adapter):
        paths = adapter.provision_paths("/home/agent")
        assert paths["instruction_file"] == "/home/agent/AGENTS.md"
        assert paths["settings_file"] == "/home/agent/opencode.json"
        assert paths["mcp_config_file"] == "/home/agent/.mcp.json"
        assert paths["onboarding_file"] == ""
        assert paths["config_dir"] == "/home/agent/.opencode"
        assert paths["skills_dir"] == "/home/agent/.opencode/plugins"


# ── Real OpenCode event parity ──


class TestRealOpenCodeParity:
    """Verify adapter handles actual OpenCode v1.2.15 REST/SSE events.

    Fixtures in tests/fixtures/oc_*.json are sanitized captures from real
    OpenCode sessions. These tests prove the adapter extracts display fields
    from events with the FULL real structure, not simplified test snapshots.
    """

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    # -- text_only REST response --

    def test_text_only_extracts(self, adapter):
        """REST response for text-only answer (2+2=4)."""
        fixture = REAL_OC_FIXTURES["text_only"]
        # REST responses have "info" at top level (not "message")
        assert adapter.last_output(fixture) == "4"
        assert adapter.live_action(fixture) == ""  # no tool parts
        assert adapter.cost(fixture) == pytest.approx(0.0788, abs=0.001)
        # 1772565726064 - 1772565724233 = 1831ms
        assert adapter.duration_ms(fixture) == 1831
        assert adapter.duration(fixture) == "1s"
        assert adapter.turns(fixture) == 1  # one step-start

    # -- tool_use REST response --

    def test_tool_use_completed_extracts(self, adapter):
        """REST response with completed tool use (write file)."""
        fixture = REAL_OC_FIXTURES["tool_use"]
        assert adapter.last_output(fixture) == "done. `hello.txt` created."
        assert adapter.live_action(fixture) == ""  # tool status is "completed"
        assert adapter.cost(fixture) == pytest.approx(0.00707, abs=0.001)
        # 1772565758601 - 1772565757188 = 1413ms
        assert adapter.duration_ms(fixture) == 1413
        assert adapter.duration(fixture) == "1s"
        assert adapter.turns(fixture) == 1

    def test_tool_use_mid_turn(self, adapter):
        """Simulate mid-turn by removing idle and setting tool to running."""
        fixture = REAL_OC_FIXTURES["tool_use"]
        # Build a snapshot with the tool in running state
        parts = []
        for part in fixture["parts"]:
            if part.get("type") == "tool":
                p = dict(part)
                p["state"] = dict(p["state"])
                p["state"]["status"] = "running"
                parts.append(p)
            else:
                parts.append(part)
        snap = {"info": fixture["info"], "parts": parts}
        assert adapter.live_action(snap) == "write"

    # -- permission SSE events --

    def test_permission_from_real_event(self, adapter):
        """Permission.asked SSE event from real capture."""
        events = REAL_OC_FIXTURES["permission"]
        perm_event = events[0]  # permission.asked
        result = adapter.is_permission_request(perm_event)
        assert result is not None
        assert result["tool_use_id"] == "tooluse_test_002"
        assert "/home/agent/workspace/test.txt" in result["command"]
        assert result["risk"] == "edit"

    def test_permission_replied_not_request(self, adapter):
        """Permission.replied is NOT a permission request."""
        events = REAL_OC_FIXTURES["permission"]
        replied_event = events[1]  # permission.replied
        assert adapter.is_permission_request(replied_event) is None

    # -- session_idle SSE events --

    def test_session_idle_clears_live_action(self, adapter):
        """Snapshot with idle event should clear live_action."""
        idle_events = REAL_OC_FIXTURES["session_idle"]
        idle_ev = idle_events[-1]  # session.idle
        snap = {
            "parts": [
                {"type": "step-start", "id": "prt_001"},
                {"type": "tool", "tool": "edit", "state": {"status": "running"}, "id": "prt_002"},
            ],
            "idle": idle_ev,
        }
        # Even with a running tool, idle means turn is done
        assert adapter.live_action(snap) == ""

    # -- full SSE stream lifecycle --

    def test_sse_stream_build_snapshot(self, adapter):
        """Build a snapshot from the full SSE stream and extract fields.

        Simulates what the relay would construct: last assistant message.updated
        as info, collected parts, and session.idle event.
        """
        stream = REAL_OC_FIXTURES["sse_stream"]

        # Find the last completed assistant message.updated
        last_assistant_info = None
        for ev in stream:
            if ev["type"] == "message.updated":
                info = ev["properties"].get("info", {})
                if info.get("role") == "assistant" and info.get("time", {}).get("completed"):
                    last_assistant_info = info

        # Collect parts for the last assistant message
        msg_id = last_assistant_info["id"]
        parts = []
        for ev in stream:
            if ev["type"] == "message.part.updated":
                part = ev["properties"].get("part", {})
                if part.get("messageID") == msg_id:
                    parts.append(part)

        # Find session.idle
        idle_ev = None
        for ev in stream:
            if ev["type"] == "session.idle":
                idle_ev = ev

        snapshot = {"info": last_assistant_info, "parts": parts, "idle": idle_ev}

        # Verify all extraction methods work
        assert "test.txt" in adapter.last_output(snapshot)
        assert adapter.live_action(snapshot) == ""  # idle present
        assert adapter.cost(snapshot) == pytest.approx(0.00695, abs=0.001)
        assert adapter.duration_ms(snapshot) > 0
        assert adapter.turns(snapshot) >= 1

    def test_sse_stream_permission_detection(self, adapter):
        """Permission.asked in the full SSE stream is detected."""
        stream = REAL_OC_FIXTURES["sse_stream"]
        perm_events = [ev for ev in stream if ev["type"] == "permission.asked"]
        assert len(perm_events) >= 1
        result = adapter.is_permission_request(perm_events[0])
        assert result is not None
        assert result["risk"] == "edit"

    # -- structural assertions --

    def test_real_rest_response_has_expected_keys(self):
        """Real REST responses must have these top-level keys."""
        fixture = REAL_OC_FIXTURES["text_only"]
        assert {"info", "parts"}.issubset(fixture.keys())

    def test_real_info_has_expected_keys(self):
        """Real info block must have these keys."""
        info = REAL_OC_FIXTURES["text_only"]["info"]
        required = {"role", "time", "cost", "tokens", "id", "sessionID", "modelID", "providerID"}
        assert required.issubset(info.keys()), (
            f"Missing info keys: {required - info.keys()}"
        )

    def test_real_parts_have_expected_types(self):
        """Real parts must include step-start and step-finish."""
        parts = REAL_OC_FIXTURES["text_only"]["parts"]
        types = {p["type"] for p in parts}
        assert "step-start" in types
        assert "step-finish" in types

    def test_real_tool_part_has_state(self):
        """Real tool parts must have a state with status."""
        parts = REAL_OC_FIXTURES["tool_use"]["parts"]
        tool_parts = [p for p in parts if p["type"] == "tool"]
        assert len(tool_parts) >= 1
        assert "state" in tool_parts[0]
        assert "status" in tool_parts[0]["state"]

    def test_real_permission_event_structure(self):
        """Real permission.asked must have expected properties."""
        event = REAL_OC_FIXTURES["permission"][0]
        assert event["type"] == "permission.asked"
        props = event["properties"]
        required = {"id", "sessionID", "permission", "patterns", "metadata", "tool"}
        assert required.issubset(props.keys()), (
            f"Missing permission keys: {required - props.keys()}"
        )
