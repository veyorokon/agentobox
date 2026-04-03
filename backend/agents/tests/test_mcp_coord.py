"""Contract tests for MCP coordination tools — CC native schema parity.

Verifies that our MCP tools match Claude Code's native team tool schemas
(SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList) in parameter names
and return shapes.

Tests call the tool functions directly with mocked auth to avoid needing
a full MCP server roundtrip.

NOTE: mcp_coord.py uses lazy imports inside functions (to avoid circular
imports), so we patch at the source module (agents.models) not at the
consumer (agents.services.mcp_coord).
"""

import inspect
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gda_kernel import agent_ref

pytestmark = pytest.mark.unit

from agents.services.mcp_coord import (
    send_message,
    task_create,
    task_get,
    task_list,
    task_update,
)


# ---------------------------------------------------------------------------
# Schema parity — parameter names match CC native tools
# ---------------------------------------------------------------------------


class TestSchemaParity:
    """Verify our tool parameter names match Claude Code's native schemas."""

    def test_send_message_params(self):
        """send_message has CC SendMessage params: type, content, recipient, summary."""
        sig = inspect.signature(send_message)
        params = set(sig.parameters.keys())
        assert params == {"type", "content", "recipient", "summary"}

    def test_task_create_params(self):
        """task_create has CC TaskCreate params: title, description, active_form, metadata."""
        sig = inspect.signature(task_create)
        params = set(sig.parameters.keys())
        assert params == {"title", "description", "active_form", "metadata"}

    def test_task_update_params(self):
        """task_update has CC TaskUpdate params."""
        sig = inspect.signature(task_update)
        params = set(sig.parameters.keys())
        expected = {
            "task_id", "status", "title", "description", "assignee",
            "active_form", "add_blocks", "add_blocked_by", "metadata",
        }
        assert params == expected

    def test_task_get_params(self):
        """task_get has CC TaskGet param: task_id."""
        sig = inspect.signature(task_get)
        params = set(sig.parameters.keys())
        assert params == {"task_id"}

    def test_task_list_params(self):
        """task_list has no params (CC TaskList has none)."""
        sig = inspect.signature(task_list)
        params = set(sig.parameters.keys())
        assert params == set()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_agent(**overrides):
    """Create a mock Agent object."""
    agent = MagicMock()
    agent.id = overrides.get("id", "agent-uuid-1")
    agent.name = overrides.get("name", "backend")
    agent.project_id = overrides.get("project_id", "project-uuid-1")
    agent.runtime = overrides.get("runtime", "docker")
    agent.model = overrides.get("model", "claude-opus-4-6")
    agent.workspace_path = overrides.get("workspace_path", "/workspace")
    agent.volume_mounts = overrides.get("volume_mounts", [])
    agent.session_id = overrides.get("session_id", "session-1")
    agent.session_cost_usd = overrides.get("session_cost_usd", 0)
    agent.role = overrides.get("role", "worker")
    agent.status = overrides.get("status", "running")
    return agent


def _patch_auth(agent):
    """Return a patch context for _authenticate that returns the given agent."""
    return patch("agents.services.mcp_coord._authenticate", new_callable=AsyncMock, return_value=agent)


# Patch paths: lazy imports inside functions → patch at source module
_P_AGENT = "agents.models.Agent"
_P_AGENT_STATUS = "agents.models.AgentStatus"
_P_AGENT_TASK = "agents.models.AgentTask"
_P_DELIVER = "agents.services.interagent.deliver_to_stdin"
_P_BROADCAST = "agents.services.interagent.deliver_broadcast"
_P_FEED_CREATE = "agents.services.feed.create_feed_item"
_P_AGENT_BROADCAST = "agents.services.broadcast.broadcast_agent_update"
_P_KILL_AGENT = "agents.services.lifecycle.kill_agent"


# ---------------------------------------------------------------------------
# send_message tests
# ---------------------------------------------------------------------------


