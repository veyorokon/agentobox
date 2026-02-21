# Feed Architecture

> Port, don't invent. Match upstream naming 1:1 everywhere possible.

## Strategy

- **Gemini CLI** = architecture reference (types, hooks, state machine, component tree)
- **Qwen Code webui** = web implementation reference (Ink→DOM translation, Tailwind patterns)
- **Our delta** = augmented-ui styling + multi-agent extensions
- **Update protocol**: re-clone → diff component tree → port changes

## Component Map

Every component maps 1:1 to upstream naming where applicable.

| Upstream (Gemini/Qwen) | Our Component | File |
|---|---|---|
| `HistoryItemDisplay` | `HistoryItemDisplay` | `chat/HistoryItemDisplay.tsx` |
| `MainContent` | `ChatArea` | `chat/ChatArea.tsx` |
| `UserMessage` | `UserMessage` | `chat/messages/UserMessage.tsx` |
| `GeminiMessage` | `AssistantMessage` | `chat/messages/AssistantMessage.tsx` |
| `ThinkingMessage` | `ThinkingMessage` | `chat/messages/ThinkingMessage.tsx` |
| `ErrorMessage` | `ErrorMessage` | `chat/messages/ErrorMessage.tsx` |
| `WarningMessage` | `WarningMessage` | `chat/messages/WarningMessage.tsx` |
| `InfoMessage` | `InfoMessage` | `chat/messages/InfoMessage.tsx` |
| `ToolGroupMessage` | `ToolGroupMessage` | `chat/toolcalls/ToolGroupMessage.tsx` |
| `ReadToolCall` | `ReadToolCall` | `chat/toolcalls/ReadToolCall.tsx` |
| `WriteToolCall` | `WriteToolCall` | `chat/toolcalls/WriteToolCall.tsx` |
| `EditToolCall` | `EditToolCall` | `chat/toolcalls/EditToolCall.tsx` |
| `ShellToolCall` | `ShellToolCall` | `chat/toolcalls/ShellToolCall.tsx` |
| `SearchToolCall` | `SearchToolCall` | `chat/toolcalls/SearchToolCall.tsx` |
| `GenericToolCall` | `GenericToolCall` | `chat/toolcalls/GenericToolCall.tsx` |
| `WebFetchToolCall` | `WebFetchToolCall` | `chat/toolcalls/WebFetchToolCall.tsx` |
| `ToolCallContainer` | `ToolCallContainer` | `chat/toolcalls/shared/ToolCallContainer.tsx` |
| `StatusIndicator` | `StatusIndicator` | `chat/toolcalls/shared/StatusIndicator.tsx` |
| `CodeBlock` | `CodeBlock` | `chat/toolcalls/shared/CodeBlock.tsx` |
| `LocationsList` | `LocationsList` | `chat/toolcalls/shared/LocationsList.tsx` |
| — | `StatusMessage` | `chat/messages/StatusMessage.tsx` **EXTENSION** |
| — | `TeamMessage` | `chat/messages/TeamMessage.tsx` **EXTENSION** |
| — | `QuestionCard` | `chat/messages/QuestionCard.tsx` **EXTENSION** |
| — | `PlanMessage` | `chat/messages/PlanMessage.tsx` **EXTENSION** |
| — | `TaskDivider` | `chat/messages/TaskDivider.tsx` **EXTENSION** |
| — | `MemoryMessage` | `chat/messages/MemoryMessage.tsx` **EXTENSION** |
| — | `SystemMessage` | `chat/messages/SystemMessage.tsx` **EXTENSION** |
| — | `TaskMessage` | `chat/messages/TaskMessage.tsx` **EXTENSION** |
| — | `SubagentToolCall` | `chat/toolcalls/SubagentToolCall.tsx` **EXTENSION** |

## Type System

### HistoryItem (discriminated union)

Pattern: Gemini CLI `HistoryItem` — each variant carries only its needed fields.

```
HistoryItem = HistoryItemUser
            | HistoryItemAssistant
            | HistoryItemThinking
            | HistoryItemError
            | HistoryItemWarning
            | HistoryItemInfo
            | HistoryItemToolGroup
            | HistoryItemStatusChange    (EXTENSION)
            | HistoryItemTeamMessage     (EXTENSION)
            | HistoryItemQuestion        (EXTENSION)
            | HistoryItemPlan            (EXTENSION)
            | HistoryItemTaskStart       (EXTENSION)
            | HistoryItemTaskEnd         (EXTENSION)
            | HistoryItemMemory          (EXTENSION)
            | HistoryItemSystem          (EXTENSION)
            | HistoryItemTask            (EXTENSION)
```

All items share: `id`, `agentId`, `agentName`, `timestamp`, `cumulativeCostUsd?`

### Enums

| Enum | Values | Source |
|---|---|---|
| `StreamingState` | idle, responding, waiting_for_confirmation | Gemini |
| `ToolCallStatus` | pending, executing, success, error, canceled | Gemini |
| `ContainerStatus` | success, error, warning, loading, default | Qwen |

### Migration Map

| Old FeedItemKind | New HistoryItem type |
|---|---|
| `user-message` | `user` |
| `agent-text` | `assistant` |
| `activity` | `tool_group` |
| `error` | `error` |
| `status` | `status_change` |
| `task` | `task` |
| `system` | `system` |
| `question` | `question` |
| `memory` | `memory` |
| `plan` | `plan` |
| `task-start` | `task_start` |
| `task-end` | `task_end` |
| `team-message` | `team_message` |

