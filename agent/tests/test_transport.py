from __future__ import annotations

from agent.contracts.transport import TransportState
from agent.transports.agentobox.client import AgentoboxTransportClient, FatalTransportError
from agent.transports.agentobox.commands import ReloadCommand
from agent.transports.agentobox.config import AgentoboxTransportConfig
from agent.transports.agentobox.session import NullRelaySession


def test_agentobox_transport_degrades_on_connector_failure():
    def fail_connector(_config, _client, _session):
        raise RuntimeError("boom")

    client = AgentoboxTransportClient(
        AgentoboxTransportConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
        connector=fail_connector,
        session=NullRelaySession(),
    )
    client.start()
    thread = client._thread
    assert thread is not None
    thread.join(timeout=1)
    snapshot = client.snapshot()
    assert snapshot.state is TransportState.DEGRADED
    assert snapshot.connected is False
    assert snapshot.last_error == "boom"


def test_agentobox_transport_marks_connected_on_success():
    def ok_connector(_config, client, session):
        client.mark_connected()
        session.on_connected()
        client.wait_for_stop(timeout=0.2)

    client = AgentoboxTransportClient(
        AgentoboxTransportConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
        connector=ok_connector,
        session=NullRelaySession(),
    )
    client.start()
    thread = client._thread
    assert thread is not None
    thread.join(timeout=1)
    snapshot = client.snapshot()
    assert snapshot.state is TransportState.CONNECTED
    assert snapshot.connected is True
    assert snapshot.last_error == ""
    client.stop()


def test_agentobox_transport_marks_fatal_for_non_retryable_failure():
    def fatal_connector(_config, _client, _session):
        raise FatalTransportError("bad token")

    client = AgentoboxTransportClient(
        AgentoboxTransportConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
        connector=fatal_connector,
        session=NullRelaySession(),
    )
    client.start()
    thread = client._thread
    assert thread is not None
    thread.join(timeout=1)
    snapshot = client.snapshot()
    assert snapshot.state is TransportState.FATAL
    assert snapshot.connected is False
    assert snapshot.last_error == "bad token"


def test_agentobox_transport_builds_ws_url():
    config = AgentoboxTransportConfig(
        agent_id="agent-xyz",
        callback_url="https://api.example.com/base",
        relay_auth_token="token",
    )

    assert config.ws_url() == "wss://api.example.com/ws/relay/agent-xyz/"


def test_agentobox_transport_dispatches_commands_to_session():
    session = NullRelaySession()

    def command_connector(_config, client, relay_session):
        client.mark_connected()
        relay_session.on_connected()
        relay_session.on_command(ReloadCommand(path="_abox/inbox.jsonl"))
        relay_session.on_disconnected()

    client = AgentoboxTransportClient(
        AgentoboxTransportConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
        connector=command_connector,
        session=session,
    )
    client.start()
    thread = client._thread
    assert thread is not None
    thread.join(timeout=1)

    assert session.connected is False
    assert len(session.commands) == 1
    assert session.commands[0].to_dict() == {"type": "reload", "path": "_abox/inbox.jsonl"}
