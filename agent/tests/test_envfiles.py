from pathlib import Path

from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.envfiles import (
    load_managed_runtime_env,
    load_runtime_state_env,
    parse_export_env_file,
)


def test_parse_export_env_file_reads_shell_export_lines(tmp_path):
    path = tmp_path / "env"
    path.write_text(
        "# comment\n"
        "export CLAUDE_MODEL='claude-sonnet-4-5'\n"
        "export AGENT_MODE=auto\n"
        "export ANTHROPIC_API_KEY='sk-test-abc'\n"
    )

    parsed = parse_export_env_file(path)

    assert parsed == {
        "CLAUDE_MODEL": "claude-sonnet-4-5",
        "AGENT_MODE": "auto",
        "ANTHROPIC_API_KEY": "sk-test-abc",
    }


def test_load_managed_runtime_env_merges_relay_and_secret_env(tmp_path):
    relay_env = tmp_path / CANONICAL_PATHS["relay_env"]
    relay_env.parent.mkdir(parents=True, exist_ok=True)
    relay_env.write_text(
        "export CLAUDE_MODEL='claude-sonnet-4-5'\n"
        "export AGENT_MODE=plan\n"
        "export ANTHROPIC_BASE_URL='http://localhost:9999'\n"
    )

    runtime_state = tmp_path / CANONICAL_PATHS["runtime_state"]
    runtime_state.parent.mkdir(parents=True, exist_ok=True)
    runtime_state.write_text(
        '{"model":"claude-opus-4-6","mode":"auto","allowed_tools":["Read","Glob"]}'
    )

    secret_env = tmp_path / CANONICAL_PATHS["secret_env"]
    secret_env.parent.mkdir(parents=True, exist_ok=True)
    secret_env.write_text("export ANTHROPIC_API_KEY='sk-test'\n")

    loaded = load_managed_runtime_env(tmp_path)

    assert loaded["CLAUDE_MODEL"] == "claude-opus-4-6"
    assert loaded["AGENT_MODE"] == "auto"
    assert loaded["ALLOWED_TOOLS"] == '["Read", "Glob"]'
    assert loaded["ANTHROPIC_API_KEY"] == "sk-test"
    assert loaded["ANTHROPIC_BASE_URL"] == "https://api.anthropic.com"


def test_load_runtime_state_env_reads_canonical_state_document(tmp_path):
    runtime_state = tmp_path / CANONICAL_PATHS["runtime_state"]
    runtime_state.parent.mkdir(parents=True, exist_ok=True)
    runtime_state.write_text(
        '{"model":"claude-sonnet-4-5","mode":"plan","allowed_tools":["Read"]}'
    )

    loaded = load_runtime_state_env(tmp_path)

    assert loaded == {
        "CLAUDE_MODEL": "claude-sonnet-4-5",
        "AGENT_MODE": "plan",
        "ALLOWED_TOOLS": '["Read"]',
    }
