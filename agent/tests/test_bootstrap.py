import json
from pathlib import Path

import pytest

from agent.contracts.events import RuntimeEvent
from agent.contracts.execution import ExecutorKind
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.provisioning.manifest import CANONICAL_PATHS, write_json
from agent.provisioning.providers.managed import ManagedProvisioningProvider
from agent.runtime.bootstrap import ManagedBootstrap, ManagedBootstrapError
from agent.runtime.config import ManagedConfig, RuntimeConfig
from agent.runtime.logging import configure_logging_context


pytestmark = pytest.mark.contract


def _managed_config(tmp_path: Path) -> RuntimeConfig:
    return RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.DOCKER,
        executor=ExecutorKind.ECHO,
        bind_host="0.0.0.0",
        port=8080,
        root_dir=tmp_path,
        managed=ManagedConfig(
            agent_id="agent-123",
            callback_url="https://example.com",
            relay_auth_token="token",
        ),
    )


def _write_managed_contract(root: Path) -> None:
    (root / "home/agent").mkdir(parents=True, exist_ok=True)
    (root / "_abox").mkdir(parents=True, exist_ok=True)
    (root / CANONICAL_PATHS["relay_env"]).write_text("RELAY_AUTH_TOKEN=token\n")
    write_json(root / CANONICAL_PATHS["runtime_state"], {"mode": "managed"})
    write_json(root / CANONICAL_PATHS["runtime_status"], {})
    (root / CANONICAL_PATHS["provisioned_ready"]).write_text("token")


def test_managed_bootstrap_waits_for_valid_contract(tmp_path):
    sleeps = []
    provider = ManagedProvisioningProvider(_managed_config(tmp_path))

    def _sleep(_seconds: float) -> None:
        sleeps.append(_seconds)
        if len(sleeps) == 2:
            _write_managed_contract(tmp_path)

    bootstrap = ManagedBootstrap(
        _managed_config(tmp_path),
        provider=provider,
        sleeper=_sleep,
    )

    result = bootstrap.wait_until_ready(timeout_s=2.0, poll_interval_s=0.01)

    assert result.root_dir == tmp_path
    assert result.provisioned_ready_path == tmp_path / CANONICAL_PATHS["provisioned_ready"]
    assert result.attempts >= 3


def test_managed_bootstrap_times_out_when_contract_never_arrives(tmp_path):
    now = {"value": 0.0}

    def _clock() -> float:
        return now["value"]

    def _sleep(seconds: float) -> None:
        now["value"] += seconds

    bootstrap = ManagedBootstrap(
        _managed_config(tmp_path),
        sleeper=_sleep,
        clock=_clock,
    )

    try:
        bootstrap.wait_until_ready(timeout_s=0.5, poll_interval_s=0.2)
        assert False, "expected ManagedBootstrapError"
    except ManagedBootstrapError as exc:
        assert "managed provisioning did not become ready" in str(exc)


def test_managed_bootstrap_rejects_non_managed_mode(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,
    )

    try:
        ManagedBootstrap(config)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "AGENTOBOX_MODE=managed" in str(exc)


def test_managed_bootstrap_emits_validation_progress(capsys, tmp_path):
    sleeps = []
    provider = ManagedProvisioningProvider(_managed_config(tmp_path))
    configure_logging_context(mode="managed", platform="docker", agent_id="agent-123")

    def _sleep(_seconds: float) -> None:
        sleeps.append(_seconds)
        if len(sleeps) == 2:
            _write_managed_contract(tmp_path)

    bootstrap = ManagedBootstrap(
        _managed_config(tmp_path),
        provider=provider,
        sleeper=_sleep,
    )

    bootstrap.wait_until_ready(timeout_s=2.0, poll_interval_s=0.01)

    events = [json.loads(line) for line in capsys.readouterr().err.splitlines() if line.strip()]
    assert events[0]["event"] == RuntimeEvent.PROVISIONING_VALIDATION_FAILED.value
    assert events[0]["source"] == "managed_bootstrap"
    assert events[-1]["event"] == RuntimeEvent.PROVISIONING_RELEASE_COMPLETE.value
    assert events[-1]["source"] == "managed_bootstrap"
