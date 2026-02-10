'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent } from '@/types';

const SPINNER_WORDS = [
  'Moseying', 'Tinkering', 'Spelunking', 'Pondering', 'Cogitating',
  'Ruminating', 'Deliberating', 'Noodling', 'Percolating', 'Marinating',
  'Brainstorming', 'Daydreaming', 'Contemplating', 'Meditating', 'Reflecting',
  'Mulling', 'Considering', 'Analyzing', 'Investigating', 'Exploring',
  'Researching', 'Examining', 'Sifting', 'Parsing', 'Decoding',
  'Unraveling', 'Assembling', 'Crafting', 'Constructing', 'Forging',
  'Shaping', 'Sculpting', 'Polishing', 'Refining', 'Honing',
  'Calibrating', 'Tuning', 'Tweaking', 'Configuring', 'Wiring',
  'Plumbing', 'Weaving', 'Stitching', 'Connecting', 'Bridging',
  'Patching', 'Debugging', 'Diagnosing', 'Dissecting', 'Restructuring',
  'Sorting', 'Mapping', 'Charting', 'Sketching', 'Composing',
  'Orchestrating', 'Synthesizing', 'Harmonizing', 'Plotting', 'Drafting',
  'Compiling', 'Computing', 'Processing', 'Crunching', 'Distilling',
  'Fermenting', 'Brewing', 'Concocting', 'Conjuring', 'Summoning',
  'Channeling', 'Focusing', 'Concentrating', 'Zooming', 'Scanning',
  'Sweeping', 'Scouting', 'Surveying', 'Prospecting', 'Excavating',
  'Mining', 'Digging', 'Burrowing', 'Tunneling', 'Navigating',
  'Traversing', 'Wandering', 'Meandering', 'Adventuring', 'Questing',
];

interface MessageComposerProps {
  agent: Agent;
}

