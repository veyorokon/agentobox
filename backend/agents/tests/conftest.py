"""Shared test fixtures for agents tests."""

import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load_fixture(name: str):
    """Load a JSON fixture file from the fixtures/ directory."""
    with open(FIXTURES_DIR / name) as f:
        return json.load(f)


def _events_by_type(events: list[dict]) -> dict[str, list[dict]]:
    """Group events by their 'type' field."""
    grouped: dict[str, list[dict]] = {}
    for ev in events:
        grouped.setdefault(ev["type"], []).append(ev)
    return grouped


# Real CC event fixtures — captured from Claude Code v2.1.59 stream-json output.
# These are sanitized (session IDs, UUIDs replaced) but structurally identical
# to actual CC output. Used for parity tests.
REAL_CC_FIXTURES = {
    "text_only": _load_fixture("cc_text_only.json"),
    "tool_use": _load_fixture("cc_tool_use.json"),
    "plan_mode": _load_fixture("cc_plan_mode.json"),
    "team_mode": _load_fixture("cc_team_mode.json"),
}

# Sample snapshot data keyed by agent type — used by contract tests
SAMPLE_SNAPSHOTS = {
    "claude-code": {
        "assistant_only": {
            "assistant": {
                "type": "assistant",
                "message": {
                    "id": "msg_01abc",
                    "content": [
                        {"type": "text", "text": "I'll fix the bug in the login flow."},
                        {
                            "type": "tool_use",
                            "id": "toolu_01xyz",
                            "name": "Edit",
                            "input": {"file_path": "/src/auth.py"},
                        },
                    ],
                },
            },
        },
        "with_result": {
            "assistant": {
                "type": "assistant",
                "message": {
                    "id": "msg_01abc",
                    "content": [
                        {"type": "text", "text": "Fixed the authentication bug."},
                    ],
                },
            },
            "result": {
                "type": "result",
                "duration_ms": 125000,
                "duration_api_ms": 80000,
                "num_turns": 7,
                "total_cost_usd": 0.045,
                "is_error": False,
                "session_id": "session_abc123",
            },
        },
        "empty": {},
        "none_values": {
            "assistant": None,
            "result": None,
        },
    },
}

# Sample full events for is_permission_request / is_plan_proposal
SAMPLE_EVENTS = {
    "claude-code": {
        "permission_request": {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "I need to run a command."},
                    {
                        "type": "tool_use",
                        "id": "toolu_perm_01",
                        "name": "Bash",
                        "input": {
                            "command": "rm -rf /tmp/old_cache",
                            "commandInput": "rm -rf /tmp/old_cache",
                            "risk": "Deletes files in /tmp",
                        },
                    },
                ],
            },
        },
        "plan_proposal": {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "## Plan\n\n1. Fix auth\n2. Add tests"},
                    {
                        "type": "tool_use",
                        "id": "toolu_plan_01",
                        "name": "ExitPlanMode",
                        "input": {},
                    },
                ],
            },
        },
        "normal_assistant": {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Here is the fix."},
                ],
            },
        },
    },
}


def _snapshot(last_text: str, tool_name: str = "", result: dict | None = None) -> dict:
    """Mirror of seed_dev_data._snapshot — kept in sync manually."""
    content = []
    if last_text:
        content.append({"type": "text", "text": last_text})
    if tool_name:
        content.append({
            "type": "tool_use",
            "id": f"toolu_{tool_name.lower()}",
            "name": tool_name,
            "input": {},
        })
    snap = {}
    if content:
        snap["assistant"] = {
            "type": "assistant",
            "message": {"content": content},
        }
    if result:
        snap["result"] = result
    return snap


# Seed agent expectations: snapshot + expected adapter outputs.
# Must stay in sync with seed_dev_data.py — if seed changes, update here.
SEED_AGENTS = [
    {
        "name": "team-lead",
        "snapshot": _snapshot(
            "Delegated auth fix to backend, waiting on QA...",
            result={"type": "result", "duration_ms": 725000, "num_turns": 14, "total_cost_usd": 0.18},
        ),
        "expected": {
            "last_output": "Delegated auth fix to backend, waiting on QA...",
            "live_action": "",       # result present → cleared
            "duration": "12m 05s",
            "turns": 14,
            "cost": 0.18,
        },
    },
    {
        "name": "backend",
        "snapshot": _snapshot("Applied fix to validateToken()...", tool_name="Edit"),
        "expected": {
            "last_output": "Applied fix to validateToken()...",
            "live_action": "Edit",
            "duration": "0s",
            "turns": 0,
            "cost": 0.0,
        },
    },
    {
        "name": "frontend",
        "snapshot": _snapshot("Scanning tailwind classes in Button...", tool_name="Read"),
        "expected": {
            "last_output": "Scanning tailwind classes in Button...",
            "live_action": "Read",
            "duration": "0s",
            "turns": 0,
            "cost": 0.0,
        },
    },
    {
        "name": "qa",
        "snapshot": _snapshot(
            "FAIL src/auth.test.ts\nExpected 200, received 401",
            tool_name="Bash",
        ),
        "expected": {
            "last_output": "FAIL src/auth.test.ts\nExpected 200, received 401",
            "live_action": "Bash",
            "duration": "0s",
            "turns": 0,
            "cost": 0.0,
        },
    },
    {
        "name": "devops",
        "snapshot": _snapshot(
            "Standing by...",
            result={"type": "result", "duration_ms": 300000, "num_turns": 1, "total_cost_usd": 0.03},
        ),
        "expected": {
            "last_output": "Standing by...",
            "live_action": "",
            "duration": "5m 00s",
            "turns": 1,
            "cost": 0.03,
        },
    },
    {
        "name": "docs",
        "snapshot": _snapshot(
            "Updated API reference section",
            result={"type": "result", "duration_ms": 90000, "num_turns": 2, "total_cost_usd": 0.02},
        ),
        "expected": {
            "last_output": "Updated API reference section",
            "live_action": "",
            "duration": "1m 30s",
            "turns": 2,
            "cost": 0.02,
        },
    },
    {
        "name": "infra",
        "snapshot": _snapshot("Initializing workspace..."),
        "expected": {
            "last_output": "Initializing workspace...",
            "live_action": "",       # no tool_use block
            "duration": "0s",
            "turns": 0,
            "cost": 0.0,
        },
    },
]


@pytest.fixture
def sample_snapshots():
    """Return sample snapshot data for all agent types."""
    return SAMPLE_SNAPSHOTS


@pytest.fixture
def sample_events():
    """Return sample event data for all agent types."""
    return SAMPLE_EVENTS
