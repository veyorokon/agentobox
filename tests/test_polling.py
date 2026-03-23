import httpx
import pytest

from tests.e2e.helpers.polling import AgentTerminalError, poll_agent_status, poll_until


def test_poll_until_retries_transient_exception_until_success():
    calls = {"count": 0}

    def fetch():
        calls["count"] += 1
        if calls["count"] == 1:
            raise httpx.ReadTimeout("timed out")
        return {"ok": True}

    result = poll_until(
        fetch,
        lambda value: bool(value.get("ok")),
        timeout_s=0.2,
        interval_s=0.01,
        description="eventual success",
        transient_exceptions=(httpx.TimeoutException,),
    )

    assert result == {"ok": True}
    assert calls["count"] == 2


def test_poll_agent_status_retries_transient_graphql_timeout():
    class FakeGQL:
        def __init__(self):
            self.calls = 0

        def query_agent(self, agent_id):
            self.calls += 1
            if self.calls == 1:
                raise httpx.ReadTimeout("timed out")
            return {"id": agent_id, "lifecycleStatus": "idle", "errorMessage": ""}

    gql = FakeGQL()
    agent = poll_agent_status(
        gql,
        "agent-1",
        target_statuses=["idle"],
        timeout_s=0.2,
        interval_s=0.01,
    )

    assert agent["lifecycleStatus"] == "idle"
    assert gql.calls == 2


def test_poll_agent_status_still_raises_terminal_error_immediately():
    class FakeGQL:
        def query_agent(self, agent_id):
            return {
                "id": agent_id,
                "lifecycleStatus": "error",
                "errorMessage": "boom",
            }

    with pytest.raises(AgentTerminalError):
        poll_agent_status(
            FakeGQL(),
            "agent-1",
            target_statuses=["idle"],
            timeout_s=0.2,
            interval_s=0.01,
        )
