"""
Tests for feed_transform.py and stream.py pass-through logic.

Run: docker compose exec backend uv run python -m pytest tests/ -v
  or: cd backend && DJANGO_SETTINGS_MODULE=config.settings uv run python -m pytest tests/ -v
"""

import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

# Django setup
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import django

django.setup()

import pytest

from agents.graphql.types import FeedItemKind, ToolUseItemType
from agents.services.feed_transform import (
    _extract_memory_content,
    _extract_plan_steps,
    _extract_plan_summary,
    _is_claude_md,
    _result_as_text,
    messages_to_feed,
)
from agents.services.media import externalize_image_block
from agents.services.stream import _externalize_media as stream_externalize_media


# ── externalize_image_block (media.py) ──


class TestExternalizeImageBlock:
    @patch("agents.services.media.upload_base64_image", return_value="https://s3/media/test.png")
    def test_base64_image_returns_url(self, mock_upload):
        block = {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "iVBORw0KGgoAAAANSUhEUg==",
            },
        }
        result = externalize_image_block(block)
        assert result["source"]["type"] == "url"
        assert result["source"]["url"] == "https://s3/media/test.png"
        assert result["source"]["media_type"] == "image/png"
        mock_upload.assert_called_once_with("iVBORw0KGgoAAAANSUhEUg==", "image/png", "media")

    def test_non_image_block_unchanged(self):
        block = {"type": "text", "text": "Hello"}
        result = externalize_image_block(block)
        assert result is block

    def test_url_source_unchanged(self):
        block = {
            "type": "image",
            "source": {"type": "url", "url": "https://cdn.example.com/img.png"},
        }
        result = externalize_image_block(block)
        assert result is block

    def test_empty_data_unchanged(self):
        block = {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": ""},
        }
        result = externalize_image_block(block)
        assert result is block

    @patch("agents.services.media.upload_base64_image", side_effect=Exception("S3 down"))
    def test_upload_failure_returns_original(self, mock_upload):
        block = {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "iVBORw0KGgoAAAANSUhEUg==",
            },
        }
        result = externalize_image_block(block)
        # Fail open — returns original block with base64 intact
        assert result["source"]["type"] == "base64"
        assert result["source"]["data"] == "iVBORw0KGgoAAAANSUhEUg=="


# ── _externalize_media (stream.py) ──


class TestExternalizeMedia:
    def test_preserves_text_blocks(self):
        parts = [{"type": "text", "text": "Hello world"}]
        result = stream_externalize_media(parts)
        assert result == parts

    @patch("agents.services.stream.externalize_image_block")
    def test_processes_tool_result_content_blocks(self, mock_ext):
        mock_ext.side_effect = lambda block, prefix="media": (
            {**block, "source": {"type": "url", "url": "https://s3/img.png"}}
            if block.get("type") == "image"
            else block
        )
        parts = [
            {
                "type": "tool_result",
                "tool_use_id": "tu_1",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": "iVBORw0KGgoAAAANSUhEUg==",
                        },
                    }
                ],
            }
        ]
        result = stream_externalize_media(parts)
        img_block = result[0]["content"][0]
        assert img_block["source"]["type"] == "url"

    def test_preserves_image_blocks_with_url(self):
        parts = [
            {
                "type": "tool_result",
                "tool_use_id": "tu_1",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://cdn.example.com/img.png",
                        },
                    }
                ],
            }
        ]
        result = stream_externalize_media(parts)
        assert result[0]["content"][0]["source"]["url"] == "https://cdn.example.com/img.png"

    @patch("agents.services.stream.externalize_image_block")
    def test_processes_mixed_content_blocks(self, mock_ext):
        mock_ext.side_effect = lambda block, prefix="media": (
            {**block, "source": {"type": "url", "url": "https://s3/img.jpg"}}
            if block.get("type") == "image"
            else block
        )
        parts = [
            {
                "type": "tool_result",
                "tool_use_id": "tu_1",
                "content": [
                    {"type": "text", "text": "Screenshot taken"},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": "base64data",
                        },
                    },
                ],
            }
        ]
        result = stream_externalize_media(parts)
        assert len(result[0]["content"]) == 2
        assert result[0]["content"][0]["type"] == "text"
        assert result[0]["content"][1]["source"]["type"] == "url"

    def test_preserves_string_content(self):
        parts = [
            {
                "type": "tool_result",
                "tool_use_id": "tu_1",
                "content": "File read successfully",
            }
        ]
        result = stream_externalize_media(parts)
        assert result[0]["content"] == "File read successfully"

    def test_empty_list(self):
        assert stream_externalize_media([]) == []

    def test_no_content_blocks(self):
        parts = [{"type": "text", "text": "just text"}]
        result = stream_externalize_media(parts)
        assert result == parts

    @patch("agents.services.stream.externalize_image_block")
    def test_top_level_image_block(self, mock_ext):
        mock_ext.return_value = {
            "type": "image",
            "source": {"type": "url", "url": "https://s3/img.png"},
        }
        parts = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "abc123",
                },
            }
        ]
        result = stream_externalize_media(parts)
        assert result[0]["source"]["type"] == "url"
        mock_ext.assert_called_once()


