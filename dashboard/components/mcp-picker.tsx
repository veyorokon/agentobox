'use client';

import { useState } from 'react';
import { Plus, X, Server, Globe } from 'lucide-react';

/** Registry MCP servers — matches backend MCP_REGISTRY keys. */
const REGISTRY_MCPS = [
  { id: 'computer-use', label: 'Computer Use', description: 'Mouse, keyboard, and screenshot control', transport: 'stdio' },
  { id: 'playwright', label: 'Playwright', description: 'Browser automation and testing', transport: 'stdio' },
] as const;

export interface McpSelection {
  id: string;
  label: string;
  description: string;
  transport: string;
  /** If set, this MCP was auto-selected by a skill. */
  requiredBy?: string;
  /** True if this is a custom (non-registry) server. */
  custom?: boolean;
}

export function McpPicker({
  selected,
  onChange,
}: {
  selected: McpSelection[];
  onChange: (mcps: McpSelection[]) => void;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const selectedIds = new Set(selected.map((m) => m.id));

  const toggleRegistry = (mcp: typeof REGISTRY_MCPS[number]) => {
    if (selectedIds.has(mcp.id)) {
      // Don't remove if required by a skill
      const entry = selected.find((m) => m.id === mcp.id);
      if (entry?.requiredBy) return;
      onChange(selected.filter((m) => m.id !== mcp.id));
    } else {
      onChange([...selected, { ...mcp }]);
    }
  };

  const addCustom = () => {
    const value = customInput.trim();
    if (!value) return;

    // Determine transport: URL = SSE, package name = stdio/npx
    const isUrl = value.startsWith('http://') || value.startsWith('https://');
    const id = isUrl ? value : value.replace(/^@/, '').replace(/\//g, '-');
    if (selectedIds.has(id)) return;

    const label = isUrl ? new URL(value).hostname : value;
    const mcp: McpSelection = {
      id,
      label,
      description: isUrl ? value : `npx ${value}`,
      transport: isUrl ? 'sse' : 'stdio',
      custom: true,
    };
    onChange([...selected, mcp]);
    setCustomInput('');
    setShowCustom(false);
  };

  const remove = (id: string) => {
    const entry = selected.find((m) => m.id === id);
    if (entry?.requiredBy) return;
    onChange(selected.filter((m) => m.id !== id));
  };

  return (
    <div className="space-y-2">
      {/* Registry servers */}
      {REGISTRY_MCPS.map((mcp) => {
        const isSelected = selectedIds.has(mcp.id);
        const entry = selected.find((m) => m.id === mcp.id);
        const locked = !!entry?.requiredBy;

        return (
          <label
            key={mcp.id}
            className={`flex items-start gap-3 cursor-pointer group ${locked ? 'opacity-70' : ''}`}
          >
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                '--aug-tl': '4px',
                '--aug-br': '4px',
                '--aug-border-all': '1px',
                '--aug-border-bg': isSelected ? 'var(--accent)' : 'var(--border)',
                background: isSelected ? 'var(--accent)' : 'transparent',
              } as React.CSSProperties}
              onClick={() => toggleRegistry(mcp)}
            >
              {isSelected && (
                <span className="text-accent-foreground text-[10px] font-bold">&#10003;</span>
              )}
            </div>
            <div className="flex-1 min-w-0" onClick={() => toggleRegistry(mcp)}>
              <div className="flex items-center gap-2">
                <span className="text-foreground font-mono text-sm">{mcp.label}</span>
                {entry?.requiredBy && (
                  <span className="text-[9px] font-mono text-accent/60 bg-accent/10 px-1.5 py-0.5 rounded">
                    req&apos;d by {entry.requiredBy}
                  </span>
                )}
              </div>
              <span className="text-muted-foreground text-[10px]">{mcp.description}</span>
            </div>
          </label>
        );
      })}

      {/* Custom selected servers */}
      {selected.filter((m) => m.custom).map((mcp) => (
        <div
          key={mcp.id}
          className="flex items-center gap-3 group"
        >
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            {mcp.transport === 'sse' ? (
              <Globe className="w-3.5 h-3.5 text-accent" />
            ) : (
              <Server className="w-3.5 h-3.5 text-accent" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-foreground font-mono text-sm block truncate">{mcp.label}</span>
            <span className="text-muted-foreground text-[10px] block truncate">{mcp.description}</span>
          </div>
          <button
            onClick={() => remove(mcp.id)}
            className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Add custom */}
      {showCustom ? (
        <div className="flex items-center gap-2 mt-1">
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="flex-1"
            style={{
              '--aug-tl': '6px',
              '--aug-br': '6px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'var(--accent)',
            } as React.CSSProperties}
          >
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
                if (e.key === 'Escape') { setShowCustom(false); setCustomInput(''); }
              }}
              placeholder="@org/mcp-server or https://..."
              className="w-full bg-transparent text-foreground font-mono text-xs px-3 py-2 placeholder:text-muted-foreground/40 focus:outline-none"
              autoFocus
            />
          </div>
          <button
            onClick={addCustom}
            disabled={!customInput.trim()}
            className="text-accent text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-30 transition-opacity"
          >
            Add
          </button>
          <button
            onClick={() => { setShowCustom(false); setCustomInput(''); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCustom(true)}
          className="flex items-center gap-2 text-muted-foreground hover:text-accent text-[10px] font-mono uppercase tracking-wider transition-colors mt-1"
        >
          <Plus className="w-3 h-3" />
          Add custom server
        </button>
      )}
    </div>
  );
}
