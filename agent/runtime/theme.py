"""Runtime-owned theme loading and projection.

The durable theme contract is a semantic-token document. The runtime derives
the concrete artifacts it needs from that one source of truth so boot-time and
live theme updates follow the same path.
"""

from __future__ import annotations

import colorsys
import json
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Callable, Protocol

from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.theme import ThemeDocument
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.logging import emit_event

_NEWTAB_LOGO_LINES = (
    "▄████▄  ▄▄▄▄ ▄▄▄▄▄ ▄▄  ▄▄ ▄▄▄▄▄▄ ▄▄▄  ▄▄▄▄   ▄▄▄  ▄▄ ▄▄",
    "██▄▄██ ██ ▄▄ ██▄▄  ███▄██   ██  ██▀██ ██▄██ ██▀██ ▀█▄█▀",
    "██  ██ ▀███▀ ██▄▄▄ ██ ▀██   ██  ▀███▀ ██▄█▀ ▀███▀ ██ ██",
)
_NEWTAB_LOGO_CSS = '"' + "\\A ".join(_NEWTAB_LOGO_LINES) + '"'
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_HSL_COLOR_RE = re.compile(
    r"^hsla?\(\s*"
    r"(?P<hue>-?\d+(?:\.\d+)?)"
    r"(?:deg)?"
    r"(?:\s*,\s*|\s+)"
    r"(?P<saturation>\d+(?:\.\d+)?)%"
    r"(?:\s*,\s*|\s+)"
    r"(?P<lightness>\d+(?:\.\d+)?)%"
    r"(?:\s*(?:/|,)\s*(?P<alpha>\d+(?:\.\d+)?%?))?"
    r"\s*\)$",
    re.IGNORECASE,
)


class ThemeLoadError(ValueError):
    """Raised when the runtime-visible theme document is invalid."""


class ThemeApplier(Protocol):
    """Applies a canonical theme document to runtime-visible derived artifacts."""

    def apply_if_present(self) -> bool: ...

    def apply_from_tokens_path(self, rel_path: str) -> ThemeDocument: ...

    def current_document(self) -> ThemeDocument | None: ...


class ThemeConsumer(Protocol):
    """React to a newly projected theme using a consumer-native reload signal."""

    def notify_theme_changed(self, document: ThemeDocument) -> None: ...


class ThemeManager(Protocol):
    """Owns the full theme lifecycle inside the runtime."""

    def project_if_present(self) -> bool: ...

    def notify_current_theme(self) -> bool: ...

    def reload_from_tokens_path(self, rel_path: str) -> ThemeDocument: ...


class ThemeConsumerError(RuntimeError):
    """Raised when a theme consumer cannot apply a newly projected theme."""


class ThemeFilesApplier:
    """Load theme tokens and write the runtime-owned derived theme files."""

    def __init__(self, root_dir: Path):
        self._root_dir = root_dir
        self._current_document: ThemeDocument | None = None

    def apply_if_present(self) -> bool:
        source = self._root_dir / CANONICAL_PATHS["theme_tokens"]
        if not source.exists():
            return False
        self.apply_from_tokens_path(CANONICAL_PATHS["theme_tokens"])
        return True

    def apply_from_tokens_path(self, rel_path: str) -> ThemeDocument:
        source = self._root_dir / rel_path
        document = load_theme_document(source)
        self._write_theme_json(document)
        self._write_theme_css(document)
        self._current_document = document
        return document

    def current_document(self) -> ThemeDocument | None:
        return self._current_document

    def _write_theme_json(self, document: ThemeDocument) -> None:
        target = self._root_dir / CANONICAL_PATHS["theme_json"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(document.to_dict(), indent=2))

    def _write_theme_css(self, document: ThemeDocument) -> None:
        target = self._root_dir / CANONICAL_PATHS["theme_css"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render_theme_css(document))
        (self._root_dir / CANONICAL_PATHS["theme_firefox_css"]).write_text(
            render_firefox_theme_css(document)
        )
        (self._root_dir / CANONICAL_PATHS["theme_awesome_lua"]).write_text(
            render_awesome_theme_lua(document)
        )


