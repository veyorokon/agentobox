import json

from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.theme import THEME_SCHEMA_VERSION, ThemeDocument
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.theme import (
    AwesomeThemeConsumer,
    FirefoxThemeConsumer,
    NullThemeConsumer,
    RuntimeThemeManager,
    ThemeConsumerError,
    ThemeConsumerGroup,
    ThemeFilesApplier,
    ThemeLoadError,
    build_theme_manager,
    load_theme_document,
    render_awesome_theme_lua,
    render_firefox_theme_css,
    render_theme_css,
)


def test_theme_document_requires_schema_and_tokens():
    document = ThemeDocument.from_dict(
        {
            "schema_version": THEME_SCHEMA_VERSION,
            "name": "Blyss Dark",
            "tokens": {
                "surface": "#2B303B",
                "accent": "#8FA1B3",
            },
        }
    )

    assert document.name == "Blyss Dark"
    assert document.tokens["surface"] == "#2B303B"


def test_theme_document_rejects_invalid_shape():
    try:
        ThemeDocument.from_dict({"schema_version": THEME_SCHEMA_VERSION, "tokens": {"surface": ""}})
        assert False, "expected invalid token value"
    except ValueError as exc:
        assert "must be a non-empty string" in str(exc)


def test_load_theme_document_rejects_invalid_json(tmp_path):
    path = tmp_path / "tokens.json"
    path.write_text("{")

    try:
        load_theme_document(path)
        assert False, "expected ThemeLoadError"
    except ThemeLoadError as exc:
        assert "invalid JSON" in str(exc)


def test_render_theme_css_uses_semantic_css_variables():
    css = render_theme_css(
        ThemeDocument(
            schema_version=THEME_SCHEMA_VERSION,
            tokens={"surface": "#111111", "accent": "#ff0000"},
        )
    )

    assert ":root {" in css
    assert "--abox-surface: #111111;" in css
    assert "--abox-accent: #ff0000;" in css


def test_theme_files_applier_writes_json_and_css(tmp_path):
    source = tmp_path / CANONICAL_PATHS["theme_tokens"]
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "name": "Demo",
                "tokens": {
                    "surface": "#1a1a1a",
                    "text-default": "#f0f0f0",
                },
            }
        )
    )
    applier = ThemeFilesApplier(tmp_path)

    applied = applier.apply_from_tokens_path(CANONICAL_PATHS["theme_tokens"])

    assert applied.name == "Demo"
    theme_json = json.loads((tmp_path / CANONICAL_PATHS["theme_json"]).read_text())
    theme_css = (tmp_path / CANONICAL_PATHS["theme_css"]).read_text()
    firefox_css = (tmp_path / CANONICAL_PATHS["theme_firefox_css"]).read_text()
    awesome_lua = (tmp_path / CANONICAL_PATHS["theme_awesome_lua"]).read_text()
    assert theme_json["name"] == "Demo"
    assert theme_json["tokens"]["surface"] == "#1a1a1a"
    assert "--abox-surface: #1a1a1a;" in theme_css
    assert "--abox-text-default: #f0f0f0;" in theme_css
    assert "--toolbar-bgcolor: #1a1a1a" in firefox_css
    assert '["surface"] = "#1a1a1a"' in awesome_lua


def test_render_firefox_theme_css_maps_semantic_tokens():
    css = render_firefox_theme_css(
        ThemeDocument(
            schema_version=THEME_SCHEMA_VERSION,
            tokens={
                "surface": "#2B303B",
                "surface-raised": "#343D46",
                "text-default": "#C0C5CE",
                "text-muted": "#65737E",
                "accent": "#8FA1B3",
                "border-default": "#343D46",
                "border-subtle": "#343D46",
            },
        )
    )

    assert "--toolbar-bgcolor: #2B303B" in css
    assert "--toolbar-field-color: #C0C5CE" in css
    assert "--tf-accent: #8FA1B3" in css
    assert "background-image: none !important;" in css


def test_render_awesome_theme_lua_roundtrips_tokens():
    lua = render_awesome_theme_lua(
        ThemeDocument(
            schema_version=THEME_SCHEMA_VERSION,
            tokens={
                "surface": "#101010",
                "accent": "#ffaa00",
            },
        )
    )

    assert lua.startswith("return {")
    assert '["accent"] = "#ffaa00"' in lua


