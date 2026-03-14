from agent.contracts.lifecycle import RuntimeState, StartupStage
from agent.contracts.mode import AgentMode
from agent.runtime.config import RuntimeConfig


def test_managed_mode_requires_explicit_flag():
    import os

    old_mode = os.environ.pop("AGENTOBOX_MODE", None)
    old_callback = os.environ.get("ABOX_CALLBACK_URL")
    old_token = os.environ.get("RELAY_AUTH_TOKEN")
    os.environ["ABOX_CALLBACK_URL"] = "https://example.com"
    os.environ["RELAY_AUTH_TOKEN"] = "token"
    try:
        try:
            RuntimeConfig.from_env()
            assert False, "expected ValueError"
        except ValueError as exc:
            assert "AGENTOBOX_MODE" in str(exc)
    finally:
        if old_mode is not None:
            os.environ["AGENTOBOX_MODE"] = old_mode
        else:
            os.environ.pop("AGENTOBOX_MODE", None)
        if old_callback is not None:
            os.environ["ABOX_CALLBACK_URL"] = old_callback
        else:
            os.environ.pop("ABOX_CALLBACK_URL", None)
        if old_token is not None:
            os.environ["RELAY_AUTH_TOKEN"] = old_token
        else:
            os.environ.pop("RELAY_AUTH_TOKEN", None)


def test_managed_mode_requires_agent_id():
    import os

    old_mode = os.environ.get("AGENTOBOX_MODE")
    old_agent_id = os.environ.pop("AGENT_ID", None)
    old_callback = os.environ.get("ABOX_CALLBACK_URL")
    old_token = os.environ.get("RELAY_AUTH_TOKEN")
    os.environ["AGENTOBOX_MODE"] = "managed"
    os.environ["ABOX_CALLBACK_URL"] = "https://example.com"
    os.environ["RELAY_AUTH_TOKEN"] = "token"
    try:
        try:
            RuntimeConfig.from_env()
            assert False, "expected ValueError"
        except ValueError as exc:
            assert "AGENT_ID" in str(exc)
    finally:
        if old_mode is not None:
            os.environ["AGENTOBOX_MODE"] = old_mode
        else:
            os.environ.pop("AGENTOBOX_MODE", None)
        if old_agent_id is not None:
            os.environ["AGENT_ID"] = old_agent_id
        else:
            os.environ.pop("AGENT_ID", None)
        if old_callback is not None:
            os.environ["ABOX_CALLBACK_URL"] = old_callback
        else:
            os.environ.pop("ABOX_CALLBACK_URL", None)
        if old_token is not None:
            os.environ["RELAY_AUTH_TOKEN"] = old_token
        else:
            os.environ.pop("RELAY_AUTH_TOKEN", None)


def test_lifecycle_names_are_locked():
    assert AgentMode.STANDALONE.value == "standalone"
    assert AgentMode.MANAGED.value == "managed"
    assert StartupStage.RUNTIME_READY.value == "runtime_ready"
    assert RuntimeState.READY.value == "ready"
