'use client';

import { useMemo, useRef, useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { getAgentColor } from '@/lib/agent-colors';
import { extractMessageItems } from '@/lib/messages';
import type { Agent, Message, MessageItem, TimelineEntry, ContentPart } from '@/types';

// ── Feed item types (grouped for display) ──

type FeedGroup =
  | { kind: 'user'; item: Extract<MessageItem, { type: 'user' }>; agentId: string }
  | { kind: 'text'; item: Extract<MessageItem, { type: 'assistant' }>; agentId: string }
  | { kind: 'activity'; agentId: string; tools: Extract<MessageItem, { type: 'tool' }>[] }
  | { kind: 'error'; item: Extract<MessageItem, { type: 'tool' }>; agentId: string }
  | { kind: 'status'; entry: TimelineEntry; agentId: string }
  | { kind: 'task'; entry: TimelineEntry; agentId: string }
  | { kind: 'system'; entry: TimelineEntry; agentId: string }
  | { kind: 'event-error'; entry: TimelineEntry; agentId: string };

// ── Helpers ──

function toolLabel(name: string, input?: Record<string, unknown>): string {
  const filePath = typeof input?.file_path === 'string' ? input.file_path : '';
  const rawName = filePath ? filePath.split('/').pop() || '' : '';
  const filename = rawName === '.abox-msg' ? 'message' : rawName;
  const pattern = typeof input?.pattern === 'string' ? input.pattern : '';

  switch (name) {
    case 'Read': return filename ? `Read ${filename}` : 'Reading';
    case 'Write': return filename ? `Write ${filename}` : 'Writing';
    case 'Edit': return filename ? `Edit ${filename}` : 'Editing';
    case 'Bash': return 'Run command';
    case 'Glob': return pattern ? `Search ${pattern}` : 'Search files';
    case 'Grep': return 'Search code';
    case 'WebFetch': return 'Fetch URL';
    case 'WebSearch': return 'Search web';
    case 'Task': return 'Sub-task';
    case 'SendMessage': return 'Message teammate';
    default: return name || 'Working';
  }
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'deploying': return 'var(--agent-deploying)';
    case 'running': return 'var(--agent-active)';
    case 'idle': return 'var(--agent-active)';
    case 'stopped': return 'var(--agent-dead)';
    case 'error': return 'var(--agent-dead)';
    default: return 'var(--muted-foreground)';
  }
}

// ── Reconstruct Message from timeline entry data ──

function messageFromEntry(entry: TimelineEntry): Message {
  const d = entry.data;
  return {
    id: entry.id,
    agentId: entry.agentId,
    messageId: String(d.message_id ?? ''),
    sessionId: String(d.session_id ?? ''),
    role: d.role as Message['role'],
    parts: (d.parts ?? []) as ContentPart[],
    turnNumber: Number(d.turn_number ?? 0),
    createdAt: entry.createdAt,
  };
}

// ── Build feed groups from timeline entries ──

