from agent.managed_main import main


def test_managed_main_waits_for_bootstrap_then_runs_runtime(monkeypatch):
    calls = []
    env_loaded = {}
    logging_contexts = []

    class _Value:
        def __init__(self, value: str):
            self.value = value

    class FakeBootstrap:
        def __init__(self, config):
            calls.append(("bootstrap_init", config.mode.value))

        def wait_until_ready(self, *, timeout_s: float, poll_interval_s: float):
            calls.append(("bootstrap_wait", timeout_s, poll_interval_s))

    class FakeConfig:
        def __init__(self, *, executor: str = "echo"):
            self.mode = _Value("managed")
            self.platform = _Value("docker")
            self.profile = _Value("core")
            self.executor = _Value(executor)
            self.managed = type("Managed", (), {"agent_id": "agent-123"})()
            self.root_dir = type("Root", (), {})()
            self.build = type(
                "Build",
                (),
                {
                    "image_ref": "agentobox-agent-runtime-managed:latest",
                    "image_digest": "sha256:test",
                    "git_commit": "deadbeef",
                },
            )()

    class FakeApp:
        pass

    configs = iter([FakeConfig(executor="echo"), FakeConfig(executor="claude_code")])
    monkeypatch.setattr("agent.managed_main.RuntimeConfig.from_env", lambda: next(configs))
    monkeypatch.setattr("agent.managed_main.ManagedBootstrap", FakeBootstrap)
    monkeypatch.setattr(
        "agent.managed_main.configure_logging_context",
        lambda **kwargs: logging_contexts.append(kwargs),
    )
    monkeypatch.setattr(
        "agent.managed_main.load_managed_runtime_env",
        lambda _root_dir: {"CLAUDE_MODEL": "claude-sonnet-4-5", "AGENT_MODE": "auto"},
    )

    def _apply_env_overrides(env, *, override=False):
        env_loaded.update(env)
        env_loaded["__override__"] = override

    monkeypatch.setattr("agent.managed_main.apply_env_overrides", _apply_env_overrides)

    def _app_factory(config):
        calls.append(("app_factory", config.mode.value, config.executor.value))
        return FakeApp()

    def _run_forever(app):
        calls.append(("run_forever", type(app).__name__))

    monkeypatch.setattr("agent.managed_main.run_forever", _run_forever)

    main(app_factory=_app_factory)

    assert calls == [
        ("bootstrap_init", "managed"),
        ("bootstrap_wait", 120.0, 0.25),
        ("app_factory", "managed", "claude_code"),
        ("run_forever", "FakeApp"),
    ]
    assert env_loaded == {
        "CLAUDE_MODEL": "claude-sonnet-4-5",
        "AGENT_MODE": "auto",
        "__override__": True,
    }
    assert len(logging_contexts) == 2
    assert all(entry["root_dir"] is not None for entry in logging_contexts)
