# Claude Code Hook System Reference

Extracted from the Claude Code codebase. This is everything we need to build the agentobox plugin.

---

## Hook Events

| Event | When | Input Fields | Supports Prompt Hooks |
|-------|------|--------------|-----------------------|
| PreToolUse | Before any tool runs | `tool_name`, `tool_input` | Yes |
| PostToolUse | After tool completes | `tool_name`, `tool_input`, `tool_result` | No (command only) |
| Stop | Main agent considers stopping | `reason` | Yes |
| SubagentStop | Subagent considers stopping | `reason` | Yes |
| UserPromptSubmit | User submits a prompt | `user_prompt` | Yes |
| SessionStart | Session begins | (none extra) | No (command only) |
| SessionEnd | Session ends | (none extra) | No (command only) |
| PreCompact | Before context compaction | (none extra) | No (command only) |
| Notification | Claude sends notification | (none extra) | No (command only) |

---

## Hook Types

### Command Hooks

Execute bash commands. Deterministic, fast.

```json
{
  "type": "command",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/validate.sh",
  "timeout": 60
}
```

### Prompt Hooks

Use LLM-driven decision making. Only on: Stop, SubagentStop, UserPromptSubmit, PreToolUse.

```json
{
  "type": "prompt",
  "prompt": "Evaluate if this tool use is appropriate: $TOOL_INPUT",
  "timeout": 30
}
```

---

## Hook Input Format

All hooks receive JSON via stdin:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.txt",
  "cwd": "/current/working/dir",
  "permission_mode": "ask|allow",
  "hook_event_name": "PreToolUse"
}
```

**Event-specific fields added to the above:**

- **PreToolUse**: `tool_name`, `tool_input`
- **PostToolUse**: `tool_name`, `tool_input`, `tool_result`
- **UserPromptSubmit**: `user_prompt`
- **Stop/SubagentStop**: `reason`

**Prompt hook variable substitution:** `$TOOL_INPUT`, `$TOOL_RESULT`, `$USER_PROMPT` etc.

---

## Hook Output Format

### Standard Output (all hooks)

```json
{
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "Message for Claude"
}
```

- `continue`: false halts processing (default true)
- `suppressOutput`: hide output from transcript (default false)
- `systemMessage`: injected into Claude's context

### PreToolUse Output

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": {"field": "modified_value"}
  },
  "systemMessage": "Explanation for Claude"
}
```

### Stop/SubagentStop Output

```json
{
  "decision": "approve|block",
  "reason": "Explanation",
  "systemMessage": "Additional context"
}
```

### Exit Codes

- `0` - Success (stdout shown in transcript)
- `2` - Blocking error (stderr fed back to Claude)
- Other - Non-blocking error

---

## Environment Variables

Available in all command hooks:

- `$CLAUDE_PROJECT_DIR` - Project root path
- `$CLAUDE_PLUGIN_ROOT` - Plugin directory (portable paths)
- `$CLAUDE_ENV_FILE` - SessionStart only: persist env vars here
- `$CLAUDE_CODE_REMOTE` - Set if running in remote context

---

## Plugin hooks.json Format

Plugin hooks live in `hooks/hooks.json` within the plugin directory:

```json
{
  "description": "Optional description",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/validate.sh"
          }
        ]
      }
    ],
    "PostToolUse": [...],
    "Stop": [...],
    "SessionStart": [...]
  }
}
```

**Key points:**
- `description` is optional
- `hooks` wrapper is required (plugin-specific format)
- Multiple hooks in the same array run **in parallel**
- Plugin hooks merge with user's hooks

---

## Matchers

```
"matcher": "Write"               // Exact match
"matcher": "Read|Write|Edit"     // Multiple tools (OR)
"matcher": "*"                   // All tools (wildcard)
"matcher": "mcp__.*__delete.*"   // Regex
"matcher": "mcp__plugin_x_.*"   // Specific plugin's MCP tools
```

Case-sensitive.

---

## SessionStart Env Persistence

SessionStart hooks can persist environment variables for the entire session:

```bash
#!/bin/bash
echo "export GOAL_ID=abc123" >> "$CLAUDE_ENV_FILE"
echo "export AGENT_NAME=worker-1" >> "$CLAUDE_ENV_FILE"
```

These become available in all subsequent hook executions and in the agent's environment.

---

## Lifecycle Notes

- Hooks load at session start. Changes require restart.
- Editing `hooks/hooks.json` won't affect current session.
- Use `claude --debug` for hook execution logs.
- Use `/hooks` command to review loaded hooks in session.
- Hooks validated at startup: invalid JSON = loading failure.
- Default timeouts: command (60s), prompt (30s).
- All matching hooks run in parallel (non-deterministic order, design for independence).
