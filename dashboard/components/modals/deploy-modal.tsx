'use client';

import { useState, useEffect, useRef } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { McpPicker, type McpSelection } from '@/components/mcp-picker';
import { SecretAttacher } from '@/components/secret-attacher';

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', description: 'Fast, cost-effective' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', description: 'Most capable' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest, lowest cost' },
] as const;

export function DeployModal({
  open,
  onClose,
  onDeploy,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  onDeploy: (name: string, runtime: string, model: string, mcpServers: string[], workspacePath: string, instructions: string, secretGroupIds: string[]) => void;
  projectId: string;
}) {
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState('modal');
  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id);
  const [selectedMcps, setSelectedMcps] = useState<McpSelection[]>([]);
  const [workspacePath, setWorkspacePath] = useState('');
  const [instructions, setInstructions] = useState('');
  const [secretGroupIds, setSecretGroupIds] = useState<string[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  // Track which advanced sections are open
  const [mcpOpen, setMcpOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setRuntime('modal');
      setModel(AVAILABLE_MODELS[0].id);
      setSelectedMcps([]);
      setWorkspacePath('');
      setInstructions('');
      setSecretGroupIds([]);
      setMcpOpen(false);
      setSecretsOpen(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = () => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed) return;
    const mcpIds = selectedMcps.map((m) => m.id);
    onDeploy(trimmed, runtime, model, mcpIds, workspacePath.trim(), instructions.trim(), secretGroupIds);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === 'Enter' && target.tagName !== 'TEXTAREA') {
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />

      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
        className="relative w-[520px] max-h-[85vh] bg-card flex flex-col"
        style={{
          '--aug-tl': '16px',
          '--aug-tr': '16px',
          '--aug-br': '16px',
          '--aug-bl': '16px',
          '--aug-border-all': '2px',
          '--aug-border-bg': 'var(--accent)',
        } as React.CSSProperties}
      >
        <div className="p-6 overflow-y-auto scrollbar-thin flex-1">
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

          {/* Model */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Model
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
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 focus:outline-none appearance-none cursor-pointer"
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.description}
                  </option>
                ))}
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

          {/* ── Advanced: MCP Servers (Collapsible) ── */}
          <div className="border-t border-border/50 pt-3 mt-2">
            <Collapsible open={mcpOpen} onOpenChange={setMcpOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 group">
                <div className="flex items-center gap-2">
                  <ChevronRight
                    className="w-3.5 h-3.5 text-muted-foreground transition-transform duration-200"
                    style={{ transform: mcpOpen ? 'rotate(90deg)' : undefined }}
                  />
                  <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider group-hover:text-foreground transition-colors">
                    MCP Servers
                  </span>
                </div>
                {selectedMcps.length > 0 && (
                  <span className="text-[9px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    {selectedMcps.length}
                  </span>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pl-[22px] pb-3 pt-1">
                  <McpPicker selected={selectedMcps} onChange={setSelectedMcps} />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* TODO: Skills section (depends on backend Phase 2 — SkillTemplate query)
            <Collapsible>
              <CollapsibleTrigger>Skills</CollapsibleTrigger>
              <CollapsibleContent>
                <SkillPicker selected={selectedSkills} onChange={handleSkillsChange} />
              </CollapsibleContent>
            </Collapsible>
            */}

            <Collapsible open={secretsOpen} onOpenChange={setSecretsOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 group">
                <div className="flex items-center gap-2">
                  <ChevronRight
                    className="w-3.5 h-3.5 text-muted-foreground transition-transform duration-200"
                    style={{ transform: secretsOpen ? 'rotate(90deg)' : undefined }}
                  />
                  <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider group-hover:text-foreground transition-colors">
                    Secrets
                  </span>
                </div>
                {secretGroupIds.length > 0 && (
                  <span className="text-[9px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    {secretGroupIds.length}
                  </span>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pl-[22px] pb-3 pt-1">
                  <SecretAttacher
                    projectId={projectId}
                    selectedIds={secretGroupIds}
                    onSelectionChange={setSecretGroupIds}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 mt-2 border-t border-border/30">
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
