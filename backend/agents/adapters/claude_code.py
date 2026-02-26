"""Claude Code adapter — translates Claude Code stream-json into our vocabulary.

Claude Code snapshot structure:
    {
        "assistant": {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "..."},
                    {"type": "tool_use", "name": "Edit", "id": "...", "input": {...}},
                ]
            }
        },
        "result": {
            "type": "result",
            "duration_ms": 125000,
            "duration_api_ms": 80000,
            "num_turns": 7,
            "total_cost_usd": 0.045,
            "is_error": false,
            "session_id": "...",
            ...
        }
    }

Semantics:
    - New assistant event pops "result" (new turn started)
    - Result event adds "result" (turn complete)
    - live_action checks for "result" key: if present, turn is done → empty string
"""


class ClaudeCodeAdapter:
    """Adapter for Claude Code stream-json events."""

    def last_output(self, snapshot: dict) -> str:
        """Last text block from the assistant event.

        Path: snapshot["assistant"]["message"]["content"][-text-]["text"]
        """
        assistant = snapshot.get("assistant")
        if not assistant:
            return ""
        content = assistant.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return ""
        text_blocks = [
            b for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if not text_blocks:
            return ""
        return (text_blocks[-1].get("text", "") or "")[:500]

    def live_action(self, snapshot: dict) -> str:
        """Last tool_use name, empty if turn is complete.

        Path: snapshot["assistant"]["message"]["content"][-tool_use-]["name"]
        Clears implicitly: if snapshot["result"] exists, turn is done.
        """
        if not snapshot or "result" in snapshot:
            return ""
        assistant = snapshot.get("assistant")
        if not assistant:
            return ""
        content = assistant.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return ""
        tool_types = ("tool_use", "server_tool_use", "mcp_tool_use")
        tool_blocks = [
            b for b in content
            if isinstance(b, dict) and b.get("type") in tool_types
        ]
        if not tool_blocks:
            return ""
        return (tool_blocks[-1].get("name", "") or "")[:500]

    def cost(self, snapshot: dict) -> float:
        """Session cost from the result event.

        Path: snapshot["result"]["total_cost_usd"]
        """
        result = snapshot.get("result")
        if not result:
            return 0.0
        return float(result.get("total_cost_usd", 0) or 0)

    def duration(self, snapshot: dict) -> str:
        """Formatted duration from the result event.

        Path: snapshot["result"]["duration_ms"]
        """
        ms = self.duration_ms(snapshot)
        if not ms:
            return "0s"
        secs = ms // 1000
        mins = secs // 60
        return f"{mins}m {secs % 60:02d}s" if mins else f"{secs}s"

    def duration_ms(self, snapshot: dict) -> int:
        """Raw duration from the result event.

        Path: snapshot["result"]["duration_ms"]
        """
        result = snapshot.get("result")
        if not result:
            return 0
        return int(result.get("duration_ms", 0) or 0)

    def turns(self, snapshot: dict) -> int:
        """Number of turns from the result event.

        Path: snapshot["result"]["num_turns"]
        """
        result = snapshot.get("result")
        if not result:
            return 0
        return int(result.get("num_turns", 0) or 0)

    def is_permission_request(self, event: dict) -> dict | None:
        """Detect AskHuman permission tool_use in assistant event.

        Claude Code emits permission requests as tool_use blocks with
        specific tool names. Returns extraction dict or None.
        """
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return None
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") not in ("tool_use", "server_tool_use"):
                continue
            inp = block.get("input", {})
            if not isinstance(inp, dict):
                continue
            # Claude Code permission pattern: tool_use with commandInput
            if "commandInput" in inp or "command" in inp:
                return {
                    "tool_use_id": block.get("id", ""),
                    "command": inp.get("command", inp.get("commandInput", "")),
                    "risk": inp.get("risk", ""),
                }
        return None

    def is_plan_proposal(self, event: dict) -> dict | None:
        """Detect plan proposal in assistant event.

        Claude Code emits plan proposals via ExitPlanMode tool_use.
        """
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return None
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            if name == "ExitPlanMode":
                inp = block.get("input", {})
                # Extract plan text from preceding text blocks
                text_blocks = [
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ]
                plan_text = "\n".join(text_blocks)
                return {
                    "tool_use_id": block.get("id", ""),
                    "title": "Implementation Plan",
                    "plan": plan_text,
                }
        return None