class TestSendMessage:
    """Principle: message delivery must reach the target relay or fail visibly.

    send_message resolves the recipient by name within the sender's project,
    formats the payload for the agent's protocol, and pushes it to the relay
    channel group. Delivery failures surface as exceptions, never silent drops.
    """

    @pytest.mark.asyncio
    async def test_dm_delivery(self):
        """type='message' delivers to named recipient."""
        sender = _mock_agent(name="meta-agent")
        target = _mock_agent(name="backend")

        with (
            _patch_auth(sender),
            patch(_P_AGENT) as MockAgent,
            patch(_P_DELIVER, new_callable=AsyncMock) as mock_deliver,
            patch(_P_FEED_CREATE, new_callable=AsyncMock),
        ):
            MockAgent.objects.aget = AsyncMock(return_value=target)

            result = await send_message(
                type="message",
                content="fix the auth bug",
                recipient="backend",
                summary="auth bug fix request",
            )

        assert result["ok"] is True
        assert result["recipient"] == "backend"
        assert result["recipient_ref"] == agent_ref(target.id)
        mock_deliver.assert_called_once_with(
            "meta-agent", target, "fix the auth bug", sender_ref=agent_ref(sender.id)
        )
        MockAgent.objects.aget.assert_awaited_once_with(
            project_id=sender.project_id,
            name="backend",
        )

    @pytest.mark.asyncio
    async def test_dm_delivery_by_agent_ref(self):
        """recipient may be an agent ref while routing remains canonical by id."""
        sender = _mock_agent(name="meta-agent")
        target = _mock_agent(id="agent-uuid-2", name="backend")

        with (
            _patch_auth(sender),
            patch(_P_AGENT) as MockAgent,
            patch(_P_DELIVER, new_callable=AsyncMock) as mock_deliver,
            patch(_P_FEED_CREATE, new_callable=AsyncMock),
        ):
            MockAgent.objects.aget = AsyncMock(return_value=target)

            result = await send_message(
                type="message",
                content="fix the auth bug",
                recipient=agent_ref(target.id),
                summary="auth bug fix request",
            )

        assert result["ok"] is True
        assert result["recipient"] == "backend"
        assert result["recipient_ref"] == agent_ref(target.id)
        mock_deliver.assert_called_once_with(
            "meta-agent", target, "fix the auth bug", sender_ref=agent_ref(sender.id)
        )
        MockAgent.objects.aget.assert_awaited_once_with(
            project_id=sender.project_id,
            id=target.id,
        )

    @pytest.mark.asyncio
    async def test_dm_missing_recipient_errors(self):
        """type='message' without recipient raises ToolError."""
        sender = _mock_agent()
        with _patch_auth(sender):
            from fastmcp.exceptions import ToolError
            with pytest.raises(ToolError, match="recipient is required"):
                await send_message(type="message", content="hello")

    @pytest.mark.asyncio
    async def test_broadcast(self):
        """type='broadcast' calls deliver_broadcast."""
        sender = _mock_agent()

        with (
            _patch_auth(sender),
            patch(_P_BROADCAST, new_callable=AsyncMock) as mock_broadcast,
            patch(_P_FEED_CREATE, new_callable=AsyncMock),
        ):
            result = await send_message(
                type="broadcast",
                content="standup time",
                summary="daily standup",
            )

        assert result["ok"] is True
        mock_broadcast.assert_called_once_with(sender, "standup time", summary="daily standup")

    @pytest.mark.asyncio
    async def test_shutdown_request(self):
        """type='shutdown_request' calls kill_agent to terminate the container."""
        sender = _mock_agent(name="meta-agent")
        target = _mock_agent(name="qa")

        with (
            _patch_auth(sender),
            patch(_P_AGENT) as MockAgent,
            patch(_P_KILL_AGENT, new_callable=AsyncMock) as mock_kill,
        ):
            MockAgent.objects.aget = AsyncMock(return_value=target)

            result = await send_message(
                type="shutdown_request",
                recipient="qa",
                content="task complete",
            )

        assert result["ok"] is True
        assert result["recipient_ref"] == agent_ref(target.id)
        mock_kill.assert_called_once_with(str(target.id))

    @pytest.mark.asyncio
    async def test_shutdown_request_by_agent_ref(self):
        """shutdown_request accepts an agent ref and resolves target by id."""
        sender = _mock_agent(name="meta-agent")
        target = _mock_agent(id="agent-uuid-7", name="qa")

        with (
            _patch_auth(sender),
            patch(_P_AGENT) as MockAgent,
            patch(_P_KILL_AGENT, new_callable=AsyncMock) as mock_kill,
        ):
            MockAgent.objects.aget = AsyncMock(return_value=target)

            result = await send_message(
                type="shutdown_request",
                recipient=agent_ref(target.id),
                content="task complete",
            )

        assert result["ok"] is True
        assert result["recipient"] == "qa"
        assert result["recipient_ref"] == agent_ref(target.id)
        mock_kill.assert_called_once_with(str(target.id))
        MockAgent.objects.aget.assert_awaited_once_with(
            project_id=sender.project_id,
            id=target.id,
        )

    @pytest.mark.asyncio
    async def test_invalid_type_errors(self):
        """Invalid message type raises ToolError."""
        sender = _mock_agent()
        with _patch_auth(sender):
            from fastmcp.exceptions import ToolError
            with pytest.raises(ToolError, match="Invalid message type"):
                await send_message(type="invalid_type", content="hello")


