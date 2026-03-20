"""Canonical built-in theme registry and runtime theme document helpers.

The source of truth for built-in themes lives in `shared/themes/builtins.json`.
Backend, dashboard, and agent runtime all adapt from that one manifest instead
of carrying separate hard-coded preset registries.
"""

from __future__ import annotations

import json
from pathlib import Path

THEME_SCHEMA_VERSION = "1"
PROJECT_THEME_SCHEMA_VERSION = "1"


def _discover_manifest_path() -> Path:
    here = Path(__file__).resolve()
    for candidate_root in here.parents:
        candidate = candidate_root / "shared" / "themes" / "builtins.json"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("shared/themes/builtins.json not found from agents.services.themes")


_MANIFEST_PATH = _discover_manifest_path()


def _theme_key(theme: str, mode: str) -> str:
    return f"{theme}-{mode}"


def _load_manifest() -> dict[str, object]:
    payload = json.loads(_MANIFEST_PATH.read_text())
    if not isinstance(payload, dict):
        raise ValueError("theme manifest must be a JSON object")
    themes = payload.get("themes")
    default = payload.get("default")
    if not isinstance(themes, list) or not isinstance(default, dict):
        raise ValueError("theme manifest must define default and themes")
    return payload


_MANIFEST = _load_manifest()
_MANIFEST_THEMES = _MANIFEST["themes"]
_MANIFEST_DEFAULT = _MANIFEST["default"]

BUILTIN_THEME_DEFINITIONS: tuple[dict[str, object], ...] = tuple(
    {
        "id": str(theme["id"]),
        "label": str(theme["label"]),
        "mode": str(theme["mode"]),
        "tokens": dict(theme["tokens"]),
    }
    for theme in _MANIFEST_THEMES
)

BUILTIN_THEMES: dict[str, dict[str, str]] = {
    _theme_key(str(theme["id"]), str(theme["mode"])): dict(theme["tokens"])
    for theme in BUILTIN_THEME_DEFINITIONS
}

DEFAULT_THEME = {
    "theme": str(_MANIFEST_DEFAULT["theme"]),
    "mode": str(_MANIFEST_DEFAULT["mode"]),
}
DEFAULT_THEME_KEY = _theme_key(DEFAULT_THEME["theme"], DEFAULT_THEME["mode"])
DEFAULT_THEME_TOKENS: dict[str, str] = dict(BUILTIN_THEMES[DEFAULT_THEME_KEY])
VALID_THEME_KEYS = frozenset(
    key
    for theme in BUILTIN_THEME_DEFINITIONS
    for key in dict(theme["tokens"]).keys()
)
VALID_THEME_IDS = frozenset(str(theme["id"]) for theme in BUILTIN_THEME_DEFINITIONS)
VALID_THEME_MODES = frozenset(str(theme["mode"]) for theme in BUILTIN_THEME_DEFINITIONS)


def default_theme_tokens() -> dict[str, str]:
    return dict(DEFAULT_THEME_TOKENS)


def default_project_theme_document() -> dict[str, object]:
    return build_project_theme_document(
        theme=DEFAULT_THEME["theme"],
        mode=DEFAULT_THEME["mode"],
        overrides=None,
    )


def is_valid_theme_value(value: object) -> bool:
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate:
        return False
    if any(ch in candidate for ch in ";{}"):
        return False
    return len(candidate) <= 512


def build_project_theme_document(
    *,
    theme: str,
    mode: str,
    overrides: dict[str, str] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": PROJECT_THEME_SCHEMA_VERSION,
        "theme": theme,
        "mode": mode,
    }
    normalized_overrides = {
        key: value
        for key, value in (overrides or {}).items()
        if key in VALID_THEME_KEYS and is_valid_theme_value(value)
    }
    if normalized_overrides:
        payload["overrides"] = normalized_overrides
    return payload


def find_builtin_theme_definition(theme: str, mode: str) -> dict[str, object] | None:
    for candidate in BUILTIN_THEME_DEFINITIONS:
        if str(candidate["id"]) == theme and str(candidate["mode"]) == mode:
            return dict(candidate)
    return None