function buildFeedGroups(entries: TimelineEntry[]): FeedGroup[] {
  // 1. Collect message entries, reconstruct Messages for item extraction
  const messages: Message[] = [];
  for (const entry of entries) {
    if (entry.entryType === 'message') {
      messages.push(messageFromEntry(entry));
    }
  }

  // 2. Extract message items (handles tool_use → tool_result matching)
  const msgItems = extractMessageItems(messages);

  // 3. Index items by messageId for lookup during timeline walk
  const itemsByMsgId = new Map<string, MessageItem[]>();
  for (const item of msgItems) {
    const mid = item.message.messageId;
    const list = itemsByMsgId.get(mid) ?? [];
    list.push(item);
    itemsByMsgId.set(mid, list);
  }

  // 4. Walk entries in order, building feed groups with tool batching
  const result: FeedGroup[] = [];
  let toolBatch: Extract<MessageItem, { type: 'tool' }>[] = [];
  let batchAgentId: string | null = null;

  function flush() {
    if (toolBatch.length > 0 && batchAgentId) {
      result.push({ kind: 'activity', agentId: batchAgentId, tools: [...toolBatch] });
      toolBatch = [];
      batchAgentId = null;
    }
  }

  for (const entry of entries) {
    if (entry.entryType === 'message') {
      const mid = String(entry.data.message_id ?? '');
      const items = itemsByMsgId.get(mid) ?? [];

      for (const item of items) {
        if (item.type === 'tool') {
          if (item.status === 'error') {
            flush();
            result.push({ kind: 'error', item, agentId: item.message.agentId });
            continue;
          }
          const aid = item.message.agentId;
          if (batchAgentId === aid) {
            toolBatch.push(item);
          } else {
            flush();
            batchAgentId = aid;
            toolBatch.push(item);
          }
        } else if (item.type === 'user') {
          flush();
          result.push({ kind: 'user', item, agentId: item.message.agentId });
        } else {
          flush();
          result.push({ kind: 'text', item, agentId: item.message.agentId });
        }
      }
    } else {
      flush();
      switch (entry.entryType) {
        case 'status':
          result.push({ kind: 'status', entry, agentId: entry.agentId });
          break;
        case 'task':
          result.push({ kind: 'task', entry, agentId: entry.agentId });
          break;
        case 'system':
          result.push({ kind: 'system', entry, agentId: entry.agentId });
          break;
        case 'error':
          result.push({ kind: 'event-error', entry, agentId: entry.agentId });
          break;
        case 'cost':
          // Silent — cost events update StatusBar, not the feed
          break;
      }
    }
  }
  flush();

  return result;
}

// ── Main feed component ──

interface ChatViewProps {
  entries: TimelineEntry[];
  agentsMap: Record<string, Agent>;
  selectedAgentId: string | null;
}

export function ChatView({ entries, agentsMap, selectedAgentId }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const filtered = selectedAgentId
      ? entries.filter((e) => e.agentId === selectedAgentId)
      : entries;
    return buildFeedGroups(filtered);
  }, [entries, selectedAgentId]);

  // Auto-scroll on new content
  const prevGroupCount = useRef(groups.length);
  useEffect(() => {
    if (groups.length > prevGroupCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevGroupCount.current = groups.length;
  }, [groups.length]);

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-muted-foreground/50 text-xs font-mono">
            {selectedAgentId
              ? `No activity from ${agentsMap[selectedAgentId]?.name ?? 'agent'} yet`
              : 'Deploy an agent and send a message to begin'}
          </p>
          <span className="empty-cursor" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-2"
    >
      {groups.map((group, i) => {
        const agent = agentsMap[group.agentId];
        const agentColor = agent
          ? getAgentColor(agent.name, agent.role)
          : 'var(--muted-foreground)';
        const isLead = agent?.role === 'lead';

        switch (group.kind) {
          case 'user': {
            const agentName = agent?.name ?? 'unknown';
            return (
              <UserBubble
                key={`u-${i}`}
                text={group.item.text}
                targetName={agentName}
                agentColor={agentColor}
              />
            );
          }
          case 'text': {
            const agentName = agent?.name ?? 'unknown';
            return (
              <AgentTextBubble
                key={`t-${i}`}
                text={group.item.text}
                agentName={agentName}
                agentColor={agentColor}
                isLead={isLead}
              />
            );
          }
          case 'activity': {
            const agentName = agent?.name ?? 'unknown';
            return (
              <ActivityLine
                key={`a-${i}`}
                tools={group.tools}
                agentName={agentName}
                agentColor={agentColor}
              />
            );
          }
          case 'error': {
            const agentName = agent?.name ?? 'unknown';
            return (
              <ErrorBubble
                key={`e-${i}`}
                item={group.item}
                agentName={agentName}
                agentColor={agentColor}
              />
            );
          }
          case 'status':
            return (
              <StatusLine
                key={`s-${i}`}
                entry={group.entry}
                agentColor={agentColor}
              />
            );
          case 'task':
            return (
              <TaskLine
                key={`tk-${i}`}
                entry={group.entry}
                agentColor={agentColor}
              />
            );
          case 'system':
            return (
              <SystemLine
                key={`sys-${i}`}
                entry={group.entry}
                agentColor={agentColor}
              />
            );
          case 'event-error':
            return (
              <EventErrorLine
                key={`ee-${i}`}
                entry={group.entry}
                agentColor={agentColor}
              />
            );
        }
      })}
    </div>
  );
}