# ---------------------------------------------------------------------------
# task_create tests
# ---------------------------------------------------------------------------


class TestTaskCreate:
    """Principle: task creation is atomic — DB row + feed item + broadcast.

    A created task must be immediately visible in the dashboard. The MCP tool
    returns the task dict on success and surfaces errors on failure.
    """

    @pytest.mark.asyncio
    async def test_basic_create(self):
        """Creates task and returns task_id + title."""
        agent = _mock_agent()
        mock_task = MagicMock()
        mock_task.task_id = "mcp_abc123"
        mock_task.title = "Fix the bug"

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
            patch(_P_FEED_CREATE, new_callable=AsyncMock),
            patch(_P_AGENT_BROADCAST, new_callable=AsyncMock),
        ):
            MockTask.objects.acreate = AsyncMock(return_value=mock_task)

            result = await task_create(title="Fix the bug", description="Details here")

        assert result["task_id"] == "mcp_abc123"
        assert result["title"] == "Fix the bug"

    @pytest.mark.asyncio
    async def test_create_with_active_form_and_metadata(self):
        """active_form and metadata are passed through."""
        agent = _mock_agent()
        mock_task = MagicMock()
        mock_task.task_id = "mcp_def456"
        mock_task.title = "Run tests"

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
            patch(_P_FEED_CREATE, new_callable=AsyncMock),
            patch(_P_AGENT_BROADCAST, new_callable=AsyncMock),
        ):
            MockTask.objects.acreate = AsyncMock(return_value=mock_task)

            await task_create(
                title="Run tests",
                active_form="Running tests",
                metadata={"priority": "high"},
            )

        call_kwargs = MockTask.objects.acreate.call_args[1]
        assert call_kwargs["active_form"] == "Running tests"
        assert call_kwargs["metadata"] == {"priority": "high"}


# ---------------------------------------------------------------------------
# task_update tests
# ---------------------------------------------------------------------------


class TestTaskUpdate:
    """Principle: task updates are idempotent and broadcast-complete.

    Every field update (status, assignee, dependencies) persists to DB and
    triggers a broadcast so the dashboard reflects the change. Deleting
    a task sets status=deleted and removes it from active views.
    """

    def _make_task(self, **overrides):
        """Create a mock task with sensible defaults."""
        task = MagicMock()
        task.task_id = overrides.get("task_id", "mcp_001")
        task.status = overrides.get("status", "pending")
        task.blocks = overrides.get("blocks", [])
        task.blocked_by = overrides.get("blocked_by", [])
        task.metadata = overrides.get("metadata", {})
        task.asave = AsyncMock()
        task.adelete = AsyncMock()
        return task

    @pytest.mark.asyncio
    async def test_status_update(self):
        """Updates status field."""
        agent = _mock_agent()
        mock_task = self._make_task()

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
            patch(_P_FEED_CREATE, new_callable=AsyncMock),
            patch(_P_AGENT_BROADCAST, new_callable=AsyncMock),
        ):
            MockTask.objects.aget = AsyncMock(return_value=mock_task)
            MockTask.DoesNotExist = Exception

            result = await task_update(task_id="mcp_001", status="in_progress")

        assert result["ok"] is True
        assert mock_task.status == "in_progress"
        mock_task.asave.assert_called_once()

    @pytest.mark.asyncio
    async def test_owner_claim(self):
        """Sets assignee field."""
        agent = _mock_agent()
        mock_task = self._make_task()

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
            patch(_P_AGENT_BROADCAST, new_callable=AsyncMock),
        ):
            MockTask.objects.aget = AsyncMock(return_value=mock_task)
            MockTask.DoesNotExist = Exception

            result = await task_update(task_id="mcp_001", assignee="backend")

        assert result["ok"] is True
        assert mock_task.assignee == "backend"

    @pytest.mark.asyncio
    async def test_add_dependencies(self):
        """add_blocks and add_blocked_by append to existing lists."""
        agent = _mock_agent()
        mock_task = self._make_task(blocks=["mcp_001"])

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            MockTask.objects.aget = AsyncMock(return_value=mock_task)
            MockTask.DoesNotExist = Exception

            await task_update(
                task_id="mcp_002",
                add_blocks=["mcp_003"],
                add_blocked_by=["mcp_000"],
            )

        # blocks should contain both old and new (deduplicated)
        assert "mcp_001" in mock_task.blocks
        assert "mcp_003" in mock_task.blocks
        assert "mcp_000" in mock_task.blocked_by

    @pytest.mark.asyncio
    async def test_metadata_merge(self):
        """metadata keys are merged; null values delete keys."""
        agent = _mock_agent()
        mock_task = self._make_task(metadata={"priority": "high", "sprint": "w09"})

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            MockTask.objects.aget = AsyncMock(return_value=mock_task)
            MockTask.DoesNotExist = Exception

            await task_update(
                task_id="mcp_003",
                metadata={"sprint": None, "assignee": "frontend"},
            )

        # sprint deleted, assignee added, priority kept
        assert mock_task.metadata == {"priority": "high", "assignee": "frontend"}

    @pytest.mark.asyncio
    async def test_delete_status(self):
        """status='deleted' removes the task."""
        agent = _mock_agent()
        mock_task = self._make_task(task_id="mcp_004")

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            MockTask.objects.aget = AsyncMock(return_value=mock_task)
            MockTask.DoesNotExist = Exception

            result = await task_update(task_id="mcp_004", status="deleted")

        assert result["deleted"] is True
        mock_task.adelete.assert_called_once()

    @pytest.mark.asyncio
    async def test_not_found_errors(self):
        """Missing task raises ToolError."""
        agent = _mock_agent()
        from agents.models import AgentTask as RealAgentTask

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            MockTask.objects.aget = AsyncMock(side_effect=RealAgentTask.DoesNotExist)
            MockTask.DoesNotExist = RealAgentTask.DoesNotExist

            from fastmcp.exceptions import ToolError
            with pytest.raises(ToolError, match="not found"):
                await task_update(task_id="nonexistent", status="completed")