def test_runtime_theme_manager_projects_then_notifies_consumers(tmp_path):
    source = tmp_path / CANONICAL_PATHS["theme_tokens"]
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "name": "Notify Me",
                "tokens": {"surface": "#111111"},
            }
        )
    )
    seen = []

    class RecordingConsumer:
        def notify_theme_changed(self, document: ThemeDocument) -> None:
            seen.append(document.name)

    manager = RuntimeThemeManager(
        ThemeFilesApplier(tmp_path),
        consumer=RecordingConsumer(),
    )

    assert manager.project_if_present() is True
    assert seen == []
    assert manager.notify_current_theme() is True
    assert seen == ["Notify Me"]


def test_runtime_theme_manager_reload_projects_and_notifies(tmp_path):
    source = tmp_path / CANONICAL_PATHS["theme_tokens"]
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "name": "Reload Me",
                "tokens": {"accent": "#ffaa00"},
            }
        )
    )
    seen = []

    class RecordingConsumer:
        def notify_theme_changed(self, document: ThemeDocument) -> None:
            seen.append(document.name)

    manager = RuntimeThemeManager(
        ThemeFilesApplier(tmp_path),
        consumer=RecordingConsumer(),
    )

    document = manager.reload_from_tokens_path(CANONICAL_PATHS["theme_tokens"])

    assert document.name == "Reload Me"
    assert seen == ["Reload Me"]


def test_firefox_theme_consumer_uses_socket_reload():
    seen = {}

    def _connector(host: str, port: int, timeout_s: float) -> None:
        seen["call"] = (host, port, timeout_s)

    consumer = FirefoxThemeConsumer(connector=_connector)
    consumer.notify_theme_changed(
        ThemeDocument(schema_version=THEME_SCHEMA_VERSION, name="Socket", tokens={"surface": "#000"})
    )

    assert seen["call"] == ("127.0.0.1", 9224, 1.0)


def test_firefox_theme_consumer_raises_clean_error_on_failure():
    def _connector(host: str, port: int, timeout_s: float) -> None:
        raise OSError("refused")

    consumer = FirefoxThemeConsumer(connector=_connector)
    try:
        consumer.notify_theme_changed(
            ThemeDocument(schema_version=THEME_SCHEMA_VERSION, name="Broken", tokens={"surface": "#000"})
        )
        assert False, "expected ThemeConsumerError"
    except ThemeConsumerError as exc:
        assert "firefox theme reload failed" in str(exc)


def test_awesome_theme_consumer_runs_reload_command():
    seen = {}

    def _runner(command: list[str]) -> None:
        seen["command"] = command

    consumer = AwesomeThemeConsumer(runner=_runner)
    consumer.notify_theme_changed(
        ThemeDocument(schema_version=THEME_SCHEMA_VERSION, name="Lua", tokens={"surface": "#202020"})
    )

    assert seen["command"][0] == "awesome-client"
    assert "agentobox_apply_theme" in seen["command"][1]


def test_theme_consumer_group_broadcasts_to_all_consumers():
    seen = []

    class RecordingConsumer:
        def __init__(self, name: str):
            self._name = name

        def notify_theme_changed(self, document: ThemeDocument) -> None:
            seen.append((self._name, document.name))

    group = ThemeConsumerGroup((RecordingConsumer("a"), RecordingConsumer("b")))
    group.notify_theme_changed(
        ThemeDocument(schema_version=THEME_SCHEMA_VERSION, name="Fanout", tokens={"surface": "#111"})
    )

    assert seen == [("a", "Fanout"), ("b", "Fanout")]


def test_build_theme_manager_uses_null_consumer_for_local(tmp_path):
    manager = build_theme_manager(tmp_path, PlatformKind.LOCAL)
    source = tmp_path / CANONICAL_PATHS["theme_tokens"]
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "tokens": {"surface": "#111111"},
            }
        )
    )

    assert manager.project_if_present() is True
    assert manager.notify_current_theme() is True


def test_build_theme_manager_uses_null_consumer_for_core_docker(tmp_path):
    manager = build_theme_manager(tmp_path, PlatformKind.DOCKER, RuntimeProfile.CORE)
    source = tmp_path / CANONICAL_PATHS["theme_tokens"]
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(
        json.dumps(
            {
                "schema_version": THEME_SCHEMA_VERSION,
                "tokens": {"surface": "#111111"},
            }
        )
    )

    assert manager.project_if_present() is True
    assert manager.notify_current_theme() is True
