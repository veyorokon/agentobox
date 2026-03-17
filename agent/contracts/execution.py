from __future__ import annotations

from enum import StrEnum


class ExecutorKind(StrEnum):
    ECHO = "echo"
    CLAUDE_CODE = "claude_code"
