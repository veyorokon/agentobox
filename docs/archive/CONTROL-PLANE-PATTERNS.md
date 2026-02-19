# Control Plane Patterns: Hooks vs Stream Observation

How Agentobox intercepts Claude Code's native tools to bridge the gap between
single-machine teaming and distributed containers.

## The Problem

Claude Code's team tools (Task, SendMessage, TaskCreate, etc.) assume all agents
run on one machine via tmux panes, local files, and shared filesystem. Agentobox
runs agents in separate Docker containers across a network. We need to
transparently redirect certain operations to the backend while letting others
execute locally.

## Decision Tree

```
Does local execution cause harm?
  YES -> PreToolUse hook (block + redirect)
  NO  -> Does the backend need to know?
    YES -> Stream observation (sync after execution)
    NO  -> Do nothing
```

## Mechanism 1: PreToolUse Hooks (Block + Redirect)

**When:** Local execution is actively harmful and must be prevented.

**How:** Claude Code fires a PreToolUse hook before tool execution. The hook
script reads stdin (JSON with tool_name and tool_input), decides whether to
intercept, and exits with code 2 to block execution and inject feedback.

**Exit codes:**
- `0` = allow (tool executes normally)
- `2` = feedback mode (stderr content injected as system message, tool blocked)

### Example: Task(team_name)

If `Task(team_name=..., name=...)` executes locally, Claude Code spawns a tmux
pane inside the container — consuming API tokens with no relay, no backend
tracking, no VNC. The agent is invisible to the dashboard.

The PreToolUse hook intercepts this, POSTs to the backend to create a real
container, and returns "Deploying teammate..." as feedback. The lead continues
working while the new container boots asynchronously.

**Files:**
- `agent/rootfs/opt/abox/hooks/pre-tool-use.py` — Hook script (runs in container)
- `backend/agents/services/provision.py` — Hook config in `_build_settings_json()`
- `backend/agents/views.py` — `hook_create_teammate` endpoint

### Subagents are unaffected

Plain `Task(prompt=...)` without `team_name` passes through the hook and
executes locally. Subagents run inside the container and that's fine — they're
ephemeral workers that don't need dashboard visibility or VNC.

## Mechanism 2: Stream Observation (Sync After Execution)

**When:** Local execution is correct, but the backend needs to mirror the state.

**How:** Claude Code executes the tool locally (updates files, internal state).
The stream-json relay sends assistant events to the backend. We scan content
parts for specific tool_use calls and sync to the database as a side-effect.

### Example: SendMessage

`SendMessage` writes to a local inbox file (no-op in containers). We observe
the tool_use in the stream and deliver the message to the target agent via
`pending_input` piggyback. The local execution is harmless; we ADD the real
delivery.

**File:** `backend/agents/services/interagent.py` — `route_inter_agent_messages()`

### Example: TaskCreate / TaskUpdate

`TaskCreate` writes to `~/.claude/tasks/`. Local execution updates Claude Code's
internal task list. We observe and sync to `AgentTask` records so the dashboard
can display task progress.

**File:** `backend/agents/services/interagent.py` — `route_task_operations()`

## Async Container Creation

Container creation takes 5-30 seconds. The hook script returns immediately with
"Deploying..." feedback. The lead agent continues working. When the new agent's
relay connects, it sends a heartbeat and the dashboard shows the agent. The new
agent can send an initial message to the lead when ready.

This is critical for UX — blocking the lead for 30 seconds on every teammate
spawn would be unacceptable.

## Adding New Tool Interceptions

1. Ask: does local execution cause harm?
2. If YES: add a PreToolUse hook case in `pre-tool-use.py` + backend endpoint
3. If NO but backend needs data: add observation in `interagent.py` + call from `stream.py`
4. If NO and backend doesn't need data: do nothing

## File Reference

| File | Role |
|------|------|
| `agent/rootfs/opt/abox/hooks/pre-tool-use.py` | Hook script in container |
| `backend/agents/services/provision.py` | Hook config in settings.json |
| `backend/agents/views.py` | Hook callback endpoints |
| `backend/agents/services/interagent.py` | Message routing + task observation |
| `backend/agents/services/stream.py` | Stream event processing (calls interagent) |
| `backend/agents/models.py` | AgentTask model |