# ── _result_as_text ──


class TestResultAsText:
    def test_string_input(self):
        assert _result_as_text("hello world") == "hello world"

    def test_empty_string(self):
        assert _result_as_text("") == ""

    def test_content_block_list_single_text(self):
        blocks = [{"type": "text", "text": "line one"}]
        assert _result_as_text(blocks) == "line one"

    def test_content_block_list_multiple_text(self):
        blocks = [
            {"type": "text", "text": "line one"},
            {"type": "text", "text": "line two"},
        ]
        assert _result_as_text(blocks) == "line one\nline two"

    def test_content_block_list_mixed(self):
        """Image blocks are skipped, only text extracted."""
        blocks = [
            {"type": "text", "text": "Screenshot taken"},
            {
                "type": "image",
                "source": {"type": "base64", "data": "abc123"},
            },
        ]
        assert _result_as_text(blocks) == "Screenshot taken"

    def test_content_block_list_images_only(self):
        """All image blocks → empty string."""
        blocks = [
            {"type": "image", "source": {"type": "base64", "data": "abc"}},
        ]
        assert _result_as_text(blocks) == ""

    def test_empty_list(self):
        assert _result_as_text([]) == ""

    def test_none_input(self):
        assert _result_as_text(None) == ""

    def test_integer_input(self):
        assert _result_as_text(42) == ""

    def test_content_block_missing_text_key(self):
        """Blocks with type=text but no text key → empty string contribution."""
        blocks = [{"type": "text"}]
        assert _result_as_text(blocks) == ""

    def test_non_dict_items_in_list(self):
        """Non-dict items in list are safely skipped."""
        blocks = ["not a dict", {"type": "text", "text": "valid"}]
        assert _result_as_text(blocks) == "valid"


# ── _is_claude_md ──


class TestIsClaudeMd:
    def test_exact_match(self):
        assert _is_claude_md("CLAUDE.MD") is True

    def test_lowercase(self):
        assert _is_claude_md("claude.md") is True

    def test_path_with_dir(self):
        assert _is_claude_md("/home/user/project/CLAUDE.md") is True

    def test_nested_path(self):
        assert _is_claude_md(".claude/CLAUDE.md") is True

    def test_not_claude_md(self):
        assert _is_claude_md("README.md") is False

    def test_empty_string(self):
        assert _is_claude_md("") is False

    def test_none_is_falsy(self):
        # _is_claude_md checks `if file_path`
        assert _is_claude_md("") is False


# ── _extract_memory_content ──


class TestExtractMemoryContent:
    def test_write_tool(self):
        tu_input = {"file_path": "CLAUDE.md", "content": "Remember this fact"}
        assert _extract_memory_content("Write", tu_input) == "Remember this fact"

    def test_edit_tool(self):
        tu_input = {
            "file_path": "CLAUDE.md",
            "old_string": "old",
            "new_string": "new fact",
        }
        assert _extract_memory_content("Edit", tu_input) == "new fact"

    def test_write_missing_content(self):
        assert _extract_memory_content("Write", {}) == ""

    def test_edit_missing_new_string(self):
        assert _extract_memory_content("Edit", {}) == ""


# ── _extract_plan_summary / _extract_plan_steps ──


