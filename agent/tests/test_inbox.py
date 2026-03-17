import json

from agent.contracts.input import TaskInput
from agent.runtime.inbox import InboxTaskEntry, load_inbox_entries, parse_inbox_line


def test_parse_inbox_task_line():
    entry = parse_inbox_line(
        json.dumps(
            {
                "type": "task",
                "task_id": "task-1",
                "input": {"role": "user", "content": [{"type": "text", "text": "hello"}]},
            }
        )
    )

    assert isinstance(entry, InboxTaskEntry)
    assert entry.task_id == "task-1"
    assert entry.input == TaskInput.from_text("hello")


def test_load_inbox_entries_ignores_blank_lines(tmp_path):
    inbox_path = tmp_path / "_abox/inbox.jsonl"
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "type": "task",
                        "task_id": "task-1",
                        "input": {"role": "user", "content": [{"type": "text", "text": "one"}]},
                    }
                ),
                "",
                json.dumps(
                    {
                        "type": "task",
                        "task_id": "task-2",
                        "input": {"role": "user", "content": [{"type": "text", "text": "two"}]},
                    }
                ),
            ]
        )
    )

    entries = load_inbox_entries(inbox_path)

    assert [entry.task_id for entry in entries] == ["task-1", "task-2"]