# ---------------------------------------------------------------------------
# task_get tests
# ---------------------------------------------------------------------------


class TestTaskGet:
    """Principle: task reads return the full task state including dependencies.

    task_get returns the complete task dict (title, description, status,
    assignee, blocks, blockedBy) so the agent has full context to act on it.
    """

    @pytest.mark.asyncio
    async def test_returns_full_task(self):
        """Returns all task fields including new ones."""
        agent = _mock_agent()
        mock_task = MagicMock()
        mock_task.task_id = "mcp_001"
        mock_task.title = "Fix bug"
        mock_task.description = "Details"
        mock_task.status = "in_progress"
        mock_task.assignee = "backend"
        mock_task.active_form = "Fixing bug"
        mock_task.metadata = {"priority": "high"}
        mock_task.blocks = ["mcp_002"]
        mock_task.blocked_by = []

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            MockTask.objects.aget = AsyncMock(return_value=mock_task)
            MockTask.DoesNotExist = Exception

            result = await task_get(task_id="mcp_001")

        assert result["task_id"] == "mcp_001"
        assert result["title"] == "Fix bug"
        assert result["description"] == "Details"
        assert result["status"] == "in_progress"
        assert result["assignee"] == "backend"
        assert result["active_form"] == "Fixing bug"
        assert result["metadata"] == {"priority": "high"}
        assert result["blocks"] == ["mcp_002"]
        assert result["blocked_by"] == []

    @pytest.mark.asyncio
    async def test_not_found_errors(self):
        """Missing task raises ToolError."""
        agent = _mock_agent()
        from agents.models import AgentTask as RealAgentTask

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            MockTask.objects.aget = AsyncMock(side_effect=RealAgentTask.DoesNotExist)
            MockTask.DoesNotExist = RealAgentTask.DoesNotExist

            from fastmcp.exceptions import ToolError
            with pytest.raises(ToolError, match="not found"):
                await task_get(task_id="nonexistent")


# ---------------------------------------------------------------------------
# task_list tests
# ---------------------------------------------------------------------------


class TestTaskList:
    """Principle: task list returns a summary view scoped to the project.

    Returns all non-deleted tasks with enough fields for triage (id, title,
    status, assignee, blockedBy) but not full descriptions — use task_get for that.
    """

    @pytest.mark.asyncio
    async def test_includes_new_fields(self):
        """task_list response includes active_form and blocked_by."""
        agent = _mock_agent()
        mock_task = MagicMock()
        mock_task.task_id = "mcp_001"
        mock_task.title = "Fix bug"
        mock_task.status = "pending"
        mock_task.assignee = ""
        mock_task.active_form = "Fixing bug"
        mock_task.blocked_by = ["mcp_000"]

        async def _fake_iter():
            yield mock_task

        with (
            _patch_auth(agent),
            patch(_P_AGENT_TASK) as MockTask,
        ):
            qs = MagicMock()
            qs.order_by.return_value = _fake_iter()
            MockTask.objects.filter.return_value = qs

            result = await task_list()

        assert len(result) == 1
        item = result[0]
        assert item["id"] == "mcp_001"
        assert item["active_form"] == "Fixing bug"
        assert item["blocked_by"] == ["mcp_000"]
