'use client';

import { useMemo, useEffect } from 'react';
import { useQuery } from 'urql';
import { AGENT_MESSAGES_QUERY } from '@/lib/graphql/queries';
import { useMessagesStore } from '@/stores/messages';
import { extractMessageItems } from '@/lib/messages';
import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent, Message, MessageItem } from '@/types';

/** Internal files that should show friendly labels instead of raw filenames. */
const INTERNAL_FILES: Record<string, string> = {
  '.abox-msg': 'message',
};

function toolLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  const filePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : '';
  const rawName = filePath ? filePath.split('/').pop() || '' : '';
  const filename = INTERNAL_FILES[rawName] || rawName;
  const pattern = typeof toolInput?.pattern === 'string' ? toolInput.pattern : '';

  switch (toolName) {
    case 'Read': return filename ? `Reading ${filename}` : 'Reading file...';
    case 'Write': return filename ? `Writing ${filename}` : 'Writing file...';
    case 'Edit': return filename ? `Editing ${filename}` : 'Editing file...';
    case 'Bash': return 'Running command...';
    case 'Glob': return pattern ? `Searching for ${pattern}` : 'Searching files...';
    case 'Grep': return 'Searching code...';
    case 'WebFetch': return 'Fetching URL...';
    case 'WebSearch': return 'Searching web...';
    case 'Task': return 'Running sub-task...';
    case 'SendMessage': return 'Sending message...';
    case 'AskUserQuestion': return 'Asking question...';
    case 'NotebookEdit': return 'Editing notebook...';
    case 'TodoWrite': return 'Updating tasks...';
    case 'EnterPlanMode': return 'Planning...';
    default: return toolName ? `Using ${toolName}...` : 'Working...';
  }
}

/**
 * Chat view — renders typed Message content parts.
 *
 * Uses extractMessageItems() to separate data model from render model,
 * then dispatches to tool-specific renderers by tool name.
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Patterns to Implement"
 * @see docs/CRUSH-ARCHITECTURE.md, "ExtractMessageItems"
 */
export function ChatView({ agent, messages }: { agent: Agent; messages: Record<string, Message> }) {
  const setMessages = useMessagesStore((s) => s.setMessages);

  // Fetch messages from backend on mount
  const [{ data, fetching }] = useQuery({
    query: AGENT_MESSAGES_QUERY,
    variables: { agentId: agent.id },
    requestPolicy: 'network-only',
  });

  // Hydrate store from query
  useEffect(() => {
    if (data?.agent?.streamMessages) {
      setMessages(agent.id, data.agent.streamMessages);
    }
  }, [data, agent.id, setMessages]);

  // Convert store map to sorted array and extract render items
  const items = useMemo(() => {
    const sorted = Object.values(messages).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return extractMessageItems(sorted);
  }, [messages]);

  const statusColor = STATUS_COLOR_VAR[agent.status];

  if (fetching && items.length === 0) {
    return <div />;
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-5 py-12">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-mono font-bold"
            style={{ color: statusColor }}
          >
            {agent.name}
          </span>
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              color: statusColor,
              background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
            }}
          >
            {agent.status}
          </span>
        </div>
        <p className="text-muted-foreground/50 text-[10px] font-mono">
          Send a task to begin
          <span className="empty-cursor" />
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      {items.map((item, i) => {
        if (item.type === 'user') {
          return <UserBubble key={`u-${i}`} text={item.text} />;
        }
        if (item.type === 'assistant') {
          return <AssistantBubble key={`a-${i}`} agent={agent} text={item.text} statusColor={statusColor} />;
        }
        // tool
        return <ToolBubble key={`t-${i}`} item={item} statusColor={statusColor} />;
      })}
    </div>
  );
}

/* ── Message bubbles ── */

/**
 * Parse message text and extract image paths.
 * Detects paths like /tmp/screenshot.png or /home/user/image.jpg
 */
