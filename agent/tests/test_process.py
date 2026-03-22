from __future__ import annotations

import json
import sys

from agent.contracts.services import ServiceSpec
from agent.runtime.logging import configure_logging_context
from agent.runtime.process import ManagedProcess


def test_managed_process_emits_structured_output_and_exit(capsys, tmp_path):
    configure_logging_context(mode="standalone", platform="local", agent_id="agent-xyz")
    process = ManagedProcess(
        ServiceSpec(
            name="echoer",
            command=(
                sys.executable,
                "-c",
                "import sys; print('hello'); print('warn', file=sys.stderr)",
            ),
            cwd=tmp_path,
        )
    )

    process.start()
    exit_code = process.wait(timeout=2)
    assert exit_code == 0

    payloads = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
    events = [payload["event"] for payload in payloads]
    assert "service.process_started" in events
    assert "service.process_output" in events
    assert "service.process_exited" in events
    outputs = {
        (payload["stream"], payload["line"])
        for payload in payloads
        if payload["event"] == "service.process_output"
    }
    assert outputs == {("stdout", "hello"), ("stderr", "warn")}