// ── Message bubble components ──

function UserBubble({
  text,
  targetName,
  agentColor,
}: {
  text: string;
  targetName: string;
  agentColor: string;
}) {
  return (
    <div
      className="flex justify-end"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[75%]">
        <div className="flex items-center gap-1.5 mb-1 justify-end">
          <span className="text-[9px] font-mono text-muted-foreground/60">
            you
          </span>
          <span className="text-[9px] font-mono text-muted-foreground/40">&rarr;</span>
          <span
            className="text-[9px] font-mono font-bold"
            style={{ color: agentColor }}
          >
            {targetName}
          </span>
        </div>
        <div
          className="px-3 py-2 rounded-sm"
          style={{
            background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
            borderRight: '2px solid var(--accent)',
          }}
        >
          <p className="text-foreground text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentTextBubble({
  text,
  agentName,
  agentColor,
  isLead,
}: {
  text: string;
  agentName: string;
  agentColor: string;
  isLead: boolean;
}) {
  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className={isLead ? 'max-w-[85%]' : 'max-w-[75%]'}>
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: agentColor }}
          />
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: agentColor }}
          >
            {agentName}
          </span>
        </div>
        <div
          className="px-3 py-2 rounded-sm"
          style={{
            background: isLead
              ? 'color-mix(in srgb, var(--accent) 4%, var(--card))'
              : 'var(--card)',
            borderLeft: `2px solid ${agentColor}`,
          }}
        >
          <p
            className={`text-foreground font-mono whitespace-pre-wrap break-words leading-relaxed ${
              isLead ? 'text-xs' : 'text-[11px]'
            }`}
          >
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

function ActivityLine({
  tools,
  agentName,
  agentColor,
}: {
  tools: Extract<MessageItem, { type: 'tool' }>[];
  agentName: string;
  agentColor: string;
}) {
  const labels = tools.map((t) => toolLabel(t.toolUse.name, t.toolUse.input));
  const shown = labels.slice(0, 2).join(', ');
  const rest = labels.length > 2 ? ` +${labels.length - 2} more` : '';
  const anyRunning = tools.some((t) => t.status === 'running');

  return (
    <div
      className="flex items-center gap-2 py-0.5 px-1"
      style={{ animation: 'msg-enter 0.2s ease-out forwards' }}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{
          background: agentColor,
          opacity: 0.5,
          animation: anyRunning ? 'border-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      <span
        className="text-[9px] font-mono font-bold flex-shrink-0"
        style={{ color: agentColor, opacity: 0.7 }}
      >
        {agentName}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/50 truncate">
        {shown}{rest}
      </span>
      {anyRunning && (
        <span
          className="text-[8px] font-mono uppercase tracking-wider flex-shrink-0"
          style={{ color: agentColor, opacity: 0.6 }}
        >
          running
        </span>
      )}
    </div>
  );
}

function ErrorBubble({
  item,
  agentName,
  agentColor,
}: {
  item: Extract<MessageItem, { type: 'tool' }>;
  agentName: string;
  agentColor: string;
}) {
  const rawContent = item.toolResult?.content;
  const errorText = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? (rawContent as { text?: string }[]).map((c) => c.text ?? '').join('\n')
      : rawContent ? String(rawContent) : 'Unknown error';

  const truncated = errorText.length > 300 ? errorText.slice(0, 300) + '...' : errorText;

  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[85%] w-full">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: 'var(--agent-dead)' }}
          />
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: agentColor }}
          >
            {agentName}
          </span>
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: 'var(--agent-dead)' }}
          >
            error
          </span>
        </div>
        <div
          className="px-3 py-2 rounded-sm"
          style={{
            background: 'color-mix(in srgb, var(--agent-dead) 6%, var(--card))',
            borderLeft: '2px solid var(--agent-dead)',
          }}
        >
          <p className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
            {toolLabel(item.toolUse.name, item.toolUse.input)}
          </p>
          {truncated && (
            <pre className="text-[10px] font-mono text-muted-foreground/60 mt-1 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
              {truncated}
            </pre>
          )}
          <button
            className="mt-2 flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-colors hover:opacity-80"
            style={{ color: 'var(--agent-dead)' }}
            onClick={() => {
              // TODO: wire restart mutation
            }}
          >
            <RotateCw className="w-3 h-3" />
            Restart
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Timeline annotation components ──
// Visually lighter than message bubbles — context, not content.
// Mixed density per Attio timeline pattern.

