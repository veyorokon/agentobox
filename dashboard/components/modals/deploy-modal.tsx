'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const AVAILABLE_MCPS = [
  { id: 'computer-use', label: 'Computer Use', description: 'Mouse, keyboard, and screenshot control' },
  { id: 'playwright', label: 'Playwright', description: 'Browser automation and testing' },
] as const;

export function DeployModal({
  open,
  onClose,
  onDeploy,
}: {
  open: boolean;
  onClose: () => void;
  onDeploy: (name: string, runtime: string, mcpServers: string[], workspacePath: string, instructions: string) => void;
}) {
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState('modal');
  const [selectedMcps, setSelectedMcps] = useState<string[]>([]);
  const [workspacePath, setWorkspacePath] = useState('');
  const [instructions, setInstructions] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setRuntime('modal');
      setSelectedMcps([]);
      setWorkspacePath('');
      setInstructions('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const toggleMcp = (id: string) => {
    setSelectedMcps((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSubmit = () => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed) return;
    onDeploy(trimmed, runtime, selectedMcps, workspacePath.trim(), instructions.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
        className="relative w-[420px] bg-card"
        style={{
          '--aug-tl': '16px',
          '--aug-tr': '16px',
          '--aug-br': '16px',
          '--aug-bl': '16px',
          '--aug-border-all': '2px',
          '--aug-border-bg': 'var(--accent)',
        } as React.CSSProperties}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-accent font-bold text-xs uppercase tracking-widest">
              Deploy Agent
            </h2>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Name field */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Name
            </label>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="frontend, devops, qa..."
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
            <p className="text-muted-foreground/50 text-[10px] mt-1 pl-1">
              What is this agent responsible for? Teammates use this to route tasks.
            </p>
          </div>

          {/* Runtime field */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Runtime
            </label>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <select
                value={runtime}
                onChange={(e) => setRuntime(e.target.value)}
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="modal">Modal</option>
                <option value="docker">Docker</option>
              </select>
            </div>
          </div>

          {/* Workspace Path */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Workspace Path
            </label>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <input
                type="text"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                placeholder="/path/to/project"
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
            <p className="text-muted-foreground/50 text-[10px] mt-1 pl-1">
              Directory to mount into the container
            </p>
          </div>

          {/* Responsibilities */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Responsibilities
            </label>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Own all Next.js dashboard components, stores, and GraphQL client code. Handle UI/UX changes and frontend tests."
                rows={3}
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none resize-none"
              />
            </div>
            <p className="text-muted-foreground/50 text-[10px] mt-1 pl-1">
              What is this agent responsible for? Injected into its system prompt.
            </p>
          </div>

          {/* MCP Servers */}
          <div className="mb-6">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              MCP Servers
            </label>
            <div className="space-y-2">
              {AVAILABLE_MCPS.map((mcp) => (
                <label
                  key={mcp.id}
                  className="flex items-start gap-3 cursor-pointer group"
                >
                  <div
                    data-augmented-ui="tl-clip br-clip border"
                    className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{
                      '--aug-tl': '4px',
                      '--aug-br': '4px',
                      '--aug-border-all': '1px',
                      '--aug-border-bg': selectedMcps.includes(mcp.id)
                        ? 'var(--accent)'
                        : 'var(--border)',
                      background: selectedMcps.includes(mcp.id)
                        ? 'var(--accent)'
                        : 'transparent',
                    } as React.CSSProperties}
                    onClick={() => toggleMcp(mcp.id)}
                  >
                    {selectedMcps.includes(mcp.id) && (
                      <span className="text-accent-foreground text-[10px] font-bold">
                        &#10003;
                      </span>
                    )}
                  </div>
                  <div onClick={() => toggleMcp(mcp.id)}>
                    <span className="text-foreground font-mono text-sm block">
                      {mcp.label}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {mcp.description}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              data-augmented-ui="tl-clip br-clip border"
              className="px-4 py-2 text-muted-foreground font-bold text-xs uppercase tracking-wider hover:text-foreground transition-colors"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim()}
              data-augmented-ui="tl-clip br-clip border"
              className="px-5 py-2 text-accent-foreground font-bold text-xs uppercase tracking-wider bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              Deploy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
