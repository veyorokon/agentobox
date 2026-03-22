from __future__ import annotations

from agent.contracts.mode import AgentMode
from agent.contracts.transport import ManagedTransport
from agent.runtime.config import RuntimeConfig
from agent.transports.agentobox.client import AgentoboxTransportClient
from agent.transports.agentobox.config import AgentoboxTransportConfig
from agent.transports.agentobox.session import NullRelaySession, RelaySession
from agent.transports.disabled import DisabledTransport


def build_transport(config: RuntimeConfig, *, session: RelaySession | None = None) -> ManagedTransport:
    if config.mode is AgentMode.STANDALONE:
        return DisabledTransport()
    assert config.managed is not None
    return AgentoboxTransportClient(
        AgentoboxTransportConfig(
            agent_id=config.managed.agent_id,
            callback_url=config.managed.callback_url,
            relay_auth_token=config.managed.relay_auth_token,
        ),
        session=session or NullRelaySession(),
    )
