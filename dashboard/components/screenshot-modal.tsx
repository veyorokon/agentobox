'use client';

import { useState, useEffect } from 'react';
import { X, Send } from 'lucide-react';

interface ScreenshotModalProps {
  blob: Blob | null;
  onClose: () => void;
  onSend?: (blob: Blob, caption: string) => void;
}

export function ScreenshotModal({ blob, onClose, onSend }: ScreenshotModalProps) {
  const [caption, setCaption] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [blob]);

  const handleSend = () => {
    if (blob && onSend) {
      onSend(blob, caption);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  if (!blob) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        data-augmented-ui="tl-clip br-clip border"
        className="w-full max-w-2xl bg-surface m-6"
        style={{
          '--aug-tl': '12px',
          '--aug-br': '12px',
          '--aug-border-all': '2px',
          '--aug-border-bg': 'var(--accent)',
        } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-foreground text-sm font-mono font-bold uppercase tracking-wider">
            Screenshot Preview
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="px-5 py-5">
          {previewUrl && (
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="overflow-hidden"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <img
                src={previewUrl}
                alt="Screenshot preview"
                className="w-full h-auto max-h-96 object-contain bg-background"
              />
            </div>
          )}

          {/* Caption input */}
          <div className="mt-4">
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-2">
              Caption (optional)
            </p>
            <div
              data-augmented-ui="tl-clip br-clip border"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a caption..."
                className="w-full bg-transparent text-foreground font-mono text-sm px-3 py-2.5 placeholder:text-muted-foreground focus:outline-none"
                autoFocus
              />
            </div>
            <p className="text-[9px] font-mono text-muted-foreground/50 mt-1.5 px-0.5">
              Cmd+Enter to send &middot; Esc to cancel
            </p>
          </div>
        </div>

        {/* Actions */}
        <div
          className="px-5 py-4 flex items-center justify-end gap-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button
            onClick={onClose}
            data-augmented-ui="tl-clip br-clip border"
            className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-[10px] font-mono font-bold uppercase tracking-wider"
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
            onClick={handleSend}
            data-augmented-ui="tl-clip br-clip border"
            className="px-4 py-2 bg-accent text-accent-foreground hover:opacity-90 transition-opacity text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2"
            style={{
              '--aug-tl': '6px',
              '--aug-br': '6px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'var(--accent)',
            } as React.CSSProperties}
          >
            <Send className="w-3.5 h-3.5" />
            Send to Agent
          </button>
        </div>
      </div>
    </div>
  );
}
