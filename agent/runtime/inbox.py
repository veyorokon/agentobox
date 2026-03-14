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

from agent.runtime.runner import TaskRequest


class InboxEntryType(StrEnum):
    TASK = "task"


@dataclass(frozen=True)
class InboxTaskEntry:
    task_id: str
    input_text: str
    type: InboxEntryType = InboxEntryType.TASK

    def to_task_request(self) -> TaskRequest:
        return TaskRequest(id=self.task_id, input_text=self.input_text)


InboxEntry = InboxTaskEntry


def parse_inbox_line(raw_line: str) -> InboxEntry:
    """Parse one JSONL inbox line into a typed runtime request."""

    payload = json.loads(raw_line)
    entry_type = payload.get("type", "")
    if entry_type != InboxEntryType.TASK.value:
        raise ValueError(f"unsupported inbox entry type: {entry_type}")
    task_id = payload.get("task_id", "")
    input_text = payload.get("input_text", "")
    if not task_id:
        raise ValueError("task inbox entry requires task_id")
    if not input_text:
        raise ValueError("task inbox entry requires input_text")
    return InboxTaskEntry(task_id=task_id, input_text=input_text)


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
