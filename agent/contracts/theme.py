from __future__ import annotations

from dataclasses import dataclass, field


THEME_SCHEMA_VERSION = "1"


@dataclass(frozen=True)
class ThemeDocument:
    """Canonical semantic-token theme document visible to the runtime.

    The runtime only knows about semantic token names and their values. Theme
    application layers can derive CSS, JSON, or toolkit-specific artifacts
    from this document without changing the durable contract with the backend.
    """

    tokens: dict[str, str] = field(default_factory=dict)
    schema_version: str = THEME_SCHEMA_VERSION
    name: str = ""

    @classmethod
    def from_dict(cls, payload: dict) -> "ThemeDocument":
        schema_version = str(payload.get("schema_version", "")).strip()
        if schema_version != THEME_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported theme schema version: {schema_version or '<missing>'}"
            )
        name = payload.get("name", "")
        if name is None:
            name = ""
        if not isinstance(name, str):
            raise ValueError("theme name must be a string")
        raw_tokens = payload.get("tokens")
        if not isinstance(raw_tokens, dict):
            raise ValueError("theme tokens must be an object")
        tokens: dict[str, str] = {}
        for key, value in raw_tokens.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError("theme token names must be non-empty strings")
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"theme token {key!r} must be a non-empty string")
            tokens[key] = value
        return cls(tokens=tokens, schema_version=schema_version, name=name)

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "schema_version": self.schema_version,
            "tokens": dict(self.tokens),
        }
        if self.name:
            payload["name"] = self.name
        return payload
