'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function DeployModal({
  open,
  onClose,
  onDeploy,
}: {
  open: boolean;
  onClose: () => void;
  onDeploy: (name: string, goalText: string, contextPath: string) => void;
}) {
  const [name, setName] = useState('');
  const [goalText, setGoalText] = useState('');
  const [contextPath, setContextPath] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setGoalText('');
      setContextPath('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = () => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed || !goalText.trim()) return;
    onDeploy(trimmed, goalText.trim(), contextPath.trim());
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
                placeholder="scout"
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
            <p className="text-muted-foreground/50 text-[10px] mt-1 pl-1">
              Lowercase, no spaces
            </p>
          </div>

          {/* Goal field */}
          <div className="mb-4">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Goal
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
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="Investigate the auth module..."
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
          </div>

          {/* Context path field */}
          <div className="mb-6">
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider block mb-1.5">
              Context Path{' '}
              <span className="text-muted-foreground/30">(optional)</span>
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
                value={contextPath}
                onChange={(e) => setContextPath(e.target.value)}
                placeholder="/workspace/project"
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground/40 focus:outline-none"
              />
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
              disabled={!name.trim() || !goalText.trim()}
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
