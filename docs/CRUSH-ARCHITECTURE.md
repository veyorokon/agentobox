# Crush Architecture Reference

Comprehensive reverse-engineering of [charmbracelet/crush](https://github.com/charmbracelet/crush) - Charm's open-source AI coding assistant built in Go with Bubble Tea TUI.

**Purpose:** Evaluate Crush as an alternative integration target for Agentobox, comparing its messaging flow and extension points against Claude Code's minified binary.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Application Wiring](#application-wiring)
4. [Message Pipeline](#message-pipeline)
5. [Agent Orchestration](#agent-orchestration)
6. [Session Management](#session-management)
7. [Tool System](#tool-system)
8. [Permission System](#permission-system)
9. [PubSub Event Bus](#pubsub-event-bus)
10. [Persistence Layer](#persistence-layer)
11. [TUI / Display Layer](#tui--display-layer)
12. [Provider Abstraction](#provider-abstraction)
13. [System Prompt Assembly](#system-prompt-assembly)
14. [LSP Integration](#lsp-integration)
15. [MCP Integration](#mcp-integration)
16. [Configuration System](#configuration-system)
17. [Subagent Pattern](#subagent-pattern)
18. [Comparison with Claude Code](#comparison-with-claude-code)
19. [Integration Points for Agentobox](#integration-points-for-agentobox)

---

## Project Overview

| Property | Value |
|----------|-------|
| Language | Go |
| TUI Framework | Bubble Tea v2 (`charm.land/bubbletea/v2`) |
| LLM Abstraction | Fantasy (`charm.land/fantasy`) |
| Provider Catalog | Catwalk (`charm.land/catwalk`) |
| Styling | Lip Gloss v2 (`charm.land/lipgloss/v2`) |
| DB | SQLite via `database/sql` + sqlc-generated queries |
| CLI | Cobra (`github.com/spf13/cobra`) |
| Config | JSON with `gjson`/`sjson` for field-level read/write |

### Entry Point

```
main.go → cmd.Execute() → cobra rootCmd
  ├── Interactive: rootCmd.RunE → setupApp → tea.NewProgram(ui.New())
  └── Non-interactive: runCmd.RunE → app.RunNonInteractive()
```

### Package Map

```
internal/
├── agent/           # Core orchestration (SessionAgent, Coordinator)
│   ├── tools/       # 20+ built-in tools (bash, edit, grep, etc.)
│   │   └── mcp/     # MCP client management
│   ├── prompt/      # System prompt template builder
│   ├── hyper/       # Hyper provider support
│   └── templates/   # Embedded prompt templates (title.md, summary.md)
├── app/             # Application wiring, event setup, lifecycle
├── cmd/             # CLI commands (root, run, login, stats, etc.)
├── config/          # Config loading, providers, agents, schema
├── db/              # SQLite schema, migrations, sqlc queries
├── message/         # Message model, content parts, serialization
├── session/         # Session model, todos, CRUD
├── permission/      # Permission request/grant/deny with PubSub
├── pubsub/          # Generic Broker[T] event system
├── history/         # File version tracking
├── filetracker/     # Read file tracking for edit guards
├── lsp/             # LSP client manager
├── csync/           # Concurrent data structures (Map, Slice, Value)
├── event/           # Telemetry events
├── shell/           # Background shell management
├── commands/        # Custom command loading
├── ui/              # TUI layer
│   ├── model/       # Main Bubble Tea model (UI struct)
│   ├── chat/        # Message rendering (tool items, assistant, user)
│   ├── dialog/      # Overlay dialogs (permissions, models, sessions)
│   ├── diffview/    # Split/unified diff rendering
│   ├── completions/ # @ mention autocomplete
│   ├── common/      # Shared rendering utilities
│   ├── styles/      # Theme definitions
│   └── list/        # Virtual list with focus/highlight
└── ...              # format, diff, fsext, stringext, etc.
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Bubble Tea TUI                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ TextArea │  │  Chat    │  │ Dialogs  │  │ Header │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │             │             │        │
│       └──────────────┴─────────────┴─────────────┘        │
│                          │                                │
│                    tea.Program.Send()                     │
└──────────────────────────┬───────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │    app.Subscribe()      │
              │  (events chan tea.Msg)   │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────┴─────┐    ┌─────┴──────┐    ┌────┴──────┐
    │ Sessions │    │  Messages  │    │Permissions│
    │ Service  │    │  Service   │    │  Service  │
    │ (PubSub) │    │  (PubSub)  │    │  (PubSub) │
    └────┬─────┘    └─────┬──────┘    └────┬──────┘
         │                │                │
         └────────────────┼────────────────┘
                          │
              ┌───────────┴───────────┐
              │   Agent Coordinator    │
              │  ┌─────────────────┐  │
              │  │  SessionAgent   │  │
              │  │ ┌─────────────┐ │  │
              │  │ │messageQueue │ │  │
              │  │ └─────────────┘ │  │
              │  └───────┬─────────┘  │
              └──────────┼────────────┘
                         │
              ┌──────────┴──────────┐
              │  fantasy.Agent      │
              │  .Stream()          │
              │  ┌────────────────┐ │
              │  │  Callbacks:    │ │
              │  │  OnTextDelta   │ │
              │  │  OnToolCall    │ │
              │  │  OnToolResult  │ │
              │  │  PrepareStep   │ │
              │  │  StopWhen      │ │
              │  └────────────────┘ │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              │  fantasy.Provider   │
              │  (Anthropic/OpenAI/ │
              │   Google/etc.)      │
              └─────────────────────┘
```

---

## Application Wiring

**File:** `internal/app/app.go`

The `App` struct is the central wiring point:

```go
type App struct {
    Sessions         session.Service
    Messages         message.Service
    History          history.Service
    Permissions      permission.Service
    FileTracker      filetracker.Service
    AgentCoordinator agent.Coordinator
    LSPManager       *lsp.Manager
    config           *config.Config
    events           chan tea.Msg       // buffered channel, capacity 100
    serviceEventsWG  *sync.WaitGroup
}
```

### Initialization Flow

```
app.New(ctx, conn, cfg)
  1. Create sqlc queries from DB connection
  2. Initialize services: Sessions, Messages, History, Permissions, FileTracker, LSP
  3. app.setupEvents()  → subscribe all services to unified events channel
  4. go mcp.Initialize() → async MCP server startup
  5. app.InitCoderAgent() → create AgentCoordinator
  6. LSP callback setup
```

### Event Fan-In

`setupEvents()` creates a single `events` channel that aggregates PubSub events from all services:

```go
setupSubscriber(ctx, wg, "sessions",     app.Sessions.Subscribe, app.events)
setupSubscriber(ctx, wg, "messages",     app.Messages.Subscribe, app.events)
setupSubscriber(ctx, wg, "permissions",  app.Permissions.Subscribe, app.events)
setupSubscriber(ctx, wg, "permissions-notifications", app.Permissions.SubscribeNotifications, app.events)
setupSubscriber(ctx, wg, "history",      app.History.Subscribe, app.events)
setupSubscriber(ctx, wg, "mcp",          mcp.SubscribeEvents, app.events)
setupSubscriber(ctx, wg, "lsp",          SubscribeLSPEvents, app.events)
```

Each subscriber goroutine reads from its service's PubSub channel and forwards to `events` with a 2-second send timeout to prevent blocking.

### TUI Connection

`app.Subscribe(program)` runs a goroutine that reads from `app.events` and calls `program.Send(msg)` to push events into the Bubble Tea update loop.

---

## Message Pipeline

### Content Parts

**File:** `internal/message/content.go`

Messages contain polymorphic content parts:

| Part Type | Fields | Role |
|-----------|--------|------|
| `ReasoningContent` | Thinking, Signature, StartedAt, FinishedAt | Extended thinking |
| `TextContent` | Text | Plain text output |
| `ImageURLContent` | URL, Detail | Image references |
| `BinaryContent` | Path, MIMEType, Data | Binary file content |
| `ToolCall` | ID, Name, Input, Finished, PermissionGranted | Tool invocation |
| `ToolResult` | ToolCallID, Content, IsError, Data, MIMEType, Metadata | Tool output |
| `Finish` | Reason, Time, Error | Completion signal |

### Finish Reasons

```
end_turn | max_tokens | tool_use | canceled | error | permission_denied
```

### Message Struct

```go
type Message struct {
    ID        string
    SessionID string
    Role      MessageRole   // user | assistant | system | tool
    Parts     []ContentPart
    Model     string
    Provider  string
    CreatedAt int64
    UpdatedAt int64
}
```

**Key methods:**
- `Content() TextContent` - extracts text parts
- `ReasoningContent() ReasoningContent` - extracts thinking
- `ToolCalls() []ToolCall` - extracts tool calls
- `ToolResults() []ToolResult` - extracts tool results
- `FinishPart() *Finish` - extracts finish signal
- `AppendContent(text)` - appends text (creates or extends TextContent)
- `AddToolCall(tc)` - adds or updates tool call by ID
- `AddFinish(reason, err)` - adds finish marker
- `ToAIMessage(provider) fantasy.Message` - converts to API format
- `IsThinking() bool` - has reasoning but no text yet

### Serialization

**File:** `internal/message/message.go`

Parts are stored in SQLite as JSON array with type discriminator wrapper:

```json
[
  {"type": "text", "data": {"text": "Hello"}},
  {"type": "tool_call", "data": {"id": "tc_1", "name": "bash", "input": "..."}},
  {"type": "finish", "data": {"reason": "end_turn", "time": 1234567890}}
]
```

Supported type discriminators: `reasoning`, `text`, `image_url`, `binary`, `tool_call`, `tool_result`, `finish`

### Message Service

```go
type Service interface {
    pubsub.Subscriber[Message]
    Create(ctx, sessionID string, role MessageRole, model, provider string, isSummary bool) (Message, error)
    Update(ctx, msg Message) error
    Get(ctx, id string) (Message, error)
    List(ctx, sessionID string) ([]*Message, error)
    Delete(ctx, id string) error
}
```

Every Create/Update/Delete publishes a PubSub event (Created/Updated/Deleted) that flows through the event fan-in to the TUI.

---

## Agent Orchestration

### SessionAgent

**File:** `internal/agent/agent.go`

The `sessionAgent` manages conversation flow for a single session:

```go
type sessionAgent struct {
    largeModel         *csync.Value[Model]
    smallModel         *csync.Value[Model]
    systemPromptPrefix *csync.Value[string]
    systemPrompt       *csync.Value[string]
    tools              *csync.Slice[fantasy.AgentTool]
    isSubAgent         bool
    sessions           session.Service
    messages           message.Service
    messageQueue       *csync.Map[string, []SessionAgentCall]   // sessionID → queued prompts
    activeRequests     *csync.Map[string, context.CancelFunc]   // sessionID → cancel
}
```

### Run Flow

```
agent.Run(ctx, SessionAgentCall{SessionID, Prompt, Attachments, ...})
  1. Check if session is busy → queue if yes
  2. Create user message in DB with content parts
  3. Create assistant message (empty, will be filled by streaming)
  4. Load conversation history from DB
  5. Build fantasy.Agent with callbacks
  6. Call agent.Stream(ctx, messages, opts...)
  7. On completion: add Finish part, update session tokens/cost, generate title
```

### Streaming Callbacks

The `fantasy.Agent` provides these callback hooks:

| Callback | When | What Crush Does |
|----------|------|-----------------|
| `OnReasoningStart` | Thinking begins | Create ReasoningContent part, record StartedAt |
| `OnReasoningDelta` | Thinking token | Append to reasoning text, update message in DB |
| `OnReasoningEnd` | Thinking complete | Set FinishedAt on reasoning, store signature |
| `OnTextDelta` | Text token | Append to TextContent, update message in DB |
| `OnToolInputStart` | Tool call begins | Create ToolCall part (unfinished) |
| `OnToolCall` | Tool call complete | Mark ToolCall.Finished = true, request permission, execute tool |
| `OnToolResult` | Tool execution done | Create tool message with ToolResult part |
| `OnStepFinish` | API turn complete | Update session token usage |
| `PrepareStep` | Before each API call | **Dequeue messages**, add cache control, trim history if summarized |
| `StopWhen` | After each step | Check if auto-summarize threshold reached |

### PrepareStep: Message Queue Dequeue

```go
PrepareStep: func(ctx, msgs) ([]fantasy.Message, error) {
    // 1. Dequeue any queued messages for this session
    if queued, ok := messageQueue.Get(sessionID); ok {
        for _, call := range queued {
            // Create user message, add to conversation
        }
        messageQueue.Del(sessionID)
    }

    // 2. Add Anthropic cache control to last 2 messages + system
    addCacheControl(msgs)

    // 3. If session has summary, trim messages before summary point
    if session.SummaryMessageID != "" {
        msgs = trimToSummary(msgs, session.SummaryMessageID)
    }

    return msgs, nil
}
```

### Cache Control (Anthropic-specific)

Applied in `PrepareStep`:
- System message: `cache_control: {type: "ephemeral"}`
- Last tools block: `cache_control: {type: "ephemeral"}`
- Last 2 messages: `cache_control: {type: "ephemeral"}`

### Auto-Summarization

```go
StopWhen: func(result) bool {
    if disableAutoSummarize { return false }
    // For models with context window >= 200K:
    //   summarize when remaining buffer < 20K tokens
    // For smaller context windows:
    //   summarize when usage > 80% of context window
    threshold := calculateThreshold(model.ContextWindow)
    return totalTokens >= threshold
}
```

When triggered, calls `agent.Summarize()` which:
1. Creates a summary prompt from `templates/summary.md`
2. Sends full conversation to small model
3. Stores summary as a new message
4. Updates `session.SummaryMessageID` to mark the trim point

### Title Generation

After first message completion:
1. Create title sub-session (`"title-" + parentSessionID`)
2. Send conversation to small model with `templates/title.md` prompt
3. On failure, retry with large model
4. Update parent session title

---

## Session Management

**File:** `internal/session/session.go`

```go
type Session struct {
    ID               string
    ParentSessionID  string      // set for title/task sub-sessions
    Title            string
    MessageCount     int64
    PromptTokens     int64
    CompletionTokens int64
    SummaryMessageID string      // marks trim point for summarization
    Cost             float64
    Todos            []Todo
    CreatedAt        int64
    UpdatedAt        int64
}

type Todo struct {
    Content    string     `json:"content"`
    Status     TodoStatus `json:"status"`      // pending | in_progress | completed
    ActiveForm string     `json:"active_form"`
}
```

### Session Types

| Type | ID Pattern | Purpose |
|------|------------|---------|
| Main session | UUID | Primary conversation |
| Title session | `"title-" + parentSessionID` | Title generation |
| Task session | `toolCallID` | Subagent execution |
| Agent tool session | `"messageID$$toolCallID"` | Agent tool virtual sessions |

### Session Service

```go
type Service interface {
    pubsub.Subscriber[Session]
    Create(ctx, title) (Session, error)
    CreateTitleSession(ctx, parentSessionID) (Session, error)
    CreateTaskSession(ctx, toolCallID, parentSessionID, title) (Session, error)
    Get(ctx, id) (Session, error)
    List(ctx) ([]Session, error)               // only root sessions (parent_session_id IS NULL)
    Save(ctx, session) (Session, error)
    UpdateTitleAndUsage(ctx, sessionID, title, promptTokens, completionTokens, cost) error
    Delete(ctx, id) error
    CreateAgentToolSessionID(messageID, toolCallID) string
    ParseAgentToolSessionID(sessionID) (messageID, toolCallID, ok)
    IsAgentToolSession(sessionID) bool
}
```

---

## Tool System

### Tool Registry

**File:** `internal/config/config.go` (lines 692-716)

All available tools:
```
agent, bash, job_output, job_kill, download, edit, multiedit,
lsp_diagnostics, lsp_references, lsp_restart, fetch, agentic_fetch,
glob, grep, ls, sourcegraph, todos, view, write,
list_mcp_resources, read_mcp_resource
```

Read-only tools (used by task subagent): `glob, grep, ls, sourcegraph, view`

### Tool Implementation Pattern

Each tool file in `internal/agent/tools/` follows this pattern:

```go
const XxxToolName = "xxx"

type XxxParams struct {
    // JSON-tagged parameters
}

type XxxResponseMetadata struct {
    // Extra data for UI rendering (not sent to model)
}

func NewXxxTool(deps...) fantasy.AgentTool {
    return fantasy.AgentTool{
        Name:        XxxToolName,
        Description: "...",
        Parameters:  jsonschema.Reflect(&XxxParams{}),
        Run: func(ctx context.Context, input string) (fantasy.ToolResult, error) {
            // 1. Parse input JSON into XxxParams
            // 2. Request permission (if needed)
            // 3. Execute tool logic
            // 4. Return fantasy.ToolResult{Content: "...", Metadata: "..."}
        },
    }
}
```

### Tool Files

| File | Tool(s) | Key Behavior |
|------|---------|--------------|
| `bash.go` | bash | Shell execution, timeout, background jobs |
| `edit.go` | edit | String replacement, must-read-first guard, diff metadata |
| `multiedit.go` | multiedit | Multiple edits in one call, partial failure handling |
| `view.go` | view | File reading with offset/limit |
| `write.go` | write | File creation/overwrite |
| `glob.go` | glob | File pattern matching |
| `grep.go` | grep | Content search via ripgrep |
| `ls.go` | ls | Directory listing with depth/items limits |
| `fetch.go` | fetch | URL fetching with format/timeout |
| `web_fetch.go` | web_fetch | Web page fetching |
| `web_search.go` | web_search | Web search |
| `sourcegraph.go` | sourcegraph | Code search via Sourcegraph API |
| `diagnostics.go` | lsp_diagnostics | LSP diagnostics |
| `references.go` | lsp_references | LSP find references |
| `lsp_restart.go` | lsp_restart | Restart LSP servers |
| `todos.go` | todos | Session todo management |
| `download.go` | download | File download from URL |
| `job_output.go` | job_output | Read background job output |
| `job_kill.go` | job_kill | Kill background job |
| `mcp-tools.go` | mcp_* | Dynamic MCP tool proxying |
| `list_mcp_resources.go` | list_mcp_resources | List MCP server resources |
| `read_mcp_resource.go` | read_mcp_resource | Read specific MCP resource |

### Edit Tool (Claude Code Pattern Match)

**File:** `internal/agent/tools/edit.go`

Parameters are identical to Claude Code's Edit tool:
```go
type EditParams struct {
    FilePath   string `json:"file_path"`
    OldString  string `json:"old_string"`
    NewString  string `json:"new_string"`
    ReplaceAll bool   `json:"replace_all"`
}
```

Key behaviors lifted from Claude Code:
- Must-read-before-edit guard via `filetracker.LastReadTime()`
- File history versioning via `history.CreateVersion()`
- Diff generation for UI display (metadata, not sent to model)
- LSP notification after edit (`textDocument/didChange`)

### Tool Context

Tools receive session/message context via Go context values:

```go
const (
    SessionIDContextKey     = "session_id"
    MessageIDContextKey     = "message_id"
    SupportsImagesContextKey = "supports_images"
    ModelNameContextKey     = "model_name"
)
```

---

## Permission System

**File:** `internal/permission/permission.go`

### Flow

```
Tool execution
  → permission.Request(ctx, CreatePermissionRequest{...})
    → Check skip mode (YOLO)
    → Check allowed tools list
    → Check auto-approve sessions
    → Check session-persistent permissions (GrantPersistent cache)
    → Publish PermissionRequest via PubSub → TUI shows dialog
    → Block on response channel
    → User grants/denies via dialog
    → Return bool
```

### Permission Matching

Session-persistent permissions match on: `ToolName + Action + SessionID + Path`

Allowed tools list supports: `"toolname"` or `"toolname:action"` format.

### Service Interface

```go
type Service interface {
    pubsub.Subscriber[PermissionRequest]
    GrantPersistent(permission)  // persist for session duration
    Grant(permission)            // one-time grant
    Deny(permission)
    Request(ctx, opts) (bool, error)
    AutoApproveSession(sessionID)
    SetSkipRequests(skip bool)   // YOLO mode
    SubscribeNotifications(ctx) <-chan pubsub.Event[PermissionNotification]
}
```

---

## PubSub Event Bus

**File:** `internal/pubsub/broker.go`

Generic type-safe publish/subscribe system used by all services:

```go
type Broker[T any] struct {
    subs      map[chan Event[T]]struct{}
    mu        sync.RWMutex
    done      chan struct{}
    subCount  int
    maxEvents int      // default: 1000
}
```

### Behavior

- **Channel buffer:** 64 items per subscriber
- **Non-blocking publish:** If subscriber channel is full, event is dropped (prevents publisher blocking)
- **Context-based lifecycle:** Subscription auto-cleaned when context is cancelled
- **Thread-safe:** RWMutex protects subscriber map

### Event Types

```go
const (
    CreatedEvent EventType = "created"
    UpdatedEvent EventType = "updated"
    DeletedEvent EventType = "deleted"
)
```

### Usage Pattern

Every service embeds `*pubsub.Broker[T]` and publishes on mutations:
```go
// In session.Create():
s.Publish(pubsub.CreatedEvent, session)

// In message.Update():
s.Publish(pubsub.UpdatedEvent, msg)
```

---

## Persistence Layer

### Database

SQLite with goose migrations. Schema:

```sql
-- Sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT,
    title TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    summary_message_id TEXT,
    cost REAL NOT NULL DEFAULT 0.0,
    todos TEXT,                              -- JSON array of Todo objects
    updated_at INTEGER NOT NULL,             -- Unix timestamp
    created_at INTEGER NOT NULL
);

-- Messages
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,                       -- user | assistant | system | tool
    parts TEXT NOT NULL DEFAULT '[]',         -- JSON array of typed content parts
    model TEXT,
    provider TEXT,
    is_summary_message BOOLEAN DEFAULT FALSE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Files (version history)
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(path, session_id, version)
);

-- Read files (file tracker)
CREATE TABLE read_files (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    read_at INTEGER NOT NULL
);
```

### Auto-maintained Counters

SQLite triggers maintain:
- `sessions.message_count` (increment on insert, decrement on delete)
- `sessions.updated_at` (auto-update on any session change)
- `messages.updated_at` (auto-update on any message change)

### Query Generation

Uses [sqlc](https://sqlc.dev/) with SQL files in `internal/db/sql/`:
- `sessions.sql` - CreateSession, GetSessionByID, ListSessions, UpdateSession, UpdateSessionTitleAndUsage, DeleteSession
- `messages.sql` - CreateMessage, UpdateMessage, GetMessage, ListMessagesBySession, ListUserMessagesBySession
- `files.sql` - CreateFile, GetFile, ListFilesBySession, ListLatestSessionFiles, DeleteFile
- `read_files.sql` - RecordFileRead, ListSessionReadFiles
- `stats.sql` - GetUsageByHour, GetUsageByModel

---

## TUI / Display Layer

### Main Model

**File:** `internal/ui/model/ui.go`

The `UI` struct is the Bubble Tea model (~1400 lines). Key state:

```go
type UI struct {
    com          *common.Common
    session      *session.Session
    state        uiState          // uiOnboarding | uiInitialize | uiLanding | uiChat
    focus        uiFocusState     // uiFocusNone | uiFocusEditor | uiFocusMain

    textarea     textarea.Model
    chat         *Chat
    dialog       *dialog.Overlay
    header       *header
    completions  *completions.Completions
    attachments  *attachments.Attachments
    status       *Status

    isCompact    bool
    lspStates    map[string]app.LSPClientInfo
    mcpStates    map[string]mcp.ClientInfo
    promptQueue  int
}
```

### UI States

```
uiOnboarding → uiInitialize → uiLanding → uiChat
```

### Message Rendering

**File:** `internal/ui/chat/messages.go`

`ExtractMessageItems()` converts a `message.Message` into renderable items:

```go
func ExtractMessageItems(sty, msg, toolResults) []MessageItem {
    switch msg.Role {
    case User:      return []MessageItem{NewUserMessageItem(sty, msg)}
    case Assistant:
        items := []MessageItem{}
        if ShouldRenderAssistantMessage(msg) {
            items = append(items, NewAssistantMessageItem(sty, msg))
        }
        for _, tc := range msg.ToolCalls() {
            result := toolResults[tc.ID]
            items = append(items, NewToolMessageItem(sty, msg.ID, tc, result, canceled))
        }
        return items
    }
}
```

### Tool Message Dispatch

**File:** `internal/ui/chat/tools.go`

`NewToolMessageItem()` dispatches to specialized renderers based on tool name:

```
bash        → NewBashToolMessageItem
view        → NewViewToolMessageItem
edit        → NewEditToolMessageItem
multiedit   → NewMultiEditToolMessageItem
write       → NewWriteToolMessageItem
glob        → NewGlobToolMessageItem
grep        → NewGrepToolMessageItem
ls          → NewLSToolMessageItem
fetch       → NewFetchToolMessageItem
sourcegraph → NewSourcegraphToolMessageItem
diagnostics → NewDiagnosticsToolMessageItem
agent       → NewAgentToolMessageItem
todos       → NewTodosToolMessageItem
mcp_*       → NewMCPToolMessageItem
default     → NewGenericToolMessageItem
```

### Tool Render Interface

Each tool item implements:

```go
type ToolRenderer interface {
    RenderTool(sty *styles.Styles, width int, opts *ToolRenderOpts) string
}
```

With `ToolRenderOpts` providing:
- `ToolCall` - the tool call data
- `Result` - tool result (if completed)
- `Anim` - animation state for spinner
- `ExpandedContent` - whether tool output is expanded
- `Compact` - compact mode flag
- `Status` - AwaitingPermission | Running | Success | Error | Canceled

### Tool Status Display

```go
const (
    ToolStatusAwaitingPermission ToolStatus = iota
    ToolStatusRunning
    ToolStatusSuccess
    ToolStatusError
    ToolStatusCanceled
)
```

Icons: `● (pending) → ✓ (success) | ✗ (error) | ○ (canceled)`

### Content Rendering Utilities

- `toolOutputPlainContent()` - plain text with truncation at 10 lines
- `toolOutputCodeContent()` - syntax-highlighted code with line numbers
- `toolOutputDiffContent()` - unified/split diff rendering
- `toolOutputMarkdownContent()` - markdown rendering
- `toolOutputImageContent()` - image size info display

### Render Caching

`cachedMessageItem` caches rendered output per width to avoid re-rendering:
```go
type cachedMessageItem struct {
    rendered string
    width    int
    height   int
}
```

Cache is invalidated on: SetToolCall, SetResult, SetCompact, ToggleExpanded.

---

## Provider Abstraction

### Multi-Provider Support

**File:** `internal/agent/coordinator.go`

Crush supports 10+ providers through Fantasy:

| Provider | Type | Fantasy Package |
|----------|------|-----------------|
| Anthropic | anthropic | `fantasy/providers/anthropic` |
| OpenAI | openai | `fantasy/providers/openai` |
| Google | gemini | `fantasy/providers/google` |
| Google Vertex | vertexai | `fantasy/providers/google` |
| Azure | azure | `fantasy/providers/openai` (azure mode) |
| Bedrock | bedrock | `fantasy/providers/bedrock` |
| OpenRouter | openrouter | `fantasy/providers/openrouter` |
| Vercel | vercel | `fantasy/providers/vercel` |
| OpenAI-compat | openai-compat | `fantasy/providers/openai` (custom base URL) |
| Hyper | custom | `internal/agent/hyper` |
| GitHub Copilot | copilot | `fantasy/providers/openai` + copilot headers |

### Model Types

```go
const (
    SelectedModelTypeLarge SelectedModelType = "large"   // primary model
    SelectedModelTypeSmall SelectedModelType = "small"   // title gen, summarization
)
```

### Model Config

```go
type SelectedModel struct {
    Model           string    // model ID as used by provider API
    Provider        string    // provider key
    ReasoningEffort string    // low | medium | high (OpenAI)
    Think           bool      // enable thinking (Anthropic)
    MaxTokens       int64
    Temperature     *float64
    TopP            *float64
    TopK            *int64
    FrequencyPenalty *float64
    PresencePenalty  *float64
    ProviderOptions  map[string]any
}
```

---

## System Prompt Assembly

**File:** `internal/agent/prompt/prompt.go`

Template-based system prompt construction:

```go
type PromptData struct {
    ContextFiles   []ContextFile   // loaded from context paths
    Skills         []SkillMeta     // discovered skill metadata
    GitBranch      string
    GitStatus      string
    GitRecentCommits string
    Platform       string
    Date           string
    HostName       string
}
```

### Context File Discovery

Searches for context files in order:
```
.github/copilot-instructions.md, .cursorrules, .cursor/rules/,
CLAUDE.md, CLAUDE.local.md, GEMINI.md, gemini.md,
crush.md, crush.local.md, Crush.md, Crush.local.md,
CRUSH.md, CRUSH.local.md, AGENTS.md, agents.md, Agents.md
```

Plus any custom paths from `config.Options.ContextPaths`.

---

## LSP Integration

**File:** `internal/lsp/` package

Crush integrates LSP servers for:
- **Diagnostics** - errors/warnings after file edits
- **References** - find references across codebase
- **Auto-LSP** - auto-detect and start LSP servers based on root markers

### LSP Config

```go
type LSPConfig struct {
    Command     string
    Args        []string
    Env         map[string]string
    FileTypes   []string          // e.g., ["go", "mod"]
    RootMarkers []string          // e.g., ["go.mod"]
    InitOptions map[string]any
    Options     map[string]any
    Timeout     int               // default 30s
}
```

### LSP Tools

- `lsp_diagnostics` - Get project diagnostics
- `lsp_references` - Find references for a symbol
- `lsp_restart` - Restart LSP servers

---

## MCP Integration

**File:** `internal/agent/tools/mcp/`

### MCP Client Types

```go
const (
    MCPStdio MCPType = "stdio"
    MCPSSE   MCPType = "sse"
    MCPHttp  MCPType = "http"
)
```

### MCP Tool Proxying

MCP tools are dynamically registered as Fantasy agent tools with `mcp_` prefix:

```
MCP server "context7" tool "query-docs" → fantasy tool "mcp_context7_query-docs"
```

### MCP Lifecycle

```
app.New() → go mcp.Initialize(ctx, permissions, cfg)
  → For each config.MCP entry:
    → Start MCP client (stdio/sse/http)
    → Discover available tools
    → Register as fantasy.AgentTool
```

---

## Configuration System

**File:** `internal/config/config.go`

### Config Structure

```go
type Config struct {
    Models      map[SelectedModelType]SelectedModel
    Providers   *csync.Map[string, ProviderConfig]
    MCP         MCPs                    // map[string]MCPConfig
    LSP         LSPs                    // map[string]LSPConfig
    Options     *Options
    Permissions *Permissions
    Tools       Tools
    Agents      map[string]Agent        // "coder", "task"
}
```

### Agent Definitions

```go
func (c *Config) SetupAgents() {
    agents := map[string]Agent{
        AgentCoder: {
            ID:           "coder",
            Model:        SelectedModelTypeLarge,
            AllowedTools: resolveAllowedTools(allToolNames(), disabledTools),
        },
        AgentTask: {
            ID:           "coder",  // same base, different tool set
            Model:        SelectedModelTypeLarge,
            AllowedTools: resolveReadOnlyTools(allowedTools),  // glob, grep, ls, sourcegraph, view
            AllowedMCP:   map[string][]string{},               // NO MCPs
        },
    }
}
```

### Config Persistence

Config is stored as JSON. Field-level updates use `sjson.Set()` and `gjson.Get()` for non-destructive read/write (no full serialization round-trip).

---

## Subagent Pattern

**File:** `internal/agent/agent_tool.go`

Crush has a single subagent type - the "agent" tool:

```go
const AgentToolName = "agent"

type AgentParams struct {
    Prompt string `json:"prompt"`
}
```

### Execution

```
Parent agent calls "agent" tool
  → Create sub-session: session.CreateAgentToolSessionID(messageID, toolCallID)
  → Create sub-agent with: read-only tools only, no MCPs, isSubAgent=true
  → Run sub-agent with prompt
  → Return text result to parent
```

### Limitations (Current)

- Only one subagent type (`AgentTask` with read-only tools)
- No multi-agent teaming (TODOs in coordinator.go)
- No parallel subagent execution
- No specialized agent types (coder, reviewer, etc.)

---

## Comparison with Claude Code

### Direct Pattern Matches

| Pattern | Claude Code | Crush |
|---------|-------------|-------|
| Message queue | `queuedCommands` array | `messageQueue` csync.Map |
| Queue dequeue | `PrepareStep` callback | `PrepareStep` callback (identical) |
| Cache control | Last tools + last 2 msgs | Last tools + last 2 msgs (identical) |
| Edit params | `file_path, old_string, new_string, replace_all` | Identical |
| Must-read guard | `filetracker` check | `filetracker.LastReadTime()` (identical) |
| Auto-summarize | Token threshold check | Token threshold check (identical logic) |
| Tool status | requesting/running/success/error/canceled | AwaitingPermission/Running/Success/Error/Canceled |
| Finish reasons | end_turn/max_tokens/tool_use/canceled/error | Identical set |
| Content parts | text/tool_call/tool_result/thinking | reasoning/text/image_url/binary/tool_call/tool_result/finish |

### Original Crush Work

| Feature | Details |
|---------|---------|
| Multi-provider | 10+ providers via Fantasy (Claude Code is Anthropic-only) |
| SQLite persistence | Full session/message/file CRUD with sqlc |
| Generic PubSub | Type-safe `Broker[T]` pattern (Claude Code uses custom events) |
| LSP integration | Built-in LSP client for diagnostics/references |
| TUI framework | Bubble Tea with proper component architecture |
| Config schema | JSON Schema generation via `invopop/jsonschema` |
| Context file discovery | Reads CLAUDE.md, .cursorrules, AGENTS.md, etc. |
| Compact mode | Responsive layout with breakpoints |
| OAuth support | GitHub Copilot, Hyper OAuth flows |

### Missing from Crush (vs Claude Code)

| Feature | Status |
|---------|--------|
| Agent teaming | TODO in coordinator.go |
| Hooks system | Not implemented |
| Background shells | Basic via `shell.GetBackgroundShellManager()` |
| Plan mode | Not implemented |
| Notebook support | Not implemented |
| Web search | Basic implementation |
| Image paste/input | Supported but simpler |

---

## Integration Points for Agentobox

### Why Crush May Be Better for Integration

1. **Open source Go** - full source access, no minified binary reverse-engineering
2. **PubSub event bus** - every mutation emits typed events through a single channel
3. **SQLite persistence** - all messages/sessions queryable, standard format
4. **Clean service interfaces** - `session.Service`, `message.Service`, `permission.Service` are well-defined
5. **Non-interactive mode** - `app.RunNonInteractive()` already works headless
6. **Fantasy abstraction** - provider-agnostic, easier to add custom providers

### Key Integration Surfaces

| Surface | How to Hook |
|---------|-------------|
| Message flow | Subscribe to `message.Service` PubSub events |
| Session lifecycle | Subscribe to `session.Service` PubSub events |
| Permission requests | Subscribe to `permission.Service` PubSub events |
| Tool execution | Each tool result flows through message updates |
| Streaming tokens | Fantasy callbacks (OnTextDelta, OnToolCall, etc.) |
| File changes | Subscribe to `history.Service` PubSub events |

### Potential Approaches

1. **PubSub tap** - Add a new subscriber to the event bus that forwards to Agentobox WebSocket
2. **HTTP API wrapper** - Wrap Crush services behind an HTTP API
3. **Embedded library** - Import Crush packages directly into Agentobox backend
4. **SQLite polling** - Read Crush's SQLite DB for session/message state (least invasive)
5. **Fork + custom transport** - Fork Crush, replace TUI with WebSocket transport

### vs Claude Code Integration

| Aspect | Claude Code | Crush |
|--------|-------------|-------|
| Message capture | Hooks (PostToolUse, etc.) - limited | PubSub - complete |
| Streaming tokens | Not capturable externally | Fantasy callbacks available |
| Session state | File-based, undocumented | SQLite, queryable |
| Tool results | Hook stdout parsing | Typed PubSub events |
| Permission UI | Must use built-in TUI | Can replace permission handler |
| Multi-provider | Anthropic only | 10+ providers |
| Code access | Minified JS bundle | Full Go source |
