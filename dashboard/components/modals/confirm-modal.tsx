'use client';

import { useEffect } from 'react';

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const borderColor = destructive ? 'var(--destructive)' : 'var(--accent)';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />

      <div
        onClick={(e) => e.stopPropagation()}
        data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
        className="relative w-[360px] bg-card"
        style={{
          '--aug-tl': '14px',
          '--aug-tr': '14px',
          '--aug-br': '14px',
          '--aug-bl': '14px',
          '--aug-border-all': '2px',
          '--aug-border-bg': borderColor,
        } as React.CSSProperties}
      >
        <div className="p-6">
          <h2
            className="font-bold text-xs uppercase tracking-widest mb-3"
            style={{ color: borderColor }}
          >
            {title}
          </h2>
          <p className="text-foreground text-sm leading-relaxed mb-6">
            {message}
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onCancel}
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
              onClick={onConfirm}
              data-augmented-ui="tl-clip br-clip border"
              className="px-5 py-2 font-bold text-xs uppercase tracking-wider"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '2px',
                '--aug-border-bg': borderColor,
                background: borderColor,
                color: 'var(--background)',
              } as React.CSSProperties}
            >
              {confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
