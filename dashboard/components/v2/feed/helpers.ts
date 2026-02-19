'use client';

import type { ToolUseDetail } from '@/lib/mock-v2-data';

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function statusDotColor(status: string): string {
  switch (status) {
    case 'deploying': return 'var(--agent-deploying)';
    case 'running': return 'var(--agent-active)';
    case 'idle': return 'var(--agent-active)';
    case 'stopped': return 'var(--muted-foreground)';
    case 'error': return 'var(--agent-dead)';
    default: return 'var(--muted-foreground)';
  }
}

export { hasToolContent as hasExpansionData } from '@/components/v2/tool-expansion';

/** Format tool name for display: mcp__server__tool → server:tool */
export function formatToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    if (parts.length >= 3) {
      return `${parts[1]}:${parts.slice(2).join('__')}`;
    }
    return parts[parts.length - 1];
  }
  return name;
}

/** Extract a descriptive label from tool input */
export function getToolLabel(tool: ToolUseDetail): string | undefined {
  // Standard Claude tools
  const std = tool.input?.file_path || tool.input?.command || tool.input?.pattern;
  if (std) return std;

  if (!tool.input) return undefined;

  // computer-use: action + coordinate/text
  if (tool.input.action) {
    const action = tool.input.action as string;
    if (tool.input.coordinate) return `${action} [${tool.input.coordinate}]`;
    if (tool.input.text) {
      const t = tool.input.text as string;
      return `${action} "${t.length > 40 ? t.slice(0, 37) + '...' : t}"`;
    }
    return action;
  }

  // Generic: url, query, or first short string value
  for (const key of ['url', 'query', 'text', 'selector', 'ref', 'key', 'code']) {
    const val = tool.input[key];
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 60 ? val.slice(0, 57) + '...' : val;
    }
  }

  return undefined;
}