def load_theme_document(path: Path) -> ThemeDocument:
    """Read and validate one canonical theme document from disk."""

    try:
        payload = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise ThemeLoadError(f"theme file missing: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ThemeLoadError(f"theme file is invalid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise ThemeLoadError(f"theme file must contain a JSON object: {path}")
    try:
        return ThemeDocument.from_dict(payload)
    except ValueError as exc:
        raise ThemeLoadError(str(exc)) from exc


def render_theme_css(document: ThemeDocument) -> str:
    """Render semantic tokens into a small canonical CSS variables file."""

    lines = [":root {"]
    for name, value in sorted(document.tokens.items()):
        lines.append(f"  --abox-{name}: {value};")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def render_firefox_theme_css(document: ThemeDocument) -> str:
    """Render Firefox/textfox-compatible theme overrides from semantic tokens."""

    tokens = document.tokens
    surface = tokens.get("surface", "#1e1e1e")
    surface_raised = tokens.get("surface-raised", surface)
    text_default = tokens.get("text-default", "#d4d4d4")
    text_muted = tokens.get("text-muted", "#888888")
    accent = tokens.get("accent", "#5a5a5a")
    border = tokens.get("border-default", surface_raised)
    border_subtle = tokens.get("border-subtle", surface_raised)
    return (
        "/* Generated by agent.runtime.theme — do not edit manually */\n"
        ":root {\n"
        f"  --lwt-accent-color: {surface} !important;\n"
        f"  --lwt-text-color: {text_default} !important;\n"
        f"  --lwt-tab-line-color: {accent} !important;\n"
        f"  --toolbar-bgcolor: {surface} !important;\n"
        f"  --toolbar-color: {text_muted} !important;\n"
        f"  --toolbar-field-background-color: {surface} !important;\n"
        f"  --toolbar-field-color: {text_default} !important;\n"
        f"  --toolbar-field-border-color: {border_subtle} !important;\n"
        f"  --toolbar-field-focus-background-color: {surface} !important;\n"
        f"  --toolbar-field-focus-color: {text_default} !important;\n"
        f"  --arrowpanel-background: {surface} !important;\n"
        f"  --arrowpanel-color: {text_default} !important;\n"
        f"  --arrowpanel-border-color: {border} !important;\n"
        f"  --sidebar-background-color: {surface} !important;\n"
        f"  --sidebar-text-color: {text_muted} !important;\n"
        f"  --sidebar-border-color: {border_subtle} !important;\n"
        f"  --newtab-background-color: {surface} !important;\n"
        f"  --newtab-text-primary-color: {text_default} !important;\n"
        f"  --tf-bg: {surface} !important;\n"
        f"  --tf-border: {border} !important;\n"
        f"  --tf-accent: {accent} !important;\n"
        f"  --tf-newtab-logo: {_NEWTAB_LOGO_CSS} !important;\n"
        "}\n\n"
        "#navigator-toolbox, #nav-bar, #PersonalToolbar {\n"
        f"  background-color: {surface} !important;\n"
        "  background-image: none !important;\n"
        "}\n"
        "#urlbar-background {\n"
        f"  background-color: {surface} !important;\n"
        "  background-image: none !important;\n"
        "}\n"
        "#urlbar-input-container {\n"
        f"  background-color: {surface} !important;\n"
        "  background-image: none !important;\n"
        "}\n"
    )


def render_awesome_theme_lua(document: ThemeDocument) -> str:
    """Render AwesomeWM theme tokens into a small Lua table."""

    entries = ", ".join(
        f'["{k}"] = "{_normalize_awesome_color(v)}"'
        for k, v in sorted(document.tokens.items())
    )
    return f"return {{ {entries} }}\n"


class NullThemeConsumer:
    """Theme consumer used when no visual runtime is active."""

    def notify_theme_changed(self, document: ThemeDocument) -> None:
        return None


class ThemeConsumerGroup:
    """Broadcast theme updates to every configured visual consumer."""

    def __init__(self, consumers: tuple[ThemeConsumer, ...]):
        self._consumers = consumers

    def notify_theme_changed(self, document: ThemeDocument) -> None:
        for consumer in self._consumers:
            consumer.notify_theme_changed(document)


SocketConnector = Callable[[str, int, float], None]


class FirefoxThemeConsumer:
    """Notify Firefox to reload the projected `userChrome.css` file."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 9224,
        *,
        connector: SocketConnector | None = None,
        attempts: int = 6,
        retry_delay_s: float = 0.25,
        sleeper: Callable[[float], None] | None = None,
    ):
        self._host = host
        self._port = port
        self._connector = connector or _default_socket_connector
        self._attempts = attempts
        self._retry_delay_s = retry_delay_s
        self._sleeper = sleeper or time.sleep

    def notify_theme_changed(self, document: ThemeDocument) -> None:
        for attempt in range(1, self._attempts + 1):
            try:
                self._connector(self._host, self._port, 1.0)
                break
            except OSError as exc:
                if attempt == self._attempts:
                    emit_event(
                        "theme.consumer_unavailable",
                        consumer="firefox",
                        error=str(exc),
                        theme_name=document.name,
                        token_count=len(document.tokens),
                    )
                    return
                self._sleeper(self._retry_delay_s)
        emit_event(
            "theme.consumer_applied",
            consumer="firefox",
            theme_name=document.name,
            token_count=len(document.tokens),
        )


CommandRunner = Callable[[list[str]], None]


class AwesomeThemeConsumer:
    """Notify AwesomeWM to reload its projected theme view."""

    def __init__(self, *, runner: CommandRunner | None = None):
        self._runner = runner or _default_command_runner

    def notify_theme_changed(self, document: ThemeDocument) -> None:
        command = [
            "awesome-client",
            'if agentobox_apply_theme then agentobox_apply_theme() end',
        ]
        try:
            self._runner(command)
        except (OSError, subprocess.CalledProcessError) as exc:
            raise ThemeConsumerError(f"awesome theme reload failed: {exc}") from exc
        emit_event(
            "theme.consumer_applied",
            consumer="awesome",
            theme_name=document.name,
            token_count=len(document.tokens),
        )


class RuntimeThemeManager:
    """Coordinate theme projection and consumer notification in one runtime seam."""

    def __init__(self, applier: ThemeApplier, consumer: ThemeConsumer | None = None):
        self._applier = applier
        self._consumer = consumer or NullThemeConsumer()

    def project_if_present(self) -> bool:
        return self._applier.apply_if_present()

    def notify_current_theme(self) -> bool:
        document = self._applier.current_document()
        if document is None:
            return False
        _notify_theme_consumer(self._consumer, document)
        return True

    def reload_from_tokens_path(self, rel_path: str) -> ThemeDocument:
        document = self._applier.apply_from_tokens_path(rel_path)
        _notify_theme_consumer(self._consumer, document)
        return document


def build_theme_manager(
    root_dir: Path,
    platform: PlatformKind,
    profile: RuntimeProfile = RuntimeProfile.CORE,
) -> RuntimeThemeManager:
    """Construct the default runtime theme manager for a platform kind."""

    applier = ThemeFilesApplier(root_dir)
    if profile is RuntimeProfile.CORE or platform is PlatformKind.LOCAL:
        consumer: ThemeConsumer = NullThemeConsumer()
    elif platform in {PlatformKind.DOCKER, PlatformKind.MODAL}:
        consumer = ThemeConsumerGroup((FirefoxThemeConsumer(), AwesomeThemeConsumer()))
    else:
        raise ValueError(f"unsupported theme platform: {platform.value}")
    return RuntimeThemeManager(applier, consumer=consumer)


def _default_socket_connector(host: str, port: int, timeout_s: float) -> None:
    with socket.create_connection((host, port), timeout=timeout_s):
        pass


def _default_command_runner(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True)


def _normalize_awesome_color(value: str) -> str:
    candidate = value.strip()
    if _HEX_COLOR_RE.fullmatch(candidate):
        return candidate
    match = _HSL_COLOR_RE.fullmatch(candidate)
    if match is None:
        return candidate
    hue = float(match.group("hue")) % 360.0
    saturation = _clamp_percent(match.group("saturation"))
    lightness = _clamp_percent(match.group("lightness"))
    red, green, blue = colorsys.hls_to_rgb(hue / 360.0, lightness, saturation)
    return "#{:02x}{:02x}{:02x}".format(
        round(red * 255),
        round(green * 255),
        round(blue * 255),
    )


def _clamp_percent(raw: str) -> float:
    return max(0.0, min(float(raw) / 100.0, 1.0))


def _notify_theme_consumer(consumer: ThemeConsumer, document: ThemeDocument) -> None:
    try:
        consumer.notify_theme_changed(document)
    except ThemeConsumerError as exc:
        emit_event(
            "theme.consumer_failed",
            error=str(exc),
            theme_name=document.name,
            token_count=len(document.tokens),
        )