class TestPlanExtraction:
    def test_summary_first_line(self):
        text = "# My Plan\n\nSome details here"
        assert _extract_plan_summary(text) == "My Plan"

    def test_summary_none(self):
        assert _extract_plan_summary(None) is None
        assert _extract_plan_summary("") is None

    def test_steps_numbered(self):
        text = "Plan:\n1. First step\n2. Second step\n3. Third step"
        steps = _extract_plan_steps(text)
        assert steps == ["First step", "Second step", "Third step"]

    def test_steps_bulleted(self):
        text = "Plan:\n- Step A\n- Step B"
        steps = _extract_plan_steps(text)
        assert steps == ["Step A", "Step B"]

    def test_steps_none(self):
        assert _extract_plan_steps(None) is None
        assert _extract_plan_steps("") is None

    def test_steps_no_bullets(self):
        text = "Just a paragraph with no steps."
        assert _extract_plan_steps(text) is None


# ── messages_to_feed end-to-end ──


def _make_mock_message(
    msg_id: int,
    role: str,
    parts: list[dict],
    agent_id: str = "agent-1",
    agent_name: str = "backend",
    created_at: datetime | None = None,
) -> MagicMock:
    """Create a mock Message object matching Django model shape."""
    msg = MagicMock()
    msg.id = msg_id
    msg.role = role
    msg.parts = parts
    msg.agent_id = agent_id
    msg.agent = MagicMock()
    msg.agent.name = agent_name
    msg.created_at = created_at or datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    return msg


