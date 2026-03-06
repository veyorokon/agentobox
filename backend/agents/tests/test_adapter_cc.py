"""Claude Code adapter tests — extraction, provisioning, real event parity.

Tests verify:
    1. Extraction correctness — display fields from CC snapshots
    2. Seed data parity — seed_dev_data snapshots match real CC event structure
    3. Real event parity — adapter handles actual CC v2.1.59 stream-json events
    4. Provisioning — config builders produce valid settings.json, CLAUDE.md
"""

import pytest

from agents.adapters.claude_code import ClaudeCodeAdapter
from agents.tests.conftest import (
    SAMPLE_SNAPSHOTS, SAMPLE_EVENTS, SEED_AGENTS,
    REAL_CC_FIXTURES, _events_by_type,
)


# ── Claude Code adapter extraction ──


class TestClaudeCodeExtraction:
    """Principle: adapter extraction is a pure function of the snapshot.

    Given a latest_snapshot dict, the adapter returns display fields (last_output,
    live_action, cost, duration, turns) deterministically. No DB access, no side
    effects, no mutation of the input.
    """

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    # -- last_output --

    def test_last_output_from_assistant(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["assistant_only"]
        assert adapter.last_output(snap) == "I'll fix the bug in the login flow."

    def test_last_output_from_result_snap(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.last_output(snap) == "Fixed the authentication bug."

    def test_last_output_empty_snapshot(self, adapter):
        assert adapter.last_output({}) == ""

    def test_last_output_none_assistant(self, adapter):
        assert adapter.last_output({"assistant": None}) == ""

    def test_last_output_returns_full_text(self, adapter):
        snap = {
            "assistant": {
                "message": {
                    "content": [{"type": "text", "text": "x" * 1000}]
                }
            }
        }
        assert len(adapter.last_output(snap)) == 1000

    # -- live_action --

    def test_live_action_during_tool_use(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["assistant_only"]
        assert adapter.live_action(snap) == "Edit auth.py"

    def test_live_action_clears_after_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.live_action(snap) == ""

    def test_live_action_empty_snapshot(self, adapter):
        assert adapter.live_action({}) == ""

    def test_live_action_none_snapshot(self, adapter):
        assert adapter.live_action(None) == ""

    # -- cost --

    def test_cost_from_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.cost(snap) == pytest.approx(0.045)

    def test_cost_no_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["assistant_only"]
        assert adapter.cost(snap) == 0.0

    def test_cost_empty_snapshot(self, adapter):
        assert adapter.cost({}) == 0.0

    # -- duration --

    def test_duration_formatted(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.duration(snap) == "2m 05s"

    def test_duration_short(self, adapter):
        snap = {"result": {"duration_ms": 45000}}
        assert adapter.duration(snap) == "45s"

    def test_duration_empty(self, adapter):
        assert adapter.duration({}) == "0s"

    # -- duration_ms --

    def test_duration_ms_from_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.duration_ms(snap) == 125000

    def test_duration_ms_empty(self, adapter):
        assert adapter.duration_ms({}) == 0

    # -- turns --

    def test_turns_from_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.turns(snap) == 7

    def test_turns_no_result(self, adapter):
        assert adapter.turns({}) == 0

    # -- is_permission_request --

    def test_permission_request_detected(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["permission_request"]
        result = adapter.is_permission_request(event)
        assert result is not None
        assert result["tool_use_id"] == "toolu_perm_01"
        assert "rm -rf" in result["command"]

    def test_normal_event_no_permission(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["normal_assistant"]
        assert adapter.is_permission_request(event) is None

    def test_permission_empty_event(self, adapter):
        assert adapter.is_permission_request({}) is None

    # -- is_plan_proposal --

    def test_plan_proposal_detected(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["plan_proposal"]
        result = adapter.is_plan_proposal(event)
        assert result is not None
        assert result["tool_use_id"] == "toolu_plan_01"
        assert "Fix auth" in result["plan"]

    def test_normal_event_no_plan(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["normal_assistant"]
        assert adapter.is_plan_proposal(event) is None

    def test_plan_empty_event(self, adapter):
        assert adapter.is_plan_proposal({}) is None


# ── Seed data parity ──


class TestSeedDataParity:
    """Verify seed_dev_data snapshots produce correct adapter output.

    This is the contract test: if seed snapshot structure drifts from what
    the adapter expects (or vice versa), these tests catch it.
    """

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_last_output(self, adapter, agent):
        assert adapter.last_output(agent["snapshot"]) == agent["expected"]["last_output"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_live_action(self, adapter, agent):
        assert adapter.live_action(agent["snapshot"]) == agent["expected"]["live_action"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_duration(self, adapter, agent):
        assert adapter.duration(agent["snapshot"]) == agent["expected"]["duration"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_turns(self, adapter, agent):
        assert adapter.turns(agent["snapshot"]) == agent["expected"]["turns"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_cost(self, adapter, agent):
        assert adapter.cost(agent["snapshot"]) == pytest.approx(agent["expected"]["cost"])


# ── Real CC event parity ──


class TestRealEventParity:
    """Verify adapter handles actual Claude Code v2.1.59 stream-json events.

    Fixtures in tests/fixtures/ are sanitized captures from real CC sessions
    (solo, tool use, plan mode, team mode). These tests prove our adapter
    can extract display fields from events with the FULL real structure,
    not just simplified test snapshots.
    """

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    # -- text_only session: system → assistant(text) → result --

    def test_text_only_snapshot_extracts(self, adapter):
        """Build a snapshot from real text-only events and extract all fields."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        assistant = events["assistant"][0]
        result = events["result"][0]
        snapshot = {"assistant": assistant, "result": result}

        assert adapter.last_output(snapshot) == "4"
        assert adapter.live_action(snapshot) == ""  # result present → cleared
        assert adapter.turns(snapshot) == 1
        assert adapter.cost(snapshot) == pytest.approx(0.2177, abs=0.01)
        assert adapter.duration_ms(snapshot) == 1745
        assert adapter.duration(snapshot) == "1s"

    def test_text_only_no_result_yet(self, adapter):
        """Mid-turn: only assistant event, no result yet."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        assistant = events["assistant"][0]
        snapshot = {"assistant": assistant}

        assert adapter.last_output(snapshot) == "4"
        assert adapter.live_action(snapshot) == ""  # no tool_use block
        assert adapter.turns(snapshot) == 0
        assert adapter.cost(snapshot) == 0.0

    # -- tool_use session: system → assistant(tool) → user → assistant(text) → result --

    def test_tool_use_mid_turn(self, adapter):
        """Mid-turn with active tool use — live_action should show tool name."""
        events = _events_by_type(REAL_CC_FIXTURES["tool_use"])
        # First assistant event has tool_use
        first_assistant = events["assistant"][0]
        snapshot = {"assistant": first_assistant}

        output = adapter.last_output(snapshot)
        action = adapter.live_action(snapshot)
        # First assistant in tool_use fixture has a Read tool_use with file_path
        assert action == "Read base.py"  # tool name + basename from input

    def test_tool_use_completed(self, adapter):
        """Completed tool_use session — last assistant + result."""
        events = _events_by_type(REAL_CC_FIXTURES["tool_use"])
        last_assistant = events["assistant"][-1]
        result = events["result"][0]
        snapshot = {"assistant": last_assistant, "result": result}

        assert adapter.live_action(snapshot) == ""  # result present
        assert adapter.turns(snapshot) == 2
        assert isinstance(adapter.last_output(snapshot), str)
        assert len(adapter.last_output(snapshot)) > 0

    # -- plan_mode session: includes ExitPlanMode tool use --

    def test_plan_mode_detects_plan_proposal(self, adapter):
        """ExitPlanMode tool use should be detected as a plan proposal."""
        events = _events_by_type(REAL_CC_FIXTURES["plan_mode"])
        for assistant_ev in events["assistant"]:
            result = adapter.is_plan_proposal(assistant_ev)
            if result is not None:
                assert "tool_use_id" in result
                assert "plan" in result
                break
        else:
            pytest.fail("No plan proposal detected in plan_mode fixture")

    def test_plan_mode_snapshot_extracts(self, adapter):
        """Full plan_mode session builds valid snapshot."""
        events = _events_by_type(REAL_CC_FIXTURES["plan_mode"])
        last_assistant = events["assistant"][-1]
        result = events["result"][0]
        snapshot = {"assistant": last_assistant, "result": result}

        # All extraction methods should work without error
        assert isinstance(adapter.last_output(snapshot), str)
        assert isinstance(adapter.live_action(snapshot), str)
        assert isinstance(adapter.duration(snapshot), str)
        assert adapter.turns(snapshot) >= 1

    # -- team_mode: same structure as solo (verified empirically) --

    def test_team_mode_same_structure(self, adapter):
        """Team mode events have identical structure to solo mode."""
        events = _events_by_type(REAL_CC_FIXTURES["team_mode"])
        assistant = events["assistant"][0]
        result = events["result"][0]
        snapshot = {"assistant": assistant, "result": result}

        # All methods work identically
        assert isinstance(adapter.last_output(snapshot), str)
        assert adapter.live_action(snapshot) == ""  # result present
        assert adapter.turns(snapshot) >= 1
        assert adapter.cost(snapshot) > 0
        assert adapter.duration_ms(snapshot) > 0

    # -- structural assertions: real events have fields our simplified fixtures lack --

    def test_real_assistant_has_expected_top_level_keys(self):
        """Real assistant events must have these keys (regression guard)."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        assistant = events["assistant"][0]
        required_top = {"type", "message", "session_id"}
        assert required_top.issubset(assistant.keys()), (
            f"Missing top-level keys: {required_top - assistant.keys()}"
        )

    def test_real_assistant_message_has_expected_keys(self):
        """Real assistant.message must have these keys."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        msg = events["assistant"][0]["message"]
        required_msg = {"id", "type", "role", "content", "model"}
        assert required_msg.issubset(msg.keys()), (
            f"Missing message keys: {required_msg - msg.keys()}"
        )

    def test_real_result_has_expected_keys(self):
        """Real result events must have these keys (regression guard)."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        result = events["result"][0]
        required = {
            "type", "is_error", "duration_ms", "duration_api_ms",
            "num_turns", "total_cost_usd", "session_id", "modelUsage",
        }
        assert required.issubset(result.keys()), (
            f"Missing result keys: {required - result.keys()}"
        )

    def test_real_system_init_has_expected_keys(self):
        """Real system/init events must have these keys."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        init = events["system"][0]
        required = {
            "type", "subtype", "session_id", "tools", "model",
            "permissionMode", "claude_code_version",
        }
        assert required.issubset(init.keys()), (
            f"Missing system/init keys: {required - init.keys()}"
        )


# ── Provisioning config builders ──


class TestBuildSettings:
    """Verify ClaudeCodeAdapter.build_settings produces correct settings.json."""

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    def test_default_settings(self, adapter):
        import json
        result = json.loads(adapter.build_settings())
        assert result["theme"] == "dark"
        assert result["defaultMode"] == "bypassPermissions"
        assert result["enableAllProjectMcpServers"] is True
        assert "disallowedTools" in result
        # Team lifecycle tools blocked; team comms tools are hooked, not blocked
        assert "TeamCreate" in result["disallowedTools"]
        assert "TeamDelete" in result["disallowedTools"]
        assert "hooks" in result

    def test_api_key_adds_helper(self, adapter):
        import json
        result = json.loads(adapter.build_settings(api_key="sk-ant-test-key"))
        assert "apiKeyHelper" in result
        assert result["apiKeyHelper"].endswith(".sh")

    def test_no_api_key_no_helper(self, adapter):
        import json
        result = json.loads(adapter.build_settings())
        assert "apiKeyHelper" not in result

    def test_mode_mapping(self, adapter):
        import json
        auto = json.loads(adapter.build_settings(mode="auto"))
        assert auto["defaultMode"] == "bypassPermissions"

        plan = json.loads(adapter.build_settings(mode="plan"))
        assert plan["defaultMode"] == "plan"

        supervised = json.loads(adapter.build_settings(mode="supervised"))
        assert supervised["defaultMode"] == "default"

    def test_disallowed_tools_complete(self, adapter):
        """Team lifecycle tools must be disabled; team comms tools are hooked."""
        import json
        result = json.loads(adapter.build_settings())
        # Only lifecycle tools are blocked — comms tools are intercepted via hooks
        expected = {"TeamCreate", "TeamDelete"}
        assert expected == set(result["disallowedTools"])
        # Hooks intercept the team comms tools (Pre for reads, Post for writes)
        assert "hooks" in result
        all_matchers = ""
        for phase in ("PreToolUse", "PostToolUse"):
            for entry in result["hooks"].get(phase, []):
                all_matchers += entry["matcher"] + "|"
        for tool in ("SendMessage", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList"):
            assert tool in all_matchers, f"{tool} not in hook matchers"


class TestBuildInstructions:
    """Verify ClaudeCodeAdapter.build_instructions produces correct CLAUDE.md."""

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

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
        assert "shared volume" in md

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
        # Native team tools are intercepted by hooks
        assert "SendMessage" in md
        assert "TaskCreate" in md


# ── API proxy provisioning ──


class TestBuildApiKeyFiles:
    """Verify build_api_key_files produces proxy-mode file specs."""

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    def test_no_key_returns_empty(self, adapter):
        assert adapter.build_api_key_files("") == []

    def test_key_returns_proxy_key_and_helper(self, adapter):
        files = adapter.build_api_key_files("sk-ant-real-secret-key-12345")
        assert len(files) == 2

        # First file: proxy key (real key for the root-owned proxy)
        proxy_key = files[0]
        assert proxy_key["path"] == "/run/secrets/proxy_key"
        assert proxy_key["content"] == "sk-ant-real-secret-key-12345"
        assert proxy_key["mode"] == "0600"
        assert proxy_key["owner"] == "root:root"

        # Second file: helper script (echoes placeholder, NOT real key)
        helper = files[1]
        assert helper["path"] == "/opt/abox/api-key-helper.sh"
        assert "echo" in helper["content"]
        assert "sk-ant-proxy00-placeholder" in helper["content"]
        # Must NOT contain the real key
        assert "sk-ant-real-secret-key-12345" not in helper["content"]
        assert helper["mode"] == "0555"
        assert helper["owner"] == "root:root"


class TestBuildOnboardingState:
    """Verify build_onboarding_state pre-approves the placeholder key."""

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    def test_no_key_no_approval(self, adapter):
        import json
        state = json.loads(adapter.build_onboarding_state())
        assert state["hasCompletedOnboarding"] is True
        assert "customApiKeyResponses" not in state

    def test_with_key_approves_placeholder_suffix(self, adapter):
        import json
        from agents.adapters.claude_code import _PROXY_PLACEHOLDER_KEY
        state = json.loads(adapter.build_onboarding_state(api_key="sk-ant-real-key"))
        assert "customApiKeyResponses" in state
        approved = state["customApiKeyResponses"]["approved"]
        assert len(approved) == 1
        # Must be last 20 chars of the PLACEHOLDER key, not the real key
        assert approved[0] == _PROXY_PLACEHOLDER_KEY[-20:]
        assert "real-key" not in approved[0]


class TestBuildRelayEnv:
    """Verify build_relay_env uses proxy placeholder and sets ANTHROPIC_BASE_URL."""

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    def _base_kwargs(self, api_key="sk-ant-real-key"):
        return dict(
            agent_id="agent-123",
            agent_name="backend",
            team_name="test-team",
            parent_session_id="session-456",
            callback_url="http://localhost:8000",
            relay_token="token-abc",
            api_key=api_key,
            model="claude-opus-4-6",
            mode="auto",
        )

    def test_with_key_uses_placeholder(self, adapter):
        from agents.adapters.claude_code import _PROXY_PLACEHOLDER_KEY
        env = adapter.build_relay_env(**self._base_kwargs())
        assert _PROXY_PLACEHOLDER_KEY in env
        # Real key must NOT appear
        assert "sk-ant-real-key" not in env

    def test_with_key_sets_base_url(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs())
        assert "ANTHROPIC_BASE_URL='http://localhost:9999'" in env

    def test_without_key_no_base_url(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs(api_key=""))
        assert "ANTHROPIC_BASE_URL" not in env

    def test_without_key_empty_api_key(self, adapter):
        env = adapter.build_relay_env(**self._base_kwargs(api_key=""))
        assert "ANTHROPIC_API_KEY=''" in env
