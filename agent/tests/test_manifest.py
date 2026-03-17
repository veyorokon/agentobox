import json

from agent.contracts.execution import ExecutorKind
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.provisioning.manifest import CANONICAL_PATHS, managed_manifest, standalone_manifest
from agent.provisioning.providers.managed import ManagedProvisioningProvider
from agent.provisioning.providers.standalone import StandaloneProvisioningProvider
from agent.provisioning.validate import ProvisioningValidationError, validate_manifest
from agent.runtime.config import RuntimeConfig


def test_manifest_modes():
    assert standalone_manifest().mode is AgentMode.STANDALONE
    assert managed_manifest().mode is AgentMode.MANAGED
    assert CANONICAL_PATHS["runtime_state"] in standalone_manifest().required_files
    assert CANONICAL_PATHS["relay_env"] in managed_manifest().required_files
    assert CANONICAL_PATHS["task_inbox"] in managed_manifest().optional_files
    assert CANONICAL_PATHS["desktop_awesome_rc"] in managed_manifest().derived_files
    assert CANONICAL_PATHS["desktop_firefox_config_css"] in managed_manifest().derived_files
    assert CANONICAL_PATHS["desktop_firefox_overrides_js"] in managed_manifest().derived_files


def test_standalone_provider_creates_valid_manifest_tree(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.STANDALONE,
        platform=PlatformKind.LOCAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,
    )
    provider = StandaloneProvisioningProvider(config)
    report = provider.prepare(tmp_path)
    validate_manifest(tmp_path, report.manifest)
    state = json.loads((tmp_path / CANONICAL_PATHS["runtime_state"]).read_text())
    assert state["mode"] == "standalone"


def test_managed_provider_requires_canonical_files(tmp_path):
    config = RuntimeConfig(
        mode=AgentMode.MANAGED,
        platform=PlatformKind.MODAL,
        executor=ExecutorKind.ECHO,
        bind_host="127.0.0.1",
        port=0,
        root_dir=tmp_path,
        managed=None,  # type: ignore[arg-type]
    )
    provider = ManagedProvisioningProvider(config)
    try:
        provider.prepare(tmp_path)
        assert False, "expected validation failure"
    except ProvisioningValidationError as exc:
        assert CANONICAL_PATHS["relay_env"] in str(exc)
