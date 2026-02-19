'use client';

import { useState, useMemo, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import { generateMockFileTree } from '@/lib/mock-v2-data';
import type { FileTreeNode, FileTreeStats } from '@/lib/mock-v2-data';

export function FileTree() {
  const setScrollToFeedId = useDashboardStore((s) => s.setScrollToFeedId);

  const feedItems = useFeedStore((s) => s.items);
  const colorMap = useAgentsStore((s) => s.agentColors);

  const { tree, stats } = useMemo(() => generateMockFileTree(feedItems), [feedItems]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const handleFileClick = useCallback(
    (path: string) => {
      setSelectedPath(path);
      // Find the most recent feed item that touches this file
      let bestItem: { id: string; minsAgo: number } | null = null;
      for (const item of feedItems) {
        if (item.kind !== 'activity' || !item.tools) continue;
        const touchesFile = item.tools.some((t) => t.input?.file_path === path);
        if (touchesFile && (!bestItem || item.minsAgo < bestItem.minsAgo)) {
          bestItem = { id: item.id, minsAgo: item.minsAgo };
        }
      }
      if (bestItem) setScrollToFeedId(bestItem.id);
    },
    [feedItems, setScrollToFeedId]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Stats bar (L0) */}
      <StatsBar stats={stats} />

      {/* Tree body */}
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

        <div className="relative h-full overflow-y-auto scrollbar-thin p-2">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onFileClick={handleFileClick}
              colorMap={colorMap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatsBar({ stats }: { stats: FileTreeStats }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1 flex-shrink-0">
      <span className="text-[9px] font-mono text-muted-foreground/50 tabular-nums">
        {stats.totalFiles} file{stats.totalFiles !== 1 ? 's' : ''}
      </span>
      <Dot />
      <span className="text-[9px] font-mono text-muted-foreground/50 tabular-nums">
        {stats.agentCount} agent{stats.agentCount !== 1 ? 's' : ''}
      </span>
      {stats.conflictCount > 0 && (
        <>
          <Dot />
          <span
            className="text-[9px] font-mono font-bold tabular-nums"
            style={{ color: 'var(--destructive)' }}
          >
            {stats.conflictCount} conflict{stats.conflictCount !== 1 ? 's' : ''}
          </span>
        </>
      )}
      <Dot />
      <span className="text-[9px] font-mono text-muted-foreground/50 tabular-nums">
        {stats.totalEdits} edit{stats.totalEdits !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function Dot() {
  return <span className="text-[6px] text-muted-foreground/20">{'\u00B7'}</span>;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onFileClick,
  colorMap,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onFileClick: (path: string) => void;
  colorMap: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 w-full text-left py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <span className="text-[9px] font-mono text-muted-foreground/40 w-3 flex-shrink-0 text-center select-none">
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
          <span className="text-[9px] font-mono text-muted-foreground/60 truncate">
            {node.name}/
          </span>
          {node.hasConflict && (
            <AlertTriangle
              className="w-2.5 h-2.5 flex-shrink-0"
              style={{ color: 'var(--destructive)', opacity: 0.5 }}
            />
          )}
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onFileClick={onFileClick}
                colorMap={colorMap}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  return (
    <button
      onClick={() => onFileClick(node.path)}
      className="flex items-center gap-1.5 w-full text-left py-0.5 pr-2 transition-colors group"
      style={{
        paddingLeft: depth * 12 + 4 + 16,
        background: isSelected
          ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
          : undefined,
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <span
        className="text-[9px] font-mono truncate flex-shrink-0"
        style={{
          color: isSelected ? 'var(--accent)' : 'var(--foreground)',
          opacity: isSelected ? 1 : 0.8,
        }}
      >
        {node.name}
      </span>

      {node.isNew && (
        <span
          className="text-[7px] font-mono font-bold uppercase tracking-wider flex-shrink-0 px-1 rounded-sm"
          style={{
            color: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          }}
        >
          new
        </span>
      )}

      {node.hasConflict && (
        <AlertTriangle
          className="w-2.5 h-2.5 flex-shrink-0"
          style={{ color: 'var(--destructive)', opacity: 0.7 }}
        />
      )}

      {/* Agent badges */}
      <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
        {node.agents?.map((agent) => {
          const color = colorMap[agent.agentId] ?? 'var(--muted-foreground)';
          return (
            <span key={agent.agentId} className="flex items-center gap-0.5">
              <span
                className="w-1 h-1 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
              <span
                className="text-[7px] font-mono tabular-nums"
                style={{ color, opacity: 0.7 }}
              >
                {agent.agentName}
              </span>
              {agent.editCount > 1 && (
                <span
                  className="text-[7px] font-mono tabular-nums"
                  style={{ color, opacity: 0.4 }}
                >
                  {'\u00D7'}{agent.editCount}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </button>
  );
}
