'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, CheckCircle2, Loader } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import type { MockAgent, TimelineTask, TimelineEvent } from '@/lib/mock-v2-data';

const LANE_HEIGHT = 56;
const HEADER_HEIGHT = 28;
const LABEL_WIDTH = 90;
const PX_PER_MIN = 20;

export function SwimLanes() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    text: string;
    sub?: string;
    color: string;
    x: number;
    y: number;
  } | null>(null);

  const selectedAgentId = useDashboardStore((s) => s.selectedAgentId);
  const setScrollToFeedId = useDashboardStore((s) => s.setScrollToFeedId);

  const agents = useAgentsStore((s) => s.sortedAgents);
  const colorMap = useAgentsStore((s) => s.agentColors);
  const { tasks, events } = useFeedStore((s) => s.timeline);
  const feedItems = useFeedStore((s) => s.items);

  // Time range from data
  const timeRange = useMemo(() => {
    const allMins = [
      ...tasks.map((t) => t.startMinsAgo),
      ...events.map((e) => e.minsAgo),
      45,
    ];
    const span = Math.ceil(Math.max(...allMins) / 5) * 5;
    return { span, startMs: Date.now() - span * 60_000, endMs: Date.now() };
  }, [tasks, events]);

  const totalWidth = timeRange.span * PX_PER_MIN;

  const minsToX = useCallback(
    (minsAgo: number) => (timeRange.span - minsAgo) * PX_PER_MIN,
    [timeRange]
  );

  // Time labels — absolute
  const timeLabels = useMemo(() => {
    const labels: { px: number; label: string }[] = [];
    const interval = timeRange.span <= 30 ? 5 : 10;
    for (let m = 0; m <= timeRange.span; m += interval) {
      const d = new Date(Date.now() - m * 60_000);
      labels.push({
        px: (timeRange.span - m) * PX_PER_MIN,
        label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
    }
    return labels;
  }, [timeRange]);

  // Group by agent
  const tasksByAgent = useMemo(() => {
    const map = new Map<string, TimelineTask[]>();
    for (const agent of agents) map.set(agent.id, []);
    for (const task of tasks) map.get(task.agentId)?.push(task);
    return map;
  }, [tasks, agents]);

  const eventsByAgent = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const agent of agents) map.set(agent.id, []);
    for (const event of events) map.get(event.agentId)?.push(event);
    return map;
  }, [events, agents]);

  // Handle task click — find closest feed item and scroll to it
  const handleTaskClick = useCallback(
    (task: TimelineTask) => {
      const targetMinsAgo = task.endMinsAgo ?? task.startMinsAgo;
      let closest: { id: string; diff: number } | null = null;
      for (const item of feedItems) {
        if (item.agentId !== task.agentId) continue;
        const diff = Math.abs(item.minsAgo - targetMinsAgo);
        if (!closest || diff < closest.diff) {
          closest = { id: item.id, diff };
        }
      }
      if (closest) setScrollToFeedId(closest.id);
    },
    [feedItems, setScrollToFeedId]
  );

  // Auto-scroll to right (NOW) on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Timeline body */}
      <div
        className="flex-1 overflow-hidden relative"
        data-augmented-ui="tl-clip br-clip border"
        style={{
          '--aug-tl': '8px',
          '--aug-br': '8px',
          '--aug-border-all': '1px',
          '--aug-border-bg': 'var(--border)',
        } as React.CSSProperties}
      >
        {/* Dot grid background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(var(--muted-foreground) 0.5px, transparent 0.5px)',
            backgroundSize: '16px 16px',
            opacity: 0.06,
          }}
        />

        {/* Scan line overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(128,128,128,0.015) 2px, rgba(128,128,128,0.015) 4px)',
          }}
        />

        <div className="flex h-full">
          {/* Fixed agent label column */}
          <div className="flex-shrink-0 z-10" style={{ width: LABEL_WIDTH }}>
            <div style={{ height: HEADER_HEIGHT, borderBottom: '1px solid var(--border-subtle)' }} />
            {agents.map((agent, idx) => {
              const color = colorMap[agent.id] ?? 'var(--muted-foreground)';
              const isSelected = selectedAgentId === null || selectedAgentId === agent.id;
              const isHighlighted = selectedAgentId === agent.id;

              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-1.5 px-3 transition-opacity duration-300"
                  style={{
                    height: LANE_HEIGHT,
                    opacity: isSelected ? 1 : 0.25,
                    borderBottom: idx < agents.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    background: isHighlighted ? `color-mix(in srgb, ${color} 5%, transparent)` : 'transparent',
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: color,
                      boxShadow: agent.status === 'running' ? `0 0 4px ${color}` : 'none',
                    }}
                  />
                  <span
                    className="text-[9px] font-mono font-medium truncate"
                    style={{ color: isHighlighted ? color : 'var(--muted-foreground)' }}
                  >
                    {agent.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Scrollable timeline */}
          <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
            <div style={{ width: totalWidth, minWidth: '100%', position: 'relative' }}>
              {/* Time header */}
              <div
                className="relative"
                style={{ height: HEADER_HEIGHT, borderBottom: '1px solid var(--border-subtle)' }}
              >
                {timeLabels.map((label, i) => (
                  <span
                    key={i}
                    className="absolute text-[8px] font-mono text-muted-foreground/40 -translate-x-1/2 tabular-nums"
                    style={{ left: label.px, top: 8 }}
                  >
                    {label.label}
                  </span>
                ))}
              </div>

              {/* Agent lanes */}
              {agents.map((agent, idx) => {
                const color = colorMap[agent.id] ?? 'var(--muted-foreground)';
                const agentTasks = tasksByAgent.get(agent.id) || [];
                const agentEvents = eventsByAgent.get(agent.id) || [];
                const isSelected = selectedAgentId === null || selectedAgentId === agent.id;
                const isHighlighted = selectedAgentId === agent.id;

                return (
                  <div
                    key={agent.id}
                    className="relative transition-opacity duration-300"
                    style={{
                      height: LANE_HEIGHT,
                      opacity: isSelected ? 1 : 0.25,
                      borderBottom: idx < agents.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      background: isHighlighted
                        ? `color-mix(in srgb, ${color} 5%, transparent)`
                        : idx % 2 === 1
                          ? 'color-mix(in srgb, var(--foreground) 1.5%, transparent)'
                          : 'transparent',
                    }}
                  >
                    {/* Vertical grid lines */}
                    {timeLabels.map((label, i) => (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 w-px"
                        style={{ left: label.px, background: 'var(--border-subtle)' }}
                      />
                    ))}

                    {/* Center baseline */}
                    <div
                      className="absolute left-0 right-0"
                      style={{
                        top: '50%',
                        height: '1px',
                        background: `color-mix(in srgb, ${color} 6%, transparent)`,
                      }}
                    />

                    {/* Task blocks */}
                    {agentTasks.map((task) => {
                      const startX = minsToX(task.startMinsAgo);
                      const endX = minsToX(task.endMinsAgo ?? 0);
                      const w = Math.max(endX - startX, 8);
                      const isActive = task.status === 'in_progress';
                      const pillH = 32;

                      return (
                        <div
                          key={task.id}
                          className="absolute flex items-center gap-1.5 cursor-pointer group"
                          style={{
                            left: startX,
                            width: w,
                            top: '50%',
                            height: pillH,
                            marginTop: -pillH / 2,
                            background: isActive
                              ? `color-mix(in srgb, ${color} 12%, var(--surface))`
                              : `color-mix(in srgb, ${color} 15%, var(--surface))`,
                            border: `1px solid color-mix(in srgb, ${color} ${isActive ? 50 : 30}%, transparent)`,
                            borderRadius: '6px',
                            paddingLeft: 8,
                            paddingRight: 8,
                            overflow: 'hidden',
                            animation: isActive ? 'block-breathe 2.5s ease-in-out infinite' : 'none',
                            transition: 'background 0.15s, border-color 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            const dur = task.startMinsAgo - (task.endMinsAgo ?? 0);
                            setTooltip({
                              text: task.subject,
                              sub: isActive ? 'In progress' : `${dur}m \u00B7 completed`,
                              color,
                              x: e.clientX,
                              y: e.clientY,
                            });
                          }}
                          onMouseMove={(e) => {
                            setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
                          }}
                          onMouseLeave={() => setTooltip(null)}
                          onClick={() => handleTaskClick(task)}
                        >
                          {/* Status icon */}
                          {isActive ? (
                            <Loader
                              className="w-3 h-3 flex-shrink-0 animate-spin"
                              style={{ color, animationDuration: '3s' }}
                            />
                          ) : (
                            <CheckCircle2
                              className="w-3 h-3 flex-shrink-0 opacity-50"
                              style={{ color }}
                            />
                          )}

                          {/* Task label */}
                          <span
                            className="text-[9px] font-mono font-medium truncate leading-none"
                            style={{ color: `color-mix(in srgb, ${color} 85%, var(--foreground))` }}
                          >
                            {w > 80 ? task.subject : task.activeForm}
                          </span>

                          {/* Breathing right edge for active tasks */}
                          {isActive && (
                            <div
                              className="absolute top-0 bottom-0 w-1"
                              style={{
                                right: 0,
                                borderRadius: '0 6px 6px 0',
                                background: color,
                                opacity: 0.5,
                                animation: 'block-breathe 2.5s ease-in-out infinite',
                              }}
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* Point events */}
                    {agentEvents.map((event) => {
                      const x = minsToX(event.minsAgo);

                      if (event.kind === 'error') {
                        const size = 12;
                        return (
                          <div
                            key={event.id}
                            className="absolute cursor-pointer z-10"
                            style={{
                              left: x - size / 2,
                              top: '50%',
                              marginTop: -size / 2 - 6,
                            }}
                            onMouseEnter={(e) =>
                              setTooltip({ text: event.summary, color: 'var(--destructive)', x: e.clientX, y: e.clientY })
                            }
                            onMouseMove={(e) =>
                              setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)
                            }
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <div
                              style={{
                                width: size,
                                height: size,
                                background: 'var(--destructive)',
                                borderRadius: '2px',
                                transform: 'rotate(45deg)',
                                boxShadow: '0 0 8px var(--destructive), 0 0 3px var(--destructive)',
                              }}
                            />
                            <div
                              className="absolute"
                              style={{
                                left: '50%',
                                top: size + 2,
                                width: '1px',
                                height: 10,
                                marginLeft: '-0.5px',
                                background: 'var(--destructive)',
                                opacity: 0.3,
                              }}
                            />
                          </div>
                        );
                      }

                      if (event.kind === 'message') {
                        return (
                          <div
                            key={event.id}
                            className="absolute cursor-pointer z-5"
                            style={{
                              left: x - 4,
                              top: '50%',
                              marginTop: 10,
                            }}
                            onMouseEnter={(e) =>
                              setTooltip({ text: event.summary, color: 'var(--accent)', x: e.clientX, y: e.clientY })
                            }
                            onMouseMove={(e) =>
                              setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)
                            }
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <MessageSquare
                              className="w-[9px] h-[9px]"
                              style={{ color: 'var(--accent)', opacity: 0.6 }}
                            />
                          </div>
                        );
                      }

                      // status event — small dot below baseline
                      return (
                        <div
                          key={event.id}
                          className="absolute"
                          style={{
                            left: x - 2.5,
                            top: '50%',
                            marginTop: 12,
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: color,
                            opacity: 0.3,
                          }}
                          onMouseEnter={(e) =>
                            setTooltip({ text: `${event.agentName}: ${event.summary}`, color, x: e.clientX, y: e.clientY })
                          }
                          onMouseMove={(e) =>
                            setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)
                          }
                          onMouseLeave={() => setTooltip(null)}
                        />
                      );
                    })}
                  </div>
                );
              })}

              {/* NOW indicator */}
              <div
                className="absolute z-10"
                style={{ right: 0, top: 0, bottom: 0, width: '2px' }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    width: '12px',
                    right: '-5px',
                    background:
                      'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 15%, transparent), transparent)',
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'var(--accent)',
                    opacity: 0.8,
                    animation: 'border-pulse 2s ease-in-out infinite',
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    top: HEADER_HEIGHT - 5,
                    left: '50%',
                    width: 8,
                    height: 8,
                    marginLeft: -4,
                    background: 'var(--accent)',
                    transform: 'rotate(45deg)',
                    boxShadow: '0 0 8px var(--accent)',
                  }}
                />
                <span
                  className="absolute text-[7px] font-mono font-bold uppercase tracking-widest"
                  style={{
                    color: 'var(--accent)',
                    bottom: 6,
                    right: 6,
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    letterSpacing: '0.15em',
                  }}
                >
                  NOW
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="px-3 py-2 max-w-[220px]"
            style={{
              '--aug-tl': '6px',
              '--aug-br': '6px',
              '--aug-border-all': '1px',
              '--aug-border-bg': tooltip.color,
              background: 'var(--popover)',
            } as React.CSSProperties}
          >
            <p className="text-[11px] font-mono text-foreground/90 leading-snug">
              {tooltip.text}
            </p>
            {tooltip.sub && (
              <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">
                {tooltip.sub}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
