from __future__ import annotations

import json

from agent.contracts.events import RuntimeEvent
from agent.runtime.logging import configure_logging_context, emit_event


def test_emit_event_writes_json(capsys):
    configure_logging_context(mode="standalone", platform="local", profile="core", agent_id="agent-xyz")
    emit_event(RuntimeEvent.RUNTIME_READY.value, answer=42)
    err = capsys.readouterr().err.strip()
    payload = json.loads(err)
    assert payload["event"] == "runtime.ready"
    assert payload["answer"] == 42
    assert payload["service.name"] == "agentobox-agent"
    assert payload["mode"] == "standalone"
    assert payload["platform"] == "local"
    assert payload["profile"] == "core"
    assert payload["agent_id"] == "agent-xyz"
