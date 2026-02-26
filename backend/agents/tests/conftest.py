"""Shared test fixtures for agents tests."""

import pytest

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


@pytest.fixture
def sample_snapshots():
    """Return sample snapshot data for all agent types."""
    return SAMPLE_SNAPSHOTS


@pytest.fixture
def sample_events():
    """Return sample event data for all agent types."""
    return SAMPLE_EVENTS