def infer_builtin_theme_from_tokens(tokens: dict[str, str] | None) -> tuple[str, str] | None:
    if not tokens:
        return DEFAULT_THEME["theme"], DEFAULT_THEME["mode"]
    normalized = {
        key: str(value).strip().lower()
        for key, value in tokens.items()
        if key in VALID_THEME_KEYS and isinstance(value, str)
    }
    if not normalized:
        return DEFAULT_THEME["theme"], DEFAULT_THEME["mode"]
    for candidate in BUILTIN_THEME_DEFINITIONS:
        candidate_tokens = dict(candidate["tokens"])
        if all(str(candidate_tokens.get(key, "")).strip().lower() == value for key, value in normalized.items()):
            return str(candidate["id"]), str(candidate["mode"])
    return None


def resolve_project_theme_document(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        return default_project_theme_document()

    raw_schema = str(payload.get("schema_version", PROJECT_THEME_SCHEMA_VERSION)).strip()
    if raw_schema not in {"", PROJECT_THEME_SCHEMA_VERSION}:
        raise ValueError(f"unsupported project theme schema version: {raw_schema}")

    theme = payload.get("theme")
    mode = payload.get("mode")
    if not isinstance(theme, str) or not theme.strip() or not isinstance(mode, str) or not mode.strip():
        inferred = infer_builtin_theme_from_tokens(payload.get("overrides") if isinstance(payload.get("overrides"), dict) else None)
        theme, mode = inferred if inferred is not None else (DEFAULT_THEME["theme"], DEFAULT_THEME["mode"])
    theme = theme.strip()
    mode = mode.strip()
    if theme not in VALID_THEME_IDS or mode not in VALID_THEME_MODES:
        raise ValueError(f"unknown built-in theme: {theme}/{mode}")

    raw_overrides = payload.get("overrides")
    if raw_overrides is None:
        raw_overrides = {}
    if not isinstance(raw_overrides, dict):
        raise ValueError("theme overrides must be an object")

    overrides: dict[str, str] = {}
    for key, value in raw_overrides.items():
        if key not in VALID_THEME_KEYS:
            raise ValueError(f"invalid theme token key: {key}")
        if not is_valid_theme_value(value):
            raise ValueError(f"invalid theme token value for {key!r}")
        overrides[str(key)] = str(value)

    return build_project_theme_document(theme=theme, mode=mode, overrides=overrides)


def resolve_project_theme_tokens(payload: object) -> dict[str, str]:
    document = resolve_project_theme_document(payload)
    theme = str(document["theme"])
    mode = str(document["mode"])
    base = dict(BUILTIN_THEMES[_theme_key(theme, mode)])
    overrides = document.get("overrides") if isinstance(document.get("overrides"), dict) else {}
    return {**base, **dict(overrides)}


def normalize_project_theme_input(
    *,
    theme: str | None = None,
    mode: str | None = None,
    overrides: dict[str, str] | None = None,
    tokens: dict[str, str] | None = None,
) -> dict[str, object]:
    normalized_tokens = {
        key: value
        for key, value in (tokens or {}).items()
        if key in VALID_THEME_KEYS and is_valid_theme_value(value)
    }
    resolved_theme = (theme or "").strip()
    resolved_mode = (mode or "").strip()
    if not resolved_theme or not resolved_mode:
        inferred = infer_builtin_theme_from_tokens(normalized_tokens)
        if inferred is not None:
            resolved_theme, resolved_mode = inferred
        else:
            resolved_theme = DEFAULT_THEME["theme"]
            resolved_mode = DEFAULT_THEME["mode"]
    if resolved_theme not in VALID_THEME_IDS or resolved_mode not in VALID_THEME_MODES:
        raise ValueError(f"unknown built-in theme: {resolved_theme}/{resolved_mode}")

    base_tokens = dict(BUILTIN_THEMES[_theme_key(resolved_theme, resolved_mode)])
    candidate_overrides = {
        key: value
        for key, value in (overrides or normalized_tokens).items()
        if key in VALID_THEME_KEYS and is_valid_theme_value(value)
    }
    compact_overrides = {
        key: value
        for key, value in candidate_overrides.items()
        if base_tokens.get(key) != value
    }
    return build_project_theme_document(
        theme=resolved_theme,
        mode=resolved_mode,
        overrides=compact_overrides,
    )


def build_theme_document(tokens: dict[str, str], *, name: str = "") -> dict[str, object]:
    """Build the canonical runtime theme document."""

    payload: dict[str, object] = {
        "schema_version": THEME_SCHEMA_VERSION,
        "tokens": dict(tokens),
    }
    if name:
        payload["name"] = name
    return payload


def format_theme_document(tokens: dict[str, str], *, name: str = "") -> str:
    """Serialize a canonical runtime theme document for the agent volume."""

    return json.dumps(build_theme_document(tokens, name=name))