export function MessageComposer({ agent }: MessageComposerProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const [selectedChip, setSelectedChip] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextAttachId = useRef(0);

  const [, sendMessageMut] = useMutation(SEND_MESSAGE_MUTATION);

  const addImages = useCallback((files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...imgs.map((file) => ({
        id: `att-${nextAttachId.current++}`,
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => {
        const att = prev.find((a) => a.id === id);
        if (att) URL.revokeObjectURL(att.url);
        const next = prev.filter((a) => a.id !== id);
        if (selectedChip >= next.length) setSelectedChip(next.length - 1);
        if (next.length === 0) {
          setSelectedChip(-1);
          inputRef.current?.focus();
        }
        return next;
      });
    },
    [selectedChip]
  );

  const handleChipKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (attachments.length === 0) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setSelectedChip((i) => Math.max(0, i - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (selectedChip >= attachments.length - 1) {
            setSelectedChip(-1);
            inputRef.current?.focus();
          } else {
            setSelectedChip((i) => i + 1);
          }
          break;
        case 'ArrowDown':
        case 'Escape':
          e.preventDefault();
          setSelectedChip(-1);
          inputRef.current?.focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          removeAttachment(attachments[selectedChip].id);
          break;
      }
    },
    [attachments, selectedChip, removeAttachment]
  );

  useEffect(() => {
    if (selectedChip >= 0 && chipRowRef.current) {
      const chips = chipRowRef.current.querySelectorAll<HTMLElement>('[data-chip]');
      chips[selectedChip]?.focus();
    }
  }, [selectedChip]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addImages(e.dataTransfer.files);
      }
    },
    [addImages]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;

    let fullMessage = text;
    if (attachments.length > 0) {
      const token = localStorage.getItem('auth-token');
      const backendUrl = (process.env.NEXT_PUBLIC_GRAPHQL_HTTP ?? 'http://localhost:8000/graphql').replace('/graphql', '');
      const uploadedPaths: string[] = [];
      for (const att of attachments) {
        try {
          const form = new FormData();
          form.append('file', att.file);
          const res = await fetch(`${backendUrl}/agents/${agent.id}/upload`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
          });
          if (res.ok) {
            const data = await res.json();
            uploadedPaths.push(data.path);
          }
        } catch {
          // Skip failed uploads
        }
      }
      if (uploadedPaths.length > 0) {
        fullMessage = `${text}\n\n[Attached images — file paths on container]\n${uploadedPaths.join('\n')}`;
      }
    }

    setInput('');
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.url));
      return [];
    });
    setSelectedChip(-1);

    try {
      await logger.withSpan('sendMessage', () =>
        sendMessageMut({
          input: {
            agentId: agent.id,
            message: fullMessage,
          },
        }).then(({ error }) => {
          if (error) throw error;
        })
      );
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'ArrowUp' && attachments.length > 0) {
      e.preventDefault();
      setSelectedChip(attachments.length - 1);
    }
    if (
      e.key === 'ArrowLeft' &&
      attachments.length > 0 &&
      e.currentTarget.selectionStart === 0
    ) {
      e.preventDefault();
      setSelectedChip(attachments.length - 1);
    }
    if (
      e.key === 'ArrowRight' &&
      attachments.length > 0 &&
      e.currentTarget.selectionStart === e.currentTarget.value.length
    ) {
      e.preventDefault();
      setSelectedChip(0);
    }
  };

  const statusColor = STATUS_COLOR_VAR[agent.status];
  const inputBorderColor = statusColor;
  const inputAccentColor = statusColor;

  return (
    <div
      className="px-5 pb-5 pt-2"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      {isDragging && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded"
          style={{
            background: 'rgba(0,0,0,0.6)',
            border: `2px dashed ${inputAccentColor}`,
            margin: '4px',
          }}
        >
          <span
            className="text-xs font-mono font-bold uppercase tracking-wider"
            style={{ color: inputAccentColor }}
          >
            Drop images here
          </span>
        </div>
      )}

      {agent.status === 'running' ? (
        <AgentStatusLine agent={agent} />
      ) : (
        <div className="flex items-center gap-2 mb-1.5 px-1">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: statusColor }}
          />
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: statusColor }}
          >
            {agent.name} — {agent.status}
          </span>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-1.5">
          <div
            ref={chipRowRef}
            className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1"
            style={{ scrollbarWidth: 'thin' }}
          >
            {attachments.map((att, i) => {
              const isSelected = selectedChip === i;
              return (
                <div
                  key={att.id}
                  data-chip
                  tabIndex={0}
                  onKeyDown={handleChipKeyDown}
                  onClick={() => setSelectedChip(i)}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded flex-shrink-0 cursor-pointer transition-all"
                  style={{
                    background: isSelected
                      ? `color-mix(in srgb, ${inputAccentColor} 15%, transparent)`
                      : 'var(--surface-inset)',
                    border: `1.5px solid ${isSelected ? inputAccentColor : 'var(--border)'}`,
                    outline: 'none',
                    boxShadow: isSelected
                      ? `0 0 8px color-mix(in srgb, ${inputAccentColor} 30%, transparent)`
                      : 'none',
                  }}
                >
                  <img
                    src={att.url}
                    alt={`Image ${i + 1}`}
                    className="rounded-sm object-cover flex-shrink-0"
                    style={{ width: 28, height: 28 }}
                  />
                  <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                    Image #{i + 1}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAttachment(att.id);
                    }}
                    className="w-4 h-4 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[8px] font-mono text-muted-foreground/40 px-0.5 mt-0.5">
            up to select &middot; left/right to navigate &middot; Delete to remove
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addImages(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="flex items-center gap-2">
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="flex-1"
          style={{
            '--aug-tl': '8px',
            '--aug-br': '8px',
            '--aug-border-all': '1px',
            '--aug-border-bg': inputBorderColor,
          } as React.CSSProperties}
        >
          <div className="flex items-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="pl-2 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title="Attach images"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <span
              className="font-mono text-sm pl-3 select-none font-bold"
              style={{ color: inputAccentColor }}
            >
              &gt;
            </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agent.name}...`}
              className="w-full bg-transparent text-foreground font-mono text-sm px-2 py-2.5 placeholder:text-muted-foreground placeholder:select-none focus:outline-none selection:bg-accent/20 selection:text-foreground"
            />
          </div>
        </div>
        <button
          onClick={handleSend}
          data-augmented-ui="tl-clip br-clip border"
          className="w-9 h-9 flex items-center justify-center transition-colors"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '1px',
            '--aug-border-bg': inputBorderColor,
            color: inputAccentColor,
          } as React.CSSProperties}
          title="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function AgentStatusLine({ agent }: { agent: Agent }) {
  const [spinnerWord, setSpinnerWord] = useState(() =>
    SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
  );

  const spinnerIntervalRef = useRef(3500 + Math.random() * 1000);
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerWord(
        SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
      );
    }, spinnerIntervalRef.current);
    return () => clearInterval(interval);
  }, []);

  const statusColor = STATUS_COLOR_VAR[agent.status];

  return (
    <div
      className="flex items-center gap-2 mb-1.5 px-1 overflow-hidden"
      style={{ animation: 'msg-enter 0.2s ease-out forwards' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          background: statusColor,
          boxShadow: `0 0 6px ${statusColor}`,
          animation: 'border-pulse 2s ease-in-out infinite',
        }}
      />
      <span
        className="text-[9px] font-mono font-bold tracking-wider flex-shrink-0"
        style={{ color: statusColor }}
      >
        {spinnerWord}...
      </span>
    </div>
  );
}