class TestMessagesToFeed:
    """End-to-end tests for the complete feed transform pipeline."""

    def test_read_tool_passthrough(self):
        """Read tool: input/result pass through as-is."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Read",
                    "input": {"file_path": "src/main.py", "limit": 100},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "import os\nprint('hello')",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        assert len(activity) == 1

        tool = activity[0].tools[0]
        assert tool.name == "Read"
        assert tool.input == {"file_path": "src/main.py", "limit": 100}
        assert tool.result == "import os\nprint('hello')"
        assert tool.is_error is False

    def test_edit_tool_passthrough(self):
        """Edit tool: old_string/new_string in input, success message in result."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Edit",
                    "input": {
                        "file_path": "src/app.py",
                        "old_string": "def foo():",
                        "new_string": "def bar():",
                    },
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "The file was edited successfully.",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        tool = activity[0].tools[0]
        assert tool.name == "Edit"
        assert tool.input["old_string"] == "def foo():"
        assert tool.input["new_string"] == "def bar():"
        assert tool.result == "The file was edited successfully."

    def test_bash_tool_with_error(self):
        """Bash tool: command in input, error output in result."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Bash",
                    "input": {"command": "npm test"},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "Error: test suite failed",
                    "is_error": True,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert tool.name == "Bash"
        assert tool.input["command"] == "npm test"
        assert tool.is_error is True

    def test_screenshot_tool_with_image_content_blocks(self):
        """Screenshot tool: result contains image content blocks."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "mcp__playwright__browser_take_screenshot",
                    "input": {"type": "png"},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": "iVBORw0KGgoAAAANS==",
                            },
                        }
                    ],
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert tool.name == "mcp__playwright__browser_take_screenshot"
        # Result should be the content block array, not flattened to string
        assert isinstance(tool.result, list)
        assert tool.result[0]["type"] == "image"
        assert tool.result[0]["source"]["data"] == "iVBORw0KGgoAAAANS=="

    def test_screenshot_tool_with_url_content_blocks(self):
        """Screenshot with URL source (after Phase 3 externalization)."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "mcp__playwright__browser_take_screenshot",
                    "input": {"type": "png"},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "url",
                                "url": "https://cdn.example.com/screenshots/abc.png",
                            },
                        }
                    ],
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert tool.result[0]["source"]["url"] == "https://cdn.example.com/screenshots/abc.png"

    def test_mixed_text_and_image_result(self):
        """Tool result with both text and image blocks — both preserved."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "mcp__playwright__browser_take_screenshot",
                    "input": {"type": "png"},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": [
                        {"type": "text", "text": "Screenshot captured"},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": "abc123",
                            },
                        },
                    ],
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert len(tool.result) == 2
        assert tool.result[0]["type"] == "text"
        assert tool.result[1]["type"] == "image"

    def test_mcp_tool_becomes_activity(self):
        """Any non-special MCP tool should become ACTIVITY."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "mcp__custom__do_something",
                    "input": {"arg": "value"},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "done",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        assert len(activity) == 1
        assert activity[0].tools[0].name == "mcp__custom__do_something"

    def test_question_tool_classification(self):
        """AskUserQuestion → QUESTION kind, not ACTIVITY."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "AskUserQuestion",
                    "input": {
                        "questions": [
                            {
                                "question": "Which DB?",
                                "header": "Database",
                                "options": [
                                    {"label": "PostgreSQL", "description": "Relational"},
                                    {"label": "MongoDB", "description": "Document"},
                                ],
                                "multiSelect": False,
                            }
                        ]
                    },
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "PostgreSQL",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        questions = [i for i in items if i.kind == FeedItemKind.QUESTION]
        assert len(questions) == 1
        assert questions[0].questions[0].question == "Which DB?"
        # Should have matched the answer
        assert questions[0].answers is not None
        assert 0 in questions[0].answers[0].selected_indices

    def test_question_with_content_block_answer(self):
        """AskUserQuestion with content block list as answer."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "AskUserQuestion",
                    "input": {
                        "questions": [
                            {
                                "question": "Which approach?",
                                "header": "Approach",
                                "options": [
                                    {"label": "Option A", "description": "First"},
                                    {"label": "Option B", "description": "Second"},
                                ],
                                "multiSelect": False,
                            }
                        ]
                    },
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": [{"type": "text", "text": "Option A"}],
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        questions = [i for i in items if i.kind == FeedItemKind.QUESTION]
        assert len(questions) == 1
        assert questions[0].answers is not None
        assert 0 in questions[0].answers[0].selected_indices

    def test_memory_detection(self):
        """Edit targeting CLAUDE.md → MEMORY kind."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Edit",
                    "input": {
                        "file_path": "/project/CLAUDE.md",
                        "old_string": "",
                        "new_string": "New memory fact",
                    },
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "ok",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        memory = [i for i in items if i.kind == FeedItemKind.MEMORY]
        assert len(memory) == 1
        assert memory[0].memory_content == "New memory fact"

    def test_multiple_tools_grouped(self):
        """Multiple tool_use in one message → grouped into single ACTIVITY."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Read",
                    "input": {"file_path": "a.py"},
                },
                {
                    "type": "tool_use",
                    "id": "tu_2",
                    "name": "Grep",
                    "input": {"pattern": "TODO"},
                },
                {
                    "type": "tool_use",
                    "id": "tu_3",
                    "name": "Bash",
                    "input": {"command": "ls"},
                },
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {"type": "tool_result", "tool_use_id": "tu_1", "content": "file contents"},
                {"type": "tool_result", "tool_use_id": "tu_2", "content": "match1\nmatch2"},
                {"type": "tool_result", "tool_use_id": "tu_3", "content": "file1 file2"},
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        assert len(activity) == 1
        assert len(activity[0].tools) == 3
        assert activity[0].tools[0].name == "Read"
        assert activity[0].tools[1].name == "Grep"
        assert activity[0].tools[2].name == "Bash"

    def test_text_message_emitted(self):
        """Assistant text → AGENT_TEXT kind."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [{"type": "text", "text": "I'll help you with that."}],
        )

        items = messages_to_feed([assistant_msg], [], [])
        texts = [i for i in items if i.kind == FeedItemKind.AGENT_TEXT]
        assert len(texts) == 1
        assert texts[0].text == "I'll help you with that."

    def test_plan_tool_classification(self):
        """EnterPlanMode → PLAN kind."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {"type": "text", "text": "# Plan\n1. Step one\n2. Step two"},
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "EnterPlanMode",
                    "input": {},
                },
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "Plan mode entered",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        plans = [i for i in items if i.kind == FeedItemKind.PLAN]
        assert len(plans) == 1
        assert plans[0].plan_status == "content"
        # Text should NOT be emitted separately when plan tool present
        texts = [i for i in items if i.kind == FeedItemKind.AGENT_TEXT]
        assert len(texts) == 0

    def test_task_create_and_update(self):
        """TaskCreate → TASK_START, TaskUpdate(completed) → TASK_END."""
        ts1 = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 1, 15, 12, 5, 0, tzinfo=timezone.utc)

        msg1 = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_create",
                    "name": "TaskCreate",
                    "input": {"subject": "Fix auth", "activeForm": "Fixing auth"},
                }
            ],
            created_at=ts1,
        )
        msg1_result = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_create",
                    "content": '{"id": "task_1"}',
                    "is_error": False,
                }
            ],
            created_at=ts1,
        )
        msg2 = _make_mock_message(
            3,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_update",
                    "name": "TaskUpdate",
                    "input": {"taskId": "tu_create", "status": "completed"},
                }
            ],
            created_at=ts2,
        )
        msg2_result = _make_mock_message(
            4,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_update",
                    "content": "ok",
                    "is_error": False,
                }
            ],
            created_at=ts2,
        )

        items = messages_to_feed(
            [msg1_result, msg1, msg2_result, msg2], [], []
        )
        starts = [i for i in items if i.kind == FeedItemKind.TASK_START]
        ends = [i for i in items if i.kind == FeedItemKind.TASK_END]
        assert len(starts) == 1
        assert starts[0].task_divider_subject == "Fix auth"
        assert len(ends) == 1
        assert ends[0].task_divider_subject == "Fix auth"

    def test_missing_tool_result(self):
        """Tool with no matching result → empty string result, is_error=False."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_orphan",
                    "name": "Read",
                    "input": {"file_path": "missing.py"},
                }
            ],
        )

        items = messages_to_feed([assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert tool.result == ""
        assert tool.is_error is False

    def test_glob_tool_passthrough(self):
        """Glob tool with pattern in input."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Glob",
                    "input": {"pattern": "**/*.py"},
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "src/main.py\nsrc/utils.py\ntests/test_main.py",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert tool.name == "Glob"
        assert tool.input["pattern"] == "**/*.py"
        assert "src/main.py" in tool.result

    def test_consecutive_activities_merged(self):
        """Separate assistant messages with one tool each → merged into single ACTIVITY."""
        ts1 = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 1, 15, 12, 0, 1, tzinfo=timezone.utc)
        ts3 = datetime(2026, 1, 15, 12, 0, 2, tzinfo=timezone.utc)

        msg1 = _make_mock_message(
            1, "assistant",
            [{"type": "tool_use", "id": "tu_1", "name": "mcp__computer__left_click", "input": {"coordinate": [703, 800]}}],
            created_at=ts1,
        )
        msg1r = _make_mock_message(
            2, "user",
            [{"type": "tool_result", "tool_use_id": "tu_1", "content": "ok"}],
            created_at=ts1,
        )
        msg2 = _make_mock_message(
            3, "assistant",
            [{"type": "tool_use", "id": "tu_2", "name": "Bash", "input": {"command": "sleep 2"}}],
            created_at=ts2,
        )
        msg2r = _make_mock_message(
            4, "user",
            [{"type": "tool_result", "tool_use_id": "tu_2", "content": ""}],
            created_at=ts2,
        )
        msg3 = _make_mock_message(
            5, "assistant",
            [{"type": "tool_use", "id": "tu_3", "name": "mcp__computer__get_screenshot", "input": {}}],
            created_at=ts3,
        )
        msg3r = _make_mock_message(
            6, "user",
            [{"type": "tool_result", "tool_use_id": "tu_3", "content": [{"type": "image", "source": {"type": "url", "url": "https://example.com/img.png"}}]}],
            created_at=ts3,
        )

        items = messages_to_feed([msg1, msg1r, msg2, msg2r, msg3, msg3r], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        assert len(activity) == 1
        assert len(activity[0].tools) == 3
        assert activity[0].tools[0].name == "mcp__computer__left_click"
        assert activity[0].tools[1].name == "Bash"
        assert activity[0].tools[2].name == "mcp__computer__get_screenshot"

    def test_activities_not_merged_across_agents(self):
        """ACTIVITY items from different agents stay separate."""
        ts1 = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 1, 15, 12, 0, 1, tzinfo=timezone.utc)

        msg1 = _make_mock_message(
            1, "assistant",
            [{"type": "tool_use", "id": "tu_1", "name": "Read", "input": {"file_path": "a.py"}}],
            agent_id="agent-1", agent_name="backend", created_at=ts1,
        )
        msg1r = _make_mock_message(
            2, "user",
            [{"type": "tool_result", "tool_use_id": "tu_1", "content": "ok"}],
            agent_id="agent-1", created_at=ts1,
        )
        msg2 = _make_mock_message(
            3, "assistant",
            [{"type": "tool_use", "id": "tu_2", "name": "Read", "input": {"file_path": "b.py"}}],
            agent_id="agent-2", agent_name="frontend", created_at=ts2,
        )
        msg2r = _make_mock_message(
            4, "user",
            [{"type": "tool_result", "tool_use_id": "tu_2", "content": "ok"}],
            agent_id="agent-2", created_at=ts2,
        )

        items = messages_to_feed([msg1, msg1r, msg2, msg2r], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        assert len(activity) == 2
        assert activity[0].agent_id == "agent-1"
        assert activity[1].agent_id == "agent-2"

    def test_activities_not_merged_across_agent_text(self):
        """AGENT_TEXT between activities from same agent breaks the merge."""
        ts1 = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 1, 15, 12, 0, 1, tzinfo=timezone.utc)

        msg1 = _make_mock_message(
            1, "assistant",
            [{"type": "tool_use", "id": "tu_1", "name": "Read", "input": {"file_path": "a.py"}}],
            created_at=ts1,
        )
        msg1r = _make_mock_message(
            2, "user",
            [{"type": "tool_result", "tool_use_id": "tu_1", "content": "ok"}],
            created_at=ts1,
        )
        msg2 = _make_mock_message(
            3, "assistant",
            [
                {"type": "text", "text": "I found the issue."},
                {"type": "tool_use", "id": "tu_2", "name": "Edit", "input": {"file_path": "a.py", "old_string": "x", "new_string": "y"}},
            ],
            created_at=ts2,
        )
        msg2r = _make_mock_message(
            4, "user",
            [{"type": "tool_result", "tool_use_id": "tu_2", "content": "ok"}],
            created_at=ts2,
        )

        items = messages_to_feed([msg1, msg1r, msg2, msg2r], [], [])
        activity = [i for i in items if i.kind == FeedItemKind.ACTIVITY]
        assert len(activity) == 2  # Text breaks the merge

    def test_write_tool_passthrough(self):
        """Write tool: content in input."""
        assistant_msg = _make_mock_message(
            1,
            "assistant",
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "Write",
                    "input": {
                        "file_path": "new_file.py",
                        "content": "print('hello')\n",
                    },
                }
            ],
        )
        user_msg = _make_mock_message(
            2,
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "The file was written successfully.",
                    "is_error": False,
                }
            ],
        )

        items = messages_to_feed([user_msg, assistant_msg], [], [])
        tool = [i for i in items if i.kind == FeedItemKind.ACTIVITY][0].tools[0]
        assert tool.name == "Write"
        assert tool.input["content"] == "print('hello')\n"
        assert tool.input["file_path"] == "new_file.py"


# ── ToolUseItemType construction ──


class TestToolUseItemType:
    def test_basic_construction(self):
        item = ToolUseItemType(
            name="Read",
            input={"file_path": "test.py"},
            result="file contents",
            is_error=False,
        )
        assert item.name == "Read"
        assert item.input == {"file_path": "test.py"}
        assert item.result == "file contents"
        assert item.is_error is False

    def test_with_content_block_result(self):
        item = ToolUseItemType(
            name="mcp__playwright__browser_take_screenshot",
            input={"type": "png"},
            result=[
                {
                    "type": "image",
                    "source": {"type": "url", "url": "https://cdn.example.com/img.png"},
                }
            ],
        )
        assert isinstance(item.result, list)
        assert item.result[0]["source"]["url"] == "https://cdn.example.com/img.png"

    def test_default_is_error(self):
        item = ToolUseItemType(name="Read", input={}, result="")
        assert item.is_error is False


# ── Status collapse ──


def _make_mock_event(
    event_id: int,
    event_type: str,
    data: dict,
    agent_id: str = "agent-1",
    agent_name: str = "team-lead",
    created_at: datetime | None = None,
    summary: str | None = None,
) -> MagicMock:
    ev = MagicMock()
    ev.id = event_id
    ev.event_type = event_type
    ev.data = data
    ev.agent_id = agent_id
    ev.agent = MagicMock()
    ev.agent.name = agent_name
    ev.created_at = created_at or datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    ev.summary = summary
    return ev


class TestStatusCollapse:
    """Consecutive STATUS/SYSTEM items from same agent collapse to last."""

    def test_running_idle_suppressed(self):
        """running/idle statuses are filtered out — only actionable statuses survive."""
        ts = [datetime(2026, 1, 15, 12, 0, i, tzinfo=timezone.utc) for i in range(3)]
        events = [
            _make_mock_event(1, "status", {"from": "idle", "to": "running"}, created_at=ts[0]),
            _make_mock_event(2, "status", {"from": "running", "to": "idle"}, created_at=ts[1]),
            _make_mock_event(3, "status", {"from": "idle", "to": "deploying"}, created_at=ts[2]),
        ]
        items = messages_to_feed([], events, [])
        # running and idle suppressed, only deploying survives
        assert len(items) == 1
        assert items[0].kind == FeedItemKind.STATUS
        assert items[0].to_status == "deploying"

    def test_consecutive_statuses_collapsed(self):
        ts = [datetime(2026, 1, 15, 12, 0, i, tzinfo=timezone.utc) for i in range(5)]
        events = [
            _make_mock_event(1, "status", {"from": "idle", "to": "deploying"}, created_at=ts[0]),
            _make_mock_event(2, "system", {}, summary="team-lead restarted", created_at=ts[1]),
            _make_mock_event(3, "status", {"from": "deploying", "to": "deploying"}, created_at=ts[2]),
            _make_mock_event(4, "system", {}, summary="team-lead restarted again", created_at=ts[3]),
            _make_mock_event(5, "status", {"from": "deploying", "to": "stopped"}, created_at=ts[4]),
        ]
        items = messages_to_feed([], events, [])
        # All consecutive STATUS/SYSTEM from same agent → only the last survives
        assert len(items) == 1
        assert items[0].kind == FeedItemKind.STATUS
        assert items[0].to_status == "stopped"

    def test_error_breaks_status_run(self):
        ts = [datetime(2026, 1, 15, 12, 0, i, tzinfo=timezone.utc) for i in range(4)]
        events = [
            _make_mock_event(1, "status", {"from": "idle", "to": "deploying"}, created_at=ts[0]),
            _make_mock_event(2, "error", {}, summary="failed to provision", created_at=ts[1]),
            _make_mock_event(3, "status", {"from": "error", "to": "deploying"}, created_at=ts[2]),
            _make_mock_event(4, "status", {"from": "deploying", "to": "stopped"}, created_at=ts[3]),
        ]
        items = messages_to_feed([], events, [])
        # STATUS(deploying) | ERROR(failed) breaks run | STATUS(deploying)+STATUS(stopped) → STATUS(stopped)
        assert len(items) == 3
        assert items[0].kind == FeedItemKind.STATUS  # first deploying
        assert items[1].kind == FeedItemKind.ERROR
        assert items[2].kind == FeedItemKind.STATUS
        assert items[2].to_status == "stopped"

    def test_different_agents_not_collapsed(self):
        ts = [datetime(2026, 1, 15, 12, 0, i, tzinfo=timezone.utc) for i in range(3)]
        events = [
            _make_mock_event(1, "status", {"from": "idle", "to": "deploying"}, agent_id="a1", agent_name="backend", created_at=ts[0]),
            _make_mock_event(2, "status", {"from": "idle", "to": "deploying"}, agent_id="a2", agent_name="frontend", created_at=ts[1]),
            _make_mock_event(3, "status", {"from": "deploying", "to": "stopped"}, agent_id="a1", agent_name="backend", created_at=ts[2]),
        ]
        items = messages_to_feed([], events, [])
        # All three survive — agent-2 breaks the run for agent-1
        assert len(items) == 3
