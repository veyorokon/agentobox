'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { getAgentColor } from '@/lib/agent-colors';
import type { Agent, TimelineEntry, TimelineEntryType } from '@/types';

// ── Types ──

interface WorkPeriod {
  agentId: string;
  agentName: string;
  startTime: number;
  endTime: number;
  entries: TimelineEntry[];
  summary: string;
  entryTypes: Set<TimelineEntryType>;
}

interface GanttRow {
  agentId: string;
  agent: Agent | null;
  periods: WorkPeriod[];
}

// ── Layout constants ──

const PX_PER_MINUTE = 6;
const GAP_THRESHOLD_MS = 5 * 60_000;
const MIN_BAR_WIDTH = 24;
const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 32;
const LABEL_WIDTH = 140;
const TIME_PAD_MS = 10 * 60_000;

// ── Entry type icons (monospace glyphs) ──

const ENTRY_TYPE_GLYPH: Record<TimelineEntryType, string> = {
  message: 'MSG',
  status: 'STS',
  task: 'TSK',
  system: 'SYS',
  error: 'ERR',
  cost: 'CST',
};

// ── Helpers ──

function formatHHMM(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function buildPeriod(entries: TimelineEntry[]): WorkPeriod {
  const times = entries.map((e) => new Date(e.createdAt).getTime());
  const start = Math.min(...times);
  const end = Math.max(...times, start + 2 * 60_000);
  const summaries = entries
    .map((e) => e.summary)
    .filter((s): s is string => !!s);

  return {
    agentId: entries[0].agentId,
    agentName: entries[0].agentName,
    startTime: start,
    endTime: end,
    entries,
    summary:
      summaries[0] ?? `${entries.length} event${entries.length > 1 ? 's' : ''}`,
    entryTypes: new Set(entries.map((e) => e.entryType)),
  };
}

function clusterEntries(raw: TimelineEntry[]): WorkPeriod[] {
  if (raw.length === 0) return [];
  const sorted = [...raw].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const periods: WorkPeriod[] = [];
  let batch: TimelineEntry[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap =
      new Date(sorted[i].createdAt).getTime() -
      new Date(sorted[i - 1].createdAt).getTime();
    if (gap > GAP_THRESHOLD_MS) {
      periods.push(buildPeriod(batch));
      batch = [];
    }
    batch.push(sorted[i]);
  }
  if (batch.length > 0) periods.push(buildPeriod(batch));
  return periods;
}

// ── Component ──

interface GanttViewProps {
  entries: TimelineEntry[];
  agentsMap: Record<string, Agent>;
  selectedAgentId?: string | null;
}

export function GanttView({
  entries,
  agentsMap,
  selectedAgentId,
}: GanttViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const { rows, timeStart, timeEnd, markers } = useMemo(() => {
    const filtered = selectedAgentId
      ? entries.filter((e) => e.agentId === selectedAgentId)
      : entries;

    if (filtered.length === 0) {
      return { rows: [], timeStart: 0, timeEnd: 0, markers: [] };
    }

    const byAgent = new Map<string, TimelineEntry[]>();
    for (const e of filtered) {
      const list = byAgent.get(e.agentId) ?? [];
      list.push(e);
      byAgent.set(e.agentId, list);
    }

    const rows: GanttRow[] = [];
    for (const [agentId, agentEntries] of byAgent) {
      rows.push({
        agentId,
        agent: agentsMap[agentId] ?? null,
        periods: clusterEntries(agentEntries),
      });
    }

    rows.sort(
      (a, b) =>
        (a.periods[0]?.startTime ?? Infinity) -
        (b.periods[0]?.startTime ?? Infinity),
    );

    let minT = Infinity;
    let maxT = -Infinity;
    for (const r of rows) {
      for (const p of r.periods) {
        if (p.startTime < minT) minT = p.startTime;
        if (p.endTime > maxT) maxT = p.endTime;
      }
    }

    const timeStart = minT - TIME_PAD_MS;
    const timeEnd = maxT + TIME_PAD_MS;

    const first = Math.ceil(timeStart / (15 * 60_000)) * 15 * 60_000;
    const markers: number[] = [];
    for (let t = first; t <= timeEnd; t += 15 * 60_000) markers.push(t);

    return { rows, timeStart, timeEnd, markers };
  }, [entries, agentsMap, selectedAgentId]);

  // Scroll to "now" on mount
  useEffect(() => {
    if (!scrollRef.current || rows.length === 0) return;
    const duration = timeEnd - timeStart;
    if (duration <= 0) return;
    const totalW = Math.max((duration / 60_000) * PX_PER_MINUTE, 600);
    const nowX = ((Date.now() - timeStart) / duration) * totalW;
    const viewW = scrollRef.current.clientWidth;
    scrollRef.current.scrollLeft = Math.max(0, nowX - viewW * 0.7);
  }, [rows.length, timeStart, timeEnd]);

  // Stagger animation trigger
  useEffect(() => {
    if (rows.length > 0) {
      requestAnimationFrame(() => setMounted(true));
    }
  }, [rows.length]);

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground/30 text-[10px] font-mono uppercase tracking-widest mb-1">
            No timeline data
          </p>
          <span className="empty-cursor" />
        </div>
      </div>
    );
  }

  const duration = timeEnd - timeStart;
  const totalW = Math.max((duration / 60_000) * PX_PER_MINUTE, 600);
  const nowMs = Date.now();
  const nowX = ((nowMs - timeStart) / duration) * totalW;
  const showNow = nowMs >= timeStart && nowMs <= timeEnd + TIME_PAD_MS;

  // Track total bar index for staggered animation
  let barIndex = 0;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
      style={
        {
          '--aug-tl': '12px',
          '--aug-tr': '12px',
          '--aug-br': '12px',
          '--aug-bl': '12px',
          '--aug-border-all': '1px',
          '--aug-border-bg': 'var(--border)',
        } as React.CSSProperties
      }
    >
      <div className="flex-1 flex overflow-hidden">
        {/* ── Fixed agent labels ── */}
        <div
          className="flex-shrink-0"
          style={{
            width: LABEL_WIDTH,
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Header spacer */}
          <div
            className="flex items-end px-3 pb-1.5"
            style={{
              height: HEADER_HEIGHT,
              borderBottom: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
            }}
          >
            <span className="text-[8px] font-mono text-muted-foreground/30 uppercase tracking-[0.2em]">
              Agents
            </span>
          </div>

          {rows.map((row, ri) => {
            const color = row.agent
              ? getAgentColor(row.agent.name, row.agent.role)
              : 'var(--muted-foreground)';
            const name = row.agent?.name ?? row.agentId.slice(0, 8);
            const isLead = row.agent?.role === 'lead';

            return (
              <div
                key={row.agentId}
                className="flex items-center gap-2.5 px-3"
                style={{
                  height: ROW_HEIGHT,
                  borderBottom: '1px solid var(--border-subtle)',
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateX(0)' : 'translateX(-8px)',
                  transition: `opacity 0.3s ease ${ri * 60}ms, transform 0.3s ease ${ri * 60}ms`,
                }}
              >
                {/* Status dot with glow */}
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: color,
                    boxShadow: `0 0 6px ${color}, 0 0 2px ${color}`,
                  }}
                />
                {/* Name with role indicator */}
                <div className="flex flex-col min-w-0">
                  <span
                    className="text-[10px] font-mono font-bold uppercase tracking-wider truncate"
                    style={{ color }}
                  >
                    {name}
                  </span>
                  {isLead && (
                    <span
                      className="text-[7px] font-mono uppercase tracking-[0.15em]"
                      style={{
                        color: `color-mix(in srgb, ${color} 50%, var(--muted-foreground))`,
                      }}
                    >
                      lead
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Scrollable timeline ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-auto scrollbar-thin"
          style={{ position: 'relative' }}
        >
          <div
            className="relative"
            style={{
              width: totalW,
              minHeight: HEADER_HEIGHT + rows.length * ROW_HEIGHT,
            }}
          >
            {/* Dot grid background */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage:
                  'radial-gradient(var(--muted-foreground) 0.5px, transparent 0.5px)',
                backgroundSize: '20px 20px',
                opacity: 0.06,
                top: HEADER_HEIGHT,
              }}
            />

            {/* Time header */}
            <div
              className="sticky top-0 z-10"
              style={{
                height: HEADER_HEIGHT,
                borderBottom: '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--background) 90%, transparent)',
                backdropFilter: 'blur(8px)',
              }}
            >
              {markers.map((ms) => {
                const x = ((ms - timeStart) / duration) * totalW;
                return (
                  <div
                    key={ms}
                    className="absolute bottom-0 flex flex-col items-center"
                    style={{ left: x, transform: 'translateX(-50%)' }}
                  >
                    <span className="text-[8px] font-mono text-muted-foreground/40 mb-1 tracking-wider">
                      {formatHHMM(ms)}
                    </span>
                    <span
                      className="w-px"
                      style={{
                        height: 6,
                        background: 'var(--accent)',
                        opacity: 0.3,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Vertical grid lines */}
            {markers.map((ms) => {
              const x = ((ms - timeStart) / duration) * totalW;
              return (
                <div
                  key={`g-${ms}`}
                  className="absolute pointer-events-none"
                  style={{
                    left: x,
                    top: HEADER_HEIGHT,
                    bottom: 0,
                    width: 1,
                    background:
                      'linear-gradient(to bottom, var(--border-subtle), transparent 30%, transparent 70%, var(--border-subtle))',
                  }}
                />
              );
            })}

            {/* Rows + bars */}
            {rows.map((row, ri) => {
              const color = row.agent
                ? getAgentColor(row.agent.name, row.agent.role)
                : 'var(--muted-foreground)';
              const y = HEADER_HEIGHT + ri * ROW_HEIGHT;

              return (
                <div
                  key={row.agentId}
                  className="absolute w-full"
                  style={{
                    top: y,
                    height: ROW_HEIGHT,
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {/* Row tint on hover */}
                  <div
                    className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-100 transition-opacity"
                    style={{
                      background: `color-mix(in srgb, ${color} 3%, transparent)`,
                    }}
                  />

                  {row.periods.map((p, pi) => {
                    const currentBarIndex = barIndex++;
                    const left =
                      ((p.startTime - timeStart) / duration) * totalW;
                    const width = Math.max(
                      ((p.endTime - p.startTime) / duration) * totalW,
                      MIN_BAR_WIDTH,
                    );
                    const hasError = p.entryTypes.has('error');
                    const barColor = hasError ? 'var(--destructive)' : color;

                    return (
                      <div
                        key={pi}
                        className="absolute group"
                        style={{
                          left,
                          width,
                          top: 8,
                          bottom: 8,
                          opacity: mounted ? 1 : 0,
                          transform: mounted
                            ? 'scaleX(1)'
                            : 'scaleX(0)',
                          transformOrigin: 'left center',
                          transition: `opacity 0.4s ease ${currentBarIndex * 50 + 100}ms, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${currentBarIndex * 50 + 100}ms`,
                        }}
                      >
                        {/* augmented-ui bar */}
                        <div
                          data-augmented-ui="tl-clip br-clip border"
                          className="w-full h-full cursor-pointer relative overflow-hidden"
                          style={
                            {
                              '--aug-tl': '5px',
                              '--aug-br': '5px',
                              '--aug-border-all': '1px',
                              '--aug-border-bg': barColor,
                              background: `color-mix(in srgb, ${barColor} 12%, var(--surface))`,
                            } as React.CSSProperties
                          }
                        >
                          {/* Left accent stripe */}
                          <div
                            className="absolute left-0 top-0 bottom-0 w-[2px]"
                            style={{ background: barColor }}
                          />

                          {/* Bar content */}
                          <div className="h-full flex items-center px-2.5 pl-3 overflow-hidden gap-1.5">
                            {/* Entry type tags */}
                            {[...p.entryTypes].slice(0, 2).map((t) => (
                              <span
                                key={t}
                                className="text-[7px] font-mono font-bold tracking-wider flex-shrink-0 px-1 py-px"
                                style={{
                                  color: barColor,
                                  background: `color-mix(in srgb, ${barColor} 15%, transparent)`,
                                }}
                              >
                                {ENTRY_TYPE_GLYPH[t]}
                              </span>
                            ))}

                            <span
                              className="text-[9px] font-mono truncate"
                              style={{
                                color: `color-mix(in srgb, ${barColor} 70%, var(--foreground))`,
                              }}
                            >
                              {p.summary}
                            </span>

                            {p.entries.length > 1 && (
                              <span
                                className="text-[8px] font-mono flex-shrink-0 ml-auto tabular-nums"
                                style={{
                                  color: barColor,
                                  opacity: 0.5,
                                }}
                              >
                                {p.entries.length}
                              </span>
                            )}
                          </div>

                          {/* Shimmer on hover */}
                          <div
                            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                            style={{
                              background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${barColor} 8%, transparent) 50%, transparent)`,
                            }}
                          />
                        </div>

                        {/* Hover tooltip with augmented-ui */}
                        <div
                          className="absolute left-0 z-30 hidden group-hover:block pointer-events-none"
                          style={{ top: 'calc(100% + 4px)' }}
                        >
                          <div
                            data-augmented-ui="tl-clip br-clip border"
                            className="min-w-[160px] max-w-[220px]"
                            style={
                              {
                                '--aug-tl': '6px',
                                '--aug-br': '6px',
                                '--aug-border-all': '1px',
                                '--aug-border-bg': barColor,
                                background: 'var(--popover)',
                                boxShadow: `0 4px 16px rgba(0,0,0,0.4), 0 0 8px color-mix(in srgb, ${barColor} 10%, transparent)`,
                              } as React.CSSProperties
                            }
                          >
                            <div className="p-2.5">
                              {/* Agent name */}
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span
                                  className="w-1 h-1 rounded-full flex-shrink-0"
                                  style={{
                                    background: barColor,
                                    boxShadow: `0 0 4px ${barColor}`,
                                  }}
                                />
                                <span
                                  className="text-[9px] font-mono font-bold uppercase tracking-wider"
                                  style={{ color: barColor }}
                                >
                                  {p.agentName}
                                </span>
                              </div>

                              {/* Time range */}
                              <p className="text-[9px] font-mono text-muted-foreground mb-1">
                                <span style={{ color: barColor, opacity: 0.6 }}>//</span>{' '}
                                {formatHHMM(p.startTime)} — {formatHHMM(p.endTime)}
                              </p>

                              {/* Summary */}
                              <p
                                className="text-[9px] font-mono leading-relaxed mb-1.5"
                                style={{
                                  color: `color-mix(in srgb, ${barColor} 50%, var(--foreground))`,
                                }}
                              >
                                {p.summary}
                              </p>

                              {/* Event count + types */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[8px] font-mono text-muted-foreground/50">
                                  {p.entries.length} event
                                  {p.entries.length > 1 ? 's' : ''}
                                </span>
                                {[...p.entryTypes].map((t) => (
                                  <span
                                    key={t}
                                    className="text-[7px] font-mono font-bold tracking-wider px-1 py-px"
                                    style={{
                                      color: barColor,
                                      background: `color-mix(in srgb, ${barColor} 12%, transparent)`,
                                    }}
                                  >
                                    {ENTRY_TYPE_GLYPH[t]}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Now indicator */}
            {showNow && (
              <div
                className="absolute z-10 pointer-events-none"
                style={{
                  left: nowX,
                  top: 0,
                  bottom: 0,
                }}
              >
                {/* "NOW" label */}
                <div
                  className="absolute"
                  style={{
                    top: 4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                  }}
                >
                  <span
                    className="text-[7px] font-mono font-bold tracking-[0.2em] uppercase px-1.5 py-px"
                    style={{
                      color: 'var(--accent)',
                      background: 'color-mix(in srgb, var(--accent) 10%, var(--background))',
                    }}
                  >
                    Now
                  </span>
                </div>

                {/* Diamond marker */}
                <div
                  className="absolute"
                  style={{
                    top: HEADER_HEIGHT - 4,
                    left: '50%',
                    width: 7,
                    height: 7,
                    background: 'var(--accent)',
                    transform: 'translateX(-50%) rotate(45deg)',
                    boxShadow: '0 0 8px var(--accent), 0 0 16px color-mix(in srgb, var(--accent) 40%, transparent)',
                  }}
                />

                {/* Glowing vertical line */}
                <div
                  className="absolute"
                  style={{
                    top: HEADER_HEIGHT,
                    bottom: 0,
                    left: '50%',
                    width: 1,
                    transform: 'translateX(-50%)',
                    background: 'var(--accent)',
                    opacity: 0.4,
                    boxShadow: '0 0 6px var(--accent), 0 0 2px var(--accent)',
                    animation: 'border-pulse 2s ease-in-out infinite',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mock data for development ──

export function generateMockGanttData(): {
  entries: TimelineEntry[];
  agentsMap: Record<string, Agent>;
} {
  const now = Date.now();

  const mockAgents: Agent[] = [
    {
      id: 'mock-agent-0',
      name: 'team-lead',
      role: 'lead',
      status: 'running',
      vncUrl: '',
      sandboxId: '',
      runtime: 'docker',
      teamName: 'dev',
      sessionId: 's0',
      model: 'claude-opus-4-6',
      cwd: '/workspace',
      permissionMode: 'default',
      mcpServers: {},
      workspacePath: '/workspace',
      instructions: '',
      sessionCostUsd: '1.20',
      capabilities: null,
      createdAt: new Date(now - 120 * 60_000).toISOString(),
    },
    {
      id: 'mock-agent-1',
      name: 'backend',
      role: 'worker',
      status: 'running',
      vncUrl: '',
      sandboxId: '',
      runtime: 'docker',
      teamName: 'dev',
      sessionId: 's1',
      model: 'claude-sonnet-4-5-20250929',
      cwd: '/workspace',
      permissionMode: 'default',
      mcpServers: {},
      workspacePath: '/workspace',
      instructions: '',
      sessionCostUsd: '0.42',
      capabilities: null,
      createdAt: new Date(now - 117 * 60_000).toISOString(),
    },
    {
      id: 'mock-agent-2',
      name: 'frontend',
      role: 'worker',
      status: 'idle',
      vncUrl: '',
      sandboxId: '',
      runtime: 'docker',
      teamName: 'dev',
      sessionId: 's2',
      model: 'claude-sonnet-4-5-20250929',
      cwd: '/workspace',
      permissionMode: 'default',
      mcpServers: {},
      workspacePath: '/workspace',
      instructions: '',
      sessionCostUsd: '0.38',
      capabilities: null,
      createdAt: new Date(now - 114 * 60_000).toISOString(),
    },
    {
      id: 'mock-agent-3',
      name: 'qa',
      role: 'worker',
      status: 'idle',
      vncUrl: '',
      sandboxId: '',
      runtime: 'docker',
      teamName: 'dev',
      sessionId: 's3',
      model: 'claude-sonnet-4-5-20250929',
      cwd: '/workspace',
      permissionMode: 'default',
      mcpServers: {},
      workspacePath: '/workspace',
      instructions: '',
      sessionCostUsd: '0.15',
      capabilities: null,
      createdAt: new Date(now - 74 * 60_000).toISOString(),
    },
  ];

  const agentsMap: Record<string, Agent> = {};
  for (const a of mockAgents) agentsMap[a.id] = a;

  let id = 0;
  const e = (
    agentId: string,
    agentName: string,
    entryType: TimelineEntryType,
    summary: string,
    minsAgo: number,
    data: Record<string, unknown> = {},
  ): TimelineEntry => ({
    id: `mock-${id++}`,
    entryType,
    agentId,
    agentName,
    summary,
    data,
    createdAt: new Date(now - minsAgo * 60_000).toISOString(),
  });

  const entries: TimelineEntry[] = [
    // Team lead — orchestration across the session
    e('mock-agent-0', 'team-lead', 'system', 'Session started', 120),
    e('mock-agent-0', 'team-lead', 'message', 'Dispatch backend tasks', 118, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Starting backend work' }],
    }),
    e('mock-agent-0', 'team-lead', 'message', 'Dispatch frontend tasks', 115, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Starting frontend work' }],
    }),
    e('mock-agent-0', 'team-lead', 'task', 'Review backend PR', 80),
    e('mock-agent-0', 'team-lead', 'message', 'Dispatch QA tasks', 75, {
      role: 'assistant',
      parts: [],
    }),
    e('mock-agent-0', 'team-lead', 'task', 'Review frontend PR', 40),
    e('mock-agent-0', 'team-lead', 'message', 'Final review', 10, {
      role: 'assistant',
      parts: [],
    }),

    // Backend — two work periods with gap
    e('mock-agent-1', 'backend', 'status', 'Agent deployed', 117, {
      from: 'deploying',
      to: 'running',
    }),
    e('mock-agent-1', 'backend', 'message', 'Reading models.py', 115, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Reading models' }],
    }),
    e('mock-agent-1', 'backend', 'message', 'Edit broadcast service', 110, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'Edit',
          input: { file_path: 'services/broadcast.py' },
        },
      ],
    }),
    e('mock-agent-1', 'backend', 'message', 'Fix thread_sensitive', 106, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't2',
          name: 'Edit',
          input: { file_path: 'services/broadcast.py' },
        },
      ],
    }),
    e('mock-agent-1', 'backend', 'message', 'Run tests', 103, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't3',
          name: 'Bash',
          input: { command: 'pytest' },
        },
      ],
    }),
    e('mock-agent-1', 'backend', 'status', 'Agent idle', 100, {
      from: 'running',
      to: 'idle',
    }),
    // Second period
    e('mock-agent-1', 'backend', 'status', 'Agent running', 78, {
      from: 'idle',
      to: 'running',
    }),
    e('mock-agent-1', 'backend', 'message', 'Add migration', 75, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Creating migration' }],
    }),
    e('mock-agent-1', 'backend', 'message', 'Run migration', 72, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't4',
          name: 'Bash',
          input: { command: 'manage.py migrate' },
        },
      ],
    }),
    e('mock-agent-1', 'backend', 'task', 'PR ready for review', 68),
    e('mock-agent-1', 'backend', 'status', 'Agent idle', 66, {
      from: 'running',
      to: 'idle',
    }),

    // Frontend — one long period, then a short polish session
    e('mock-agent-2', 'frontend', 'status', 'Agent deployed', 114, {
      from: 'deploying',
      to: 'running',
    }),
    e('mock-agent-2', 'frontend', 'message', 'Reading chat-view.tsx', 112, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Reviewing existing code' }],
    }),
    e('mock-agent-2', 'frontend', 'message', 'Build GanttView', 108, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't5',
          name: 'Write',
          input: { file_path: 'components/gantt-view.tsx' },
        },
      ],
    }),
    e('mock-agent-2', 'frontend', 'message', 'Add augmented-ui styling', 98, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't6',
          name: 'Edit',
          input: { file_path: 'components/gantt-view.tsx' },
        },
      ],
    }),
    e('mock-agent-2', 'frontend', 'message', 'Add mock data', 88, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't7',
          name: 'Edit',
          input: { file_path: 'components/gantt-view.tsx' },
        },
      ],
    }),
    e('mock-agent-2', 'frontend', 'message', 'Wire time axis', 80, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Adding time markers' }],
    }),
    e('mock-agent-2', 'frontend', 'task', 'Component complete', 70),
    e('mock-agent-2', 'frontend', 'status', 'Agent idle', 68, {
      from: 'running',
      to: 'idle',
    }),
    // Second period — polish
    e('mock-agent-2', 'frontend', 'status', 'Agent running', 38, {
      from: 'idle',
      to: 'running',
    }),
    e('mock-agent-2', 'frontend', 'message', 'Polish hover states', 35, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Final polish' }],
    }),
    e('mock-agent-2', 'frontend', 'message', 'Update types', 30, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't9',
          name: 'Edit',
          input: { file_path: 'types/index.ts' },
        },
      ],
    }),
    e('mock-agent-2', 'frontend', 'status', 'Agent idle', 26, {
      from: 'running',
      to: 'idle',
    }),

    // QA — starts later, one period
    e('mock-agent-3', 'qa', 'status', 'Agent deployed', 74, {
      from: 'deploying',
      to: 'running',
    }),
    e('mock-agent-3', 'qa', 'message', 'Running test suite', 72, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't10',
          name: 'Bash',
          input: { command: 'pytest --tb=short' },
        },
      ],
    }),
    e('mock-agent-3', 'qa', 'message', 'Playwright visual tests', 65, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't11',
          name: 'Bash',
          input: { command: 'npx playwright test' },
        },
      ],
    }),
    e('mock-agent-3', 'qa', 'error', 'Screenshot diff detected', 60, {
      error: 'Visual regression in agent-card',
    }),
    e('mock-agent-3', 'qa', 'message', 'Re-running after fix', 55, {
      role: 'assistant',
      parts: [
        {
          type: 'tool_use',
          id: 't12',
          name: 'Bash',
          input: { command: 'npx playwright test --update-snapshots' },
        },
      ],
    }),
    e('mock-agent-3', 'qa', 'task', 'All tests passing', 50),
    e('mock-agent-3', 'qa', 'status', 'Agent idle', 48, {
      from: 'running',
      to: 'idle',
    }),
  ];

  return { entries, agentsMap };
}