function parseMessageContent(text: string): { type: 'text' | 'image'; content: string }[] {
  // Match common image paths (absolute paths with image extensions)
  const imagePathRegex = /(?:^|\s)(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg))(?:\s|$)/gi;
  const parts: { type: 'text' | 'image'; content: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = imagePathRegex.exec(text)) !== null) {
    // Add text before the image
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    // Add the image
    const imagePath = match[1].trim();
    parts.push({ type: 'image', content: imagePath });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    if (remainingText.trim()) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  // If no images found, return the whole text
  if (parts.length === 0) {
    parts.push({ type: 'text', content: text });
  }

  return parts;
}

function UserBubble({ text }: { text: string }) {
  const parts = parseMessageContent(text);
  return (
    <div
      className="flex justify-end"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[88%]">
        <div className="flex items-center gap-2 mb-1 justify-end">
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
            you
          </span>
        </div>
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="px-3 py-2.5 bg-accent/10"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '1px',
            '--aug-border-bg': 'var(--accent)',
          } as React.CSSProperties}
        >
          <div className="space-y-2">
            {parts.map((part, i) =>
              part.type === 'text' ? (
                <p
                  key={i}
                  className="text-foreground text-xs font-mono whitespace-pre-wrap break-words leading-relaxed"
                >
                  {part.content}
                </p>
              ) : (
                <img
                  key={i}
                  src={part.content}
                  alt="Attached image"
                  className="max-w-full rounded-sm"
                  style={{ maxHeight: '200px' }}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({ agent, text, statusColor }: { agent: Agent; text: string; statusColor: string }) {
  const parts = parseMessageContent(text);

  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[88%]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider" style={{ color: statusColor }}>
            {agent.name}
          </span>
        </div>
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="px-3 py-2.5 bg-card"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '1px',
            '--aug-border-bg': statusColor,
          } as React.CSSProperties}
        >
          <div className="space-y-2">
            {parts.map((part, i) =>
              part.type === 'text' ? (
                <p
                  key={i}
                  className="text-foreground text-xs font-mono whitespace-pre-wrap break-words leading-relaxed"
                >
                  {part.content}
                </p>
              ) : (
                <img
                  key={i}
                  src={part.content}
                  alt="Attached image"
                  className="max-w-full rounded-sm"
                  style={{ maxHeight: '200px' }}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tool renderer dispatch — renders tool_use + tool_result pairs.
 * Each tool type gets a specialized display.
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Tool Renderer Dispatch"
 */
function ToolBubble({ item, statusColor }: { item: Extract<MessageItem, { type: 'tool' }>; statusColor: string }) {
  const { toolUse, toolResult, status } = item;
  const name = toolUse.name;

  // Status indicator color
  const indicatorColor =
    status === 'running' ? 'var(--agent-running)' :
    status === 'success' ? 'var(--agent-idle)' :
    status === 'error' ? 'var(--agent-dead)' :
    'var(--muted-foreground)';

  // Tool-specific label
  const label = toolLabel(name, toolUse.input);

  // Tool result content (truncated for display)
  // Backend normalizes content to string; defensive fallback for pre-existing data
  const rawContent = toolResult?.content;
  const resultContent = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? (rawContent as { text?: string }[]).map((c) => c.text ?? '').join('\n')
      : rawContent ? String(rawContent) : '';
  const resultTruncated = resultContent.length > 500
    ? resultContent.slice(0, 500) + '...'
    : resultContent;

  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[88%] w-full">
        <div
          className="px-3 py-2 rounded-sm"
          style={{
            background: 'var(--surface-inset)',
            borderLeft: `2px solid ${indicatorColor}`,
          }}
        >
          {/* Tool header */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: indicatorColor,
                animation: status === 'running' ? 'border-pulse 2s ease-in-out infinite' : 'none',
              }}
            />
            <span className="text-[10px] font-mono text-muted-foreground truncate min-w-0">
              {label}
            </span>
            {status === 'error' && (
              <span className="text-[9px] font-mono font-bold uppercase flex-shrink-0" style={{ color: 'var(--agent-dead)' }}>
                error
              </span>
            )}
          </div>

          {/* Tool result */}
          {toolResult && resultTruncated && (
            <pre className="text-[10px] font-mono text-muted-foreground/70 mt-1.5 whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto overflow-x-hidden">
              {resultTruncated}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
