import json

from agent.runtime.inbox import InboxTaskEntry, load_inbox_entries, parse_inbox_line


def test_parse_inbox_task_line():
    entry = parse_inbox_line(json.dumps({"type": "task", "task_id": "task-1", "input_text": "hello"}))

    assert isinstance(entry, InboxTaskEntry)
    assert entry.task_id == "task-1"
    assert entry.input_text == "hello"


def test_load_inbox_entries_ignores_blank_lines(tmp_path):
    inbox_path = tmp_path / "_abox/inbox.jsonl"
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(
        "\n".join(
            [
                json.dumps({"type": "task", "task_id": "task-1", "input_text": "one"}),
                "",
                json.dumps({"type": "task", "task_id": "task-2", "input_text": "two"}),
            ]
        )
    )

    entries = load_inbox_entries(inbox_path)

    assert [entry.task_id for entry in entries] == ["task-1", "task-2"]
