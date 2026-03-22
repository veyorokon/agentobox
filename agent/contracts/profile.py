from __future__ import annotations

from enum import StrEnum


class RuntimeProfile(StrEnum):
    """Canonical runtime shapes independent of platform."""

    CORE = "core"
    DESKTOP = "desktop"