## Data Adapter

Pattern: Qwen Code adapter — normalize at the edge, trust internally.

```
GraphQL (GqlFeedItem[])
  → adaptFeedItems()
    → HistoryItem[]
      → useHistoryStore
        → ChatArea
```

- `lib/adapters/graphql-adapter.ts` — maps GQL response to HistoryItem[]
- Tool kind normalization: Claude Code tool names → component routing keys
- `getToolComponentKey()` routes: Read→read, Bash→shell, Grep/Glob→search, etc.

### Subscription Mapping

| Subscription | Action |
|---|---|
| `MESSAGE_RECEIVED` | `mergeLatest()` via debounced refetch |
| `NEW_EVENT` | `mergeLatest()` via debounced refetch |
| `AGENT_UPDATED` | `updateAgent()` in agents store |

## Store Architecture

Gemini's 14 contexts → our Zustand slices.

| Store | Replaces | Purpose |
|---|---|---|
| `useHistoryStore` | `useFeedStore` | items + pending items |
| `useSessionStore` | — | per-agent streaming state, elapsed time |
| `useAgentsStore` | (keep as-is) | agent list, colors, stats |
| `useDashboardStore` | (keep as-is) | UI state, selection, tabs |

### useHistoryStore

```ts
{
  items: HistoryItem[]           // committed history (oldest first)
  pendingItems: HistoryItem[]    // streaming/pending items
  setItems(raw: GqlFeedItem[])   // full replacement from query
  mergeLatest(raw: GqlFeedItem[]) // dedup-merge from subscription
  setHistoryItems(items)          // direct set (mock data)
  addPendingItem(item)            // streaming accumulation
  commitPending()                 // move pending → committed
}
```

## Hook Inventory

| Hook | Source | Purpose |
|---|---|---|
| `useMessageQueue` | Gemini | Queue messages while AI responds, auto-submit on idle |
| `useInputHistory` | Gemini | Up-arrow shell-style history navigation |
| `useHistoryItems` | New | Select + filter items from store |
| `useAgentStreamState` | New | Per-agent streaming state |

## Tool Call Routing

`getToolComponentKey(toolName)` maps Claude Code tool names to renderer keys:

| Tool Name | Key | Component |
|---|---|---|
| Read | `read` | ReadToolCall |
| Write | `write` | WriteToolCall |
| Edit | `edit` | EditToolCall |
| Bash | `shell` | ShellToolCall |
| Glob, Grep | `search` | SearchToolCall |
| WebFetch, WebSearch | `web_fetch` | WebFetchToolCall |
| Task | `subagent` | SubagentToolCall |
| * | `generic` | GenericToolCall |

MCP tools (`mcp__server__name`) strip the prefix before routing.

## Multi-Agent Extensions

Features unique to agentobox that layer on the Gemini/Qwen base:

| Feature | Component | Store State |
|---|---|---|
| Agent color chips | All messages | `useAgentsStore.agentColors` |
| Broadcast targeting | UserMessage | `targetAgentIds` on HistoryItemUser |
| Team messages | TeamMessage | `HistoryItemTeamMessage.senderName` |
| VNC streams | ScreenPanel (separate) | Agent.vncUrl |
| Agent phases | StatusMessage | `HistoryItemStatusChange` |
| Permission modes | — (future) | Agent.permissionMode |
| Question cards | QuestionCard | `HistoryItemQuestion` |
| Plans | PlanMessage | `HistoryItemPlan` |
| Task tracking | TaskDivider | `HistoryItemTaskStart/End` |
| Memory saves | MemoryMessage | `HistoryItemMemory` |

## Update Protocol

### When to re-sync
- Major Gemini CLI release
- Quarterly check

### Process
1. Clone latest Gemini CLI: `git clone --depth 1 https://github.com/anthropics/gemini-cli`
2. Diff `packages/cli/src/ui/` against our `components/chat/`
3. Port new components/hooks
4. Update this doc

### Breaking change handling
- Lock version in doc header
- Current baseline: Gemini CLI v0.1.x (June 2025)

## Directory Structure

```
dashboard/
  components/
    chat/
      ChatArea.tsx
      HistoryItemDisplay.tsx
      FeedRow.tsx
      messages/
        UserMessage.tsx
        AssistantMessage.tsx
        ThinkingMessage.tsx
        ErrorMessage.tsx
        WarningMessage.tsx
        InfoMessage.tsx
        StatusMessage.tsx
        TeamMessage.tsx
        QuestionCard.tsx
        PlanMessage.tsx
        TaskDivider.tsx
        MemoryMessage.tsx
        SystemMessage.tsx
        TaskMessage.tsx
      toolcalls/
        ToolGroupMessage.tsx
        ReadToolCall.tsx
        WriteToolCall.tsx
        EditToolCall.tsx
        ShellToolCall.tsx
        SearchToolCall.tsx
        GenericToolCall.tsx
        WebFetchToolCall.tsx
        SubagentToolCall.tsx
        shared/
          ToolCallContainer.tsx
          StatusIndicator.tsx
          CodeBlock.tsx
          LocationsList.tsx
          utils.ts
          index.ts
      shared/
        chat.css
  lib/
    adapters/
      graphql-adapter.ts
    mock-history.ts
  stores/
    history.ts
    session.ts
  types/
    history.ts
  hooks/
    use-message-queue.ts
    use-input-history.ts
    use-history-items.ts
```
