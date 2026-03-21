"""Runtime-owned theme loading and projection.

The durable theme contract is a semantic-token document. The runtime derives
the concrete artifacts it needs from that one source of truth so boot-time and
live theme updates follow the same path.
"""

from __future__ import annotations

import colorsys
import json
import re
import subprocess
from pathlib import Path
from typing import Callable, Protocol

from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.theme import ThemeDocument
from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.logging import emit_event

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
        (self._root_dir / CANONICAL_PATHS["theme_awesome_lua"]).write_text(
            render_awesome_theme_lua(document)
        )
        browser_home = self._root_dir / CANONICAL_PATHS["browser_home_html"]
        browser_home.parent.mkdir(parents=True, exist_ok=True)
        browser_home.write_text(render_browser_home_html(document))


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


def render_awesome_theme_lua(document: ThemeDocument) -> str:
    """Render AwesomeWM theme tokens into a small Lua table."""

    entries = ", ".join(
        f'["{k}"] = "{_normalize_awesome_color(v)}"'
        for k, v in sorted(document.tokens.items())
    )
    return f"return {{ {entries} }}\n"


def render_browser_home_html(document: ThemeDocument) -> str:
    """Render a deterministic local Chromium home surface from canonical tokens."""

    theme_name = document.name or "Agentobox"
    initial_payload = json.dumps(document.to_dict(), separators=(",", ":"))
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agentobox</title>
    <link rel="stylesheet" href="/theme.css" />
    <style>
      :root {{
        color-scheme: dark;
      }}

      * {{
        box-sizing: border-box;
      }}

      html,
      body {{
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, var(--abox-accent-subtle, rgb(255 122 89 / 0.18)), transparent 32rem),
          linear-gradient(180deg, var(--abox-surface-raised, #202020), var(--abox-surface, #141414));
        color: var(--abox-text-default, #f6f4ee);
        font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
      }}

      body {{
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 2rem;
      }}

      .shell {{
        width: min(1040px, 100%);
        min-height: min(720px, calc(100vh - 4rem));
        border: 1px solid var(--abox-border-default, rgb(255 255 255 / 0.12));
        border-radius: var(--abox-radius-2xl, 1rem);
        background:
          linear-gradient(180deg, rgb(255 255 255 / 0.03), transparent 24%),
          var(--abox-surface-sunken, #101010);
        box-shadow: var(--abox-shadow-2xl, 0 25px 50px -12px rgb(0 0 0 / 0.55));
        overflow: hidden;
        display: grid;
        grid-template-rows: auto 1fr;
      }}

      .chrome {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--abox-border-subtle, rgb(255 255 255 / 0.08));
        background: rgb(255 255 255 / 0.02);
        backdrop-filter: blur(14px);
      }}

      .brand {{
        display: grid;
        gap: 0.25rem;
      }}

      .brand-kicker {{
        font-size: 0.72rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--abox-text-muted, #8c8c8c);
      }}

      .brand-title {{
        font-size: clamp(1.5rem, 2vw, 2rem);
        font-weight: 700;
      }}

      .brand-title strong {{
        color: var(--abox-accent, #ff7a59);
        font-weight: 700;
      }}

      .theme-pill {{
        padding: 0.4rem 0.75rem;
        border: 1px solid var(--abox-border-default, rgb(255 255 255 / 0.12));
        border-radius: 999px;
        background: var(--abox-surface-overlay, rgb(255 255 255 / 0.06));
        color: var(--abox-text-secondary, #d0d0d0);
        font-size: 0.78rem;
      }}

      .content {{
        display: grid;
        grid-template-columns: 1.35fr 0.9fr;
        gap: 1rem;
        padding: 1rem;
      }}

      .hero,
      .panel {{
        border-radius: var(--abox-radius-xl, 0.75rem);
        border: 1px solid var(--abox-border-subtle, rgb(255 255 255 / 0.08));
        background: linear-gradient(180deg, rgb(255 255 255 / 0.03), transparent 60%), var(--abox-surface-raised, #1d1d1d);
      }}

      .hero {{
        padding: 1.5rem;
        display: grid;
        gap: 1.25rem;
      }}

      .hero h1 {{
        margin: 0;
        font-size: clamp(2.25rem, 4vw, 3.75rem);
        line-height: 0.92;
        max-width: 10ch;
      }}

      .hero p {{
        margin: 0;
        max-width: 42rem;
        color: var(--abox-text-secondary, #b5b5b5);
        line-height: 1.6;
      }}

      .action-row {{
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }}

      .action {{
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.8rem 1rem;
        border-radius: var(--abox-radius-lg, 0.5rem);
        border: 1px solid var(--abox-border-default, rgb(255 255 255 / 0.12));
        background: var(--abox-interactive, rgb(255 255 255 / 0.04));
        color: inherit;
        text-decoration: none;
      }}

      .action.primary {{
        background: var(--abox-accent, #ff7a59);
        border-color: color-mix(in srgb, var(--abox-accent, #ff7a59) 70%, black);
        color: var(--abox-text-on-emphasis, white);
      }}

      .hero-grid {{
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.75rem;
      }}

      .metric {{
        padding: 1rem;
        border-radius: var(--abox-radius-lg, 0.5rem);
        background: rgb(255 255 255 / 0.03);
        border: 1px solid var(--abox-border-subtle, rgb(255 255 255 / 0.08));
      }}

      .metric-label {{
        font-size: 0.72rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--abox-text-muted, #8c8c8c);
      }}

      .metric-value {{
        margin-top: 0.45rem;
        font-size: 1.1rem;
      }}

      .stack {{
        display: grid;
        gap: 1rem;
      }}

      .panel {{
        padding: 1rem;
      }}

      .panel h2 {{
        margin: 0 0 0.8rem;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--abox-text-muted, #8c8c8c);
      }}

      .list {{
        display: grid;
        gap: 0.65rem;
      }}

      .list-item {{
        padding: 0.8rem 0.9rem;
        border-radius: var(--abox-radius-md, 0.375rem);
        background: rgb(255 255 255 / 0.03);
        border: 1px solid var(--abox-border-subtle, rgb(255 255 255 / 0.08));
      }}

      .list-item strong {{
        display: block;
        margin-bottom: 0.25rem;
        color: var(--abox-text-default, #f6f4ee);
      }}

      .list-item span {{
        color: var(--abox-text-secondary, #b5b5b5);
        font-size: 0.92rem;
      }}

      @media (max-width: 860px) {{
        .content {{
          grid-template-columns: 1fr;
        }}

        .hero-grid {{
          grid-template-columns: 1fr;
        }}
      }}
    </style>
    <script>
      const initialTheme = {initial_payload};

      function applyTheme(themeDocument) {{
        const root = window.document.documentElement;
        const tokens = themeDocument.tokens || {{}};
        for (const [name, value] of Object.entries(tokens)) {{
          root.style.setProperty(`--abox-${{name}}`, value);
        }}
        const pill = window.document.querySelector("[data-theme-pill]");
        if (pill) {{
          pill.textContent = themeDocument.name || "Agentobox";
        }}
      }}

      function signatureFor(themeDocument) {{
        return JSON.stringify([themeDocument.name || "", themeDocument.tokens || {{}}]);
      }}

      let lastSignature = signatureFor(initialTheme);
      applyTheme(initialTheme);

      async function refreshTheme() {{
        try {{
          const response = await fetch(`/theme.json?ts=${{Date.now()}}`, {{ cache: "no-store" }});
          if (!response.ok) return;
          const nextDocument = await response.json();
          const nextSignature = signatureFor(nextDocument);
          if (nextSignature === lastSignature) return;
          lastSignature = nextSignature;
          applyTheme(nextDocument);
        }} catch (_error) {{
          return;
        }}
      }}

      window.addEventListener("load", () => {{
        window.setInterval(refreshTheme, 1500);
      }});
    </script>
  </head>
  <body>
    <main class="shell">
      <header class="chrome">
        <div class="brand">
          <div class="brand-kicker">Agent Desktop</div>
          <div class="brand-title">Agento<strong>box</strong></div>
        </div>
        <div class="theme-pill" data-theme-pill>{theme_name}</div>
      </header>
      <section class="content">
        <section class="hero">
          <div>
            <h1>Browser-ready workspace for autonomous operators.</h1>
            <p>
              Chromium is the reliable desktop baseline. Theme identity comes from the
              canonical Agentobox theme system, not browser-specific hacks.
            </p>
          </div>
          <div class="action-row">
            <a class="action primary" href="https://github.com/veyorokon/agentobox">Open Source</a>
            <a class="action" href="https://dev.agentobox.com">Open Dev Control Plane</a>
            <a class="action" href="about:blank">Blank Tab</a>
          </div>
          <div class="hero-grid">
            <div class="metric">
              <div class="metric-label">Browser</div>
              <div class="metric-value">Chromium Baseline</div>
            </div>
            <div class="metric">
              <div class="metric-label">Theme Source</div>
              <div class="metric-value">Canonical Tokens</div>
            </div>
            <div class="metric">
              <div class="metric-label">Desktop Shell</div>
              <div class="metric-value">AwesomeWM + noVNC</div>
            </div>
          </div>
        </section>
        <aside class="stack">
          <section class="panel">
            <h2>Surface Contract</h2>
            <div class="list">
              <div class="list-item">
                <strong>One browser baseline</strong>
                <span>Chromium stays boring. Styling belongs in first-party surfaces.</span>
              </div>
              <div class="list-item">
                <strong>One canonical theme</strong>
                <span>Desktop and browser consume the same semantic token document.</span>
              </div>
              <div class="list-item">
                <strong>One derived web layer</strong>
                <span>theme.css feeds local browser UI without creating a second theme system.</span>
              </div>
            </div>
          </section>
          <section class="panel">
            <h2>Next Up</h2>
            <div class="list">
              <div class="list-item">
                <strong>Project-aware home</strong>
                <span>Recent agents, quick actions, and runtime facts can land here next.</span>
              </div>
              <div class="list-item">
                <strong>Optional ricing layer</strong>
                <span>GTK/profile polish can be additive later, not part of correctness.</span>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  </body>
</html>
"""


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
        consumer = ThemeConsumerGroup((AwesomeThemeConsumer(),))
    else:
        raise ValueError(f"unsupported theme platform: {platform.value}")
    return RuntimeThemeManager(applier, consumer=consumer)


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
