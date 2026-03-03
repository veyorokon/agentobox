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

# Real OpenCode event fixtures — captured from OpenCode v1.2.15 SSE/REST output.
# Sanitized (IDs replaced) but structurally identical to actual OC output.
REAL_OC_FIXTURES = {
    "text_only": _load_fixture("oc_text_only.json"),       # REST response (dict)
    "tool_use": _load_fixture("oc_tool_use.json"),         # REST response (dict)
    "permission": _load_fixture("oc_permission.json"),      # SSE events (list)
    "session_idle": _load_fixture("oc_session_idle.json"),  # SSE events (list)
    "sse_stream": _load_fixture("oc_sse_stream.json"),      # Full SSE stream (list)
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

# OpenCode sample snapshots — mirrors the OC adapter's expected snapshot structure.
# OpenCode snapshots use {message, parts, idle} instead of CC's {assistant, result}.
SAMPLE_SNAPSHOTS["opencode"] = {
    "assistant_only": {
        "message": {
            "role": "assistant",
            "time": {"created": 1772565724233},
            "cost": 0,
            "tokens": {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}},
            "id": "msg_test_001",
            "sessionID": "ses_test_001",
        },
        "parts": [
            {"type": "step-start", "id": "prt_001"},
            {"type": "text", "text": "I'll fix the bug in the login flow.", "id": "prt_002"},
            {
                "type": "tool",
                "tool": "edit",
                "callID": "tooluse_001",
                "state": {"status": "running", "input": {"filePath": "/src/auth.py"}},
                "id": "prt_003",
            },
        ],
    },
    "with_idle": {
        "message": {
            "role": "assistant",
            "time": {"created": 1772565724233, "completed": 1772565849233},
            "cost": 0.045,
            "tokens": {"total": 21006, "input": 3, "output": 5, "reasoning": 0, "cache": {"read": 0, "write": 20998}},
            "finish": "stop",
            "id": "msg_test_002",
            "sessionID": "ses_test_002",
        },
        "parts": [
            {"type": "step-start", "id": "prt_010"},
            {"type": "text", "text": "Fixed the authentication bug.", "id": "prt_011"},
            {"type": "step-finish", "cost": 0.045, "tokens": {"total": 21006}, "id": "prt_012"},
        ],
        "idle": {"type": "session.idle", "properties": {"sessionID": "ses_test_002"}},
    },
    "empty": {},
    "none_values": {
        "message": None,
        "parts": None,
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
    "opencode": {
        "permission_request": {
            "type": "permission.asked",
            "properties": {
                "id": "per_test_perm_01",
                "sessionID": "ses_test_001",
                "permission": "edit",
                "patterns": ["test.txt"],
                "metadata": {
                    "filepath": "/home/agent/workspace/test.txt",
                    "diff": "Index: test.txt\n+testing permissions",
                },
                "always": ["*"],
                "tool": {
                    "messageID": "msg_test_001",
                    "callID": "tooluse_test_001",
                },
            },
        },
        "plan_proposal": {
            # OpenCode does not have plan proposals — this event is a normal
            # message that should return None from is_plan_proposal.
            "type": "message.updated",
            "properties": {
                "info": {
                    "role": "assistant",
                    "id": "msg_test_001",
                    "sessionID": "ses_test_001",
                },
            },
        },
        "normal_assistant": {
            "type": "message.updated",
            "properties": {
                "info": {
                    "role": "assistant",
                    "id": "msg_test_001",
                    "sessionID": "ses_test_001",
                },
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
