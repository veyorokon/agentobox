"""Canonical task input model for runtime execution.

Task input should preserve structured multimodal content without making the
runtime contract depend on one executor vendor's private payload shape.
Executors adapt this semantic model into their native wire format.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TaskInput:
    """Structured task input compatible with ACP/MCP-style content blocks."""

    role: str
    content: tuple[dict[str, Any], ...]

    def __post_init__(self) -> None:
        if not self.role:
            raise ValueError("task input requires role")
        if not isinstance(self.content, tuple):
            raise ValueError("task input content must be a tuple")
        for block in self.content:
            if not isinstance(block, dict):
                raise ValueError("task input content blocks must be objects")
            block_type = block.get("type", "")
            if not isinstance(block_type, str) or not block_type:
                raise ValueError("task input content blocks require type")

    @classmethod
    def from_text(cls, input_text: str, *, role: str = "user") -> "TaskInput":
        return cls(role=role, content=({"type": "text", "text": input_text},))

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TaskInput":
        role = payload.get("role", "")
        content = payload.get("content", [])
        if not isinstance(role, str) or not role:
            raise ValueError("task input requires role")
        if not isinstance(content, list) or not content:
            raise ValueError("task input requires non-empty content")
        normalized: list[dict[str, Any]] = []
        for block in content:
            if not isinstance(block, dict):
                raise ValueError("task input content blocks must be objects")
            normalized.append(copy.deepcopy(block))
        return cls(role=role, content=tuple(normalized))

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "content": [copy.deepcopy(block) for block in self.content],
        }

    def summary_text(self) -> str:
        fragments: list[str] = []
        for block in self.content:
            block_type = block.get("type", "")
            if block_type == "text" and isinstance(block.get("text"), str):
                text = block["text"].strip()
                if text:
                    fragments.append(text)
                continue
            if isinstance(block_type, str) and block_type:
                fragments.append(f"[{block_type}]")
        return "\n".join(fragments).strip()
