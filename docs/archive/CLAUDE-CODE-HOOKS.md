# Claude Code Hook System Reference

Extracted from the Claude Code v2.1.37 binary. Complete hook event reference for building the agentobox plugin.

See also: [CLAUDE-CODE-MESSAGE-PIPELINE.md](./CLAUDE-CODE-MESSAGE-PIPELINE.md) for the full message lifecycle these hooks plug into.

---

## Hook Events

| Event | When | Input Fields | Supports Prompt Hooks |
|-------|------|--------------|-----------------------|
| PreToolUse | Before any tool runs | `tool_name`, `tool_input`, `tool_use_id` | Yes |
| PostToolUse | After tool completes | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` | No (command only) |
| PostToolUseFailure | After tool fails | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt` | No (command only) |
| PermissionRequest | User prompted for permission | `tool_name`, `tool_input`, `permission_suggestions` | No (command only) |
| Stop | Main agent considers stopping | `reason` | Yes |
| SubagentStart | Subagent spawned | `agent_id`, `agent_type` | No (command only) |
| SubagentStop | Subagent considers stopping | `agent_id`, `agent_type`, `agent_transcript_path` | Yes |
| UserPromptSubmit | User submits a prompt | `user_prompt` | Yes |
| SessionStart | Session begins | `source`, `model` | No (command only) |
| SessionEnd | Session ends | `reason` | No (command only) |
| PreCompact | Before context compaction | (none extra) | No (command only) |
| Notification | Claude sends notification | (none extra) | No (command only) |
| Setup | Initial setup/onboarding | `trigger` | No (command only) |
| TeammateIdle | Teammate becomes idle | `teammate_name`, `team_name` | No (command only) |
| TaskCompleted | Task marked complete | `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name` | No (command only) |

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

- **PreToolUse**: `tool_name`, `tool_input`, `tool_use_id`
- **PostToolUse**: `tool_name`, `tool_input`, `tool_response`, `tool_use_id`
- **PostToolUseFailure**: `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`
- **PermissionRequest**: `tool_name`, `tool_input`, `permission_suggestions`
- **UserPromptSubmit**: `user_prompt`
- **Stop/SubagentStop**: `reason`
- **SubagentStart**: `agent_id`, `agent_type`
- **SubagentStop**: `agent_id`, `agent_type`, `agent_transcript_path`
- **SessionStart**: `source` (e.g. `"startup"`), `model`
- **SessionEnd**: `reason`
- **TeammateIdle**: `teammate_name`, `team_name`
- **TaskCompleted**: `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name`
- **Setup**: `trigger`

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
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "string (optional)",
    "updatedInput": {"field": "modified_value"}
  },
  "systemMessage": "Explanation for Claude"
}
```

### PostToolUse Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "string (optional)",
    "updatedMCPToolOutput": "object (optional, MCP tools only)"
  }
}
```

### PostToolUseFailure Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": "string (optional)"
  }
}
```

### SubagentStart Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "string (optional)"
  }
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

### UserPromptSubmit Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "string (required)"
  }
}
```

### Notification Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Notification",
    "additionalContext": "string (optional)"
  }
}
```

### Exit Codes

- `0` - Success, allow action to proceed
- `2` - Feedback: stderr fed back to Claude, agent continues working (does NOT stop)
- Other - Non-blocking error (logged, does not affect agent)

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

## Hook Execution Functions (Binary Reference)

For navigating the v2.1.37 binary. See [CLAUDE-CODE-MESSAGE-PIPELINE.md](./CLAUDE-CODE-MESSAGE-PIPELINE.md) for where these fit in the message lifecycle.

| Function | Hook Event |
|---|---|
| `LVA()` | executePreToolHooks |
| `KVA()` | executePostToolHooks |
| `NVA()` | executePostToolUseFailureHooks |
| `KuT()` | executePermissionRequestHooks |
| `KUA()` | executeNotificationHooks |
| `YVA()` | executeSessionStartHooks |
| `zVA()` | executeSessionEndHooks |
| `FVA()` | executeSetupHooks |
| `rIR()` | executePreCompactHooks |

All hook functions follow the same pattern:
1. Build `hookInput` object with common fields + event-specific fields
2. Call `py()` (the hook runner) with matchers and timeout
3. `py()` calls `JVA()` to match hooks by tool name / event
4. Matched hooks execute in parallel
5. Results aggregated and yielded back

---

## Lifecycle Notes

- Hooks load at session start and hot-reload on file changes (plugin hooks watched via `WL7`).
- Use `claude --debug` for hook execution logs.
- Use `/hooks` command to review loaded hooks in session.
- Hooks validated at startup: invalid JSON = loading failure.
- Default timeouts: command (60s), prompt (30s).
- All matching hooks run in parallel (non-deterministic order, design for independence).
- Hook matcher function (`JVA`) matches by tool name for `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PermissionRequest`, by source for `SessionStart`, and by trigger for `Setup`.
