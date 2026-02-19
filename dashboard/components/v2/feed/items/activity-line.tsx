'use client';

import { useState, useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { ToolExpansion, hasToolContent } from '../../tool-expansion';
import { formatToolName, getToolLabel } from '../helpers';
import type { ToolUseDetail } from '@/lib/mock-v2-data';

/** Check if a tool result contains image blocks */
function hasImageBlock(tool: ToolUseDetail): boolean {
  return Array.isArray(tool.result) && tool.result.some((b) => b.type === 'image');
}

interface ActivityLineProps {
  tools: ToolUseDetail[];
  agentName: string;
  agentColor: string;
  expandText?: boolean;
  expandImages?: boolean;
}

export function ActivityLine({
  tools,
  agentName,
  agentColor,
  expandText,
  expandImages,
}: ActivityLineProps) {
  const [listOpen, setListOpen] = useState(true);
  const [localOverrides, setLocalOverrides] = useState<Set<number>>(new Set());
  const [textOpen, setTextOpen] = useState(!!expandText);
  const [imagesOpen, setImagesOpen] = useState(!!expandImages);

  // Sync local state when global toggles change (one-time push, reset overrides)
  const prevExpandText = useRef(expandText);
  const prevExpandImages = useRef(expandImages);
  useEffect(() => {
    let reset = false;
    if (expandText !== prevExpandText.current) {
      setTextOpen(!!expandText);
      prevExpandText.current = expandText;
      reset = true;
    }
    if (expandImages !== prevExpandImages.current) {
      setImagesOpen(!!expandImages);
      prevExpandImages.current = expandImages;
      reset = true;
    }
    if (reset) setLocalOverrides(new Set());
  }, [expandText, expandImages]);

  /** Whether a global toggle wants this tool open */
  const isGloballyExpanded = (tool: ToolUseDetail): boolean => {
    const isImage = hasImageBlock(tool);
    if (textOpen && hasToolContent(tool) && !isImage) return true;
    if (imagesOpen && isImage) return true;
    return false;
  };

  const isExpanded = (tool: ToolUseDetail, index: number): boolean => {
    const globallyOpen = isGloballyExpanded(tool);
    const overridden = localOverrides.has(index);
    if (globallyOpen) return !overridden;
    return overridden;
  };

  const toggleTool = (index: number) => {
    setLocalOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toolCountLabel = `${tools.length} tool${tools.length !== 1 ? 's' : ''}`;

  return (
    <div
      className="px-1 py-0.5"
      style={{ animation: 'msg-enter 0.2s ease-out forwards' }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-1.5 cursor-pointer rounded-sm transition-colors"
        style={{ padding: '1px 0' }}
        onClick={() => {
          setListOpen((v) => !v);
          if (listOpen) setLocalOverrides(new Set());
        }}
      >
        <span
          className="text-[9px] font-mono font-bold flex-shrink-0"
          style={{ color: agentColor, opacity: 0.9 }}
        >
          {agentName}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground/70">
          {listOpen ? '\u25BE' : '\u25B8'} {toolCountLabel}
        </span>
      </div>

      {/* Tool list */}
      {listOpen && (
        <div
          className="ml-3 pl-2 mt-0.5 space-y-0.5"
          style={{
            borderLeft: `1px solid color-mix(in srgb, ${agentColor} 40%, transparent)`,
          }}
        >
          {tools.map((t, i) => {
            const canExpand = hasToolContent(t);
            const expanded = isExpanded(t, i);
            return (
              <div key={i}>
                <div
                  className="flex items-center gap-1.5 min-w-0 rounded-sm transition-colors"
                  style={{
                    cursor: canExpand ? 'pointer' : 'default',
                    background: expanded
                      ? `color-mix(in srgb, ${agentColor} 6%, transparent)`
                      : undefined,
                    padding: '1px 4px',
                    margin: '0 -4px',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canExpand) toggleTool(i);
                  }}
                >
                  <Activity
                    className="w-2.5 h-2.5 flex-shrink-0"
                    style={{ color: agentColor, opacity: 0.7 }}
                  />
                  <span
                    className="text-[9px] font-mono"
                    style={{
                      color: 'var(--muted-foreground)',
                      opacity: canExpand ? 0.8 : 0.7,
                    }}
                  >
                    {formatToolName(t.name)}
                  </span>
                  {getToolLabel(t) && (
                    <span
                      className="text-[9px] font-mono truncate"
                      style={{
                        color: canExpand
                          ? 'var(--foreground)'
                          : 'var(--muted-foreground)',
                        opacity: canExpand ? 0.7 : 0.8,
                      }}
                    >
                      {getToolLabel(t)}
                    </span>
                  )}
                </div>
                {expanded && (
                  <ToolExpansion tool={t} agentColor={agentColor} agentName={agentName} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
