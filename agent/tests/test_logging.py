from __future__ import annotations

import json
from pathlib import Path

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


def test_emit_event_writes_volume_runtime_log(capsys, tmp_path: Path):
    configure_logging_context(
        mode="managed",
        platform="docker",
        profile="desktop",
        agent_id="agent-xyz",
        root_dir=tmp_path,
    )

    emit_event(RuntimeEvent.RUNTIME_READY.value, answer=42)

    err = capsys.readouterr().err.strip()
    payload = json.loads(err)
    assert payload["event"] == "runtime.ready"

    log_path = tmp_path / "_abox" / "logs" / "runtime.jsonl"
    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    persisted = json.loads(lines[0])
    assert persisted["event"] == "runtime.ready"
    assert persisted["agent_id"] == "agent-xyz"
