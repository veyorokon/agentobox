"""Durable managed-mode inbox files.

Managed transport should stay thin: websocket commands tell the runtime which
durable file changed, and runtime code owns how those files are interpreted.
This keeps transport semantics separate from task/session execution.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from agent.contracts.input import TaskInput
from agent.provisioning.manifest import CANONICAL_PATHS, write_json
from agent.runtime.runner import TaskRequest


class InboxEntryType(StrEnum):
    TASK = "task"


@dataclass(frozen=True)
class InboxTaskEntry:
    task_id: str
    input: TaskInput
    type: InboxEntryType = InboxEntryType.TASK

    def to_task_request(self) -> TaskRequest:
        return TaskRequest(id=self.task_id, input=self.input)


InboxEntry = InboxTaskEntry


@dataclass(frozen=True)
class InboxCursor:
    offset: int = 0

    def to_dict(self) -> dict[str, int]:
        return {"offset": self.offset}


def parse_inbox_line(raw_line: str) -> InboxEntry:
    """Parse one JSONL inbox line into a typed runtime request."""

    payload = json.loads(raw_line)
    entry_type = payload.get("type", "")
    if entry_type != InboxEntryType.TASK.value:
        raise ValueError(f"unsupported inbox entry type: {entry_type}")
    task_id = payload.get("task_id", "")
    task_input = payload.get("input")
    if not task_id:
        raise ValueError("task inbox entry requires task_id")
    if not isinstance(task_input, dict):
        raise ValueError("task inbox entry requires input object")
    return InboxTaskEntry(task_id=task_id, input=TaskInput.from_dict(task_input))


def load_inbox_entries(path: Path) -> list[InboxEntry]:
    """Load all current entries from a canonical inbox file."""

    if not path.exists():
        return []
    entries: list[InboxEntry] = []
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line:
            continue
        entries.append(parse_inbox_line(line))
    return entries


def inbox_cursor_path(root_dir: Path) -> Path:
    return root_dir / CANONICAL_PATHS["task_inbox_cursor"]


def load_inbox_cursor(path: Path) -> InboxCursor:
    if not path.exists():
        return InboxCursor()
    payload = json.loads(path.read_text())
    offset = payload.get("offset", 0)
    if not isinstance(offset, int) or offset < 0:
        raise ValueError("inbox cursor requires non-negative integer offset")
    return InboxCursor(offset=offset)


def store_inbox_cursor(path: Path, cursor: InboxCursor) -> None:
    write_json(path, cursor.to_dict())


def load_new_inbox_entries(path: Path, cursor_path: Path) -> tuple[list[InboxEntry], InboxCursor]:
    """Load only unseen inbox entries using a durable file-offset cursor."""

    if not path.exists():
        return [], InboxCursor()

    cursor = load_inbox_cursor(cursor_path)
    file_size = path.stat().st_size
    start_offset = 0 if cursor.offset > file_size else cursor.offset
    entries: list[InboxEntry] = []

    with path.open("r", encoding="utf-8") as handle:
        handle.seek(start_offset)
        while True:
            line = handle.readline()
            if not line:
                break
            stripped = line.strip()
            if not stripped:
                continue
            entries.append(parse_inbox_line(stripped))
        end_offset = handle.tell()

    return entries, InboxCursor(offset=end_offset)