function StatusLine({
  entry,
  agentColor,
}: {
  entry: TimelineEntry;
  agentColor: string;
}) {
  const data = entry.data as { from?: string; to?: string };
  const dotColor = statusDotColor(data.to ?? '');
  const time = formatTime(entry.createdAt);

  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{ background: dotColor, opacity: 0.7 }}
      />
      <span className="text-[9px] font-mono text-muted-foreground/35 truncate">
        {entry.summary ?? (
          <><span style={{ color: agentColor, opacity: 0.5 }}>{entry.agentName}</span>{' is now '}{data.to}</>
        )}
      </span>
      <span className="text-[8px] font-mono text-muted-foreground/20 ml-auto flex-shrink-0">
        {time}
      </span>
    </div>
  );
}

function TaskLine({
  entry,
  agentColor,
}: {
  entry: TimelineEntry;
  agentColor: string;
}) {
  const time = formatTime(entry.createdAt);

  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{ background: agentColor, opacity: 0.4 }}
      />
      <span className="text-[9px] font-mono text-muted-foreground/35 truncate">
        {entry.summary ?? `${entry.agentName} task`}
      </span>
      <span className="text-[8px] font-mono text-muted-foreground/20 ml-auto flex-shrink-0">
        {time}
      </span>
    </div>
  );
}

function SystemLine({
  entry,
  agentColor,
}: {
  entry: TimelineEntry;
  agentColor: string;
}) {
  const time = formatTime(entry.createdAt);

  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{ background: agentColor, opacity: 0.3 }}
      />
      <span className="text-[9px] font-mono text-muted-foreground/30 truncate">
        {entry.summary ?? `${entry.agentName} system event`}
      </span>
      <span className="text-[8px] font-mono text-muted-foreground/20 ml-auto flex-shrink-0">
        {time}
      </span>
    </div>
  );
}

function EventErrorLine({
  entry,
  agentColor,
}: {
  entry: TimelineEntry;
  agentColor: string;
}) {
  const time = formatTime(entry.createdAt);

  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{ background: 'var(--agent-dead)', opacity: 0.7 }}
      />
      <span
        className="text-[9px] font-mono font-bold flex-shrink-0"
        style={{ color: agentColor, opacity: 0.5 }}
      >
        {entry.agentName}
      </span>
      <span
        className="text-[9px] font-mono truncate"
        style={{ color: 'var(--agent-dead)', opacity: 0.4 }}
      >
        {entry.summary ?? 'error'}
      </span>
      <span className="text-[8px] font-mono text-muted-foreground/20 ml-auto flex-shrink-0">
        {time}
      </span>
    </div>
  );
}
