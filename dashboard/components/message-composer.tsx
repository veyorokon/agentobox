'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Paperclip, X, ChevronDown } from 'lucide-react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { getAgentColor } from '@/lib/agent-colors';
import { useAgentsStore } from '@/stores/agents';
import { SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import type { Agent } from '@/types';

interface MessageComposerProps {
  agents: Agent[];
  selectedAgentId: string | null;
}

export function MessageComposer({ agents, selectedAgentId }: MessageComposerProps) {
  const setSelectedAgent = useAgentsStore((s) => s.setSelectedAgent);
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const [selectedChip, setSelectedChip] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const nextAttachId = useRef(0);

  const [, sendMessageMut] = useMutation(SEND_MESSAGE_MUTATION);

  // Close picker on outside click
  useEffect(() => {
    if (!showTargetPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowTargetPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTargetPicker]);

  const targetAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const targetColor = targetAgent
    ? getAgentColor(targetAgent.name, targetAgent.role)
    : 'var(--accent)';

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

  const buildFullMessage = async (text: string): Promise<string> => {
    if (attachments.length === 0) return text;

    const token = localStorage.getItem('auth-token');
    const backendUrl = (
      process.env.NEXT_PUBLIC_GRAPHQL_HTTP ?? 'http://localhost:8000/graphql'
    ).replace('/graphql', '');
    const uploadTargetId = selectedAgentId ?? agents[0]?.id;
    if (!uploadTargetId) return text;

    const uploadedPaths: string[] = [];
    for (const att of attachments) {
      try {
        const form = new FormData();
        form.append('file', att.file);
        const res = await fetch(`${backendUrl}/agents/${uploadTargetId}/upload`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (res.ok) {
          const data = await res.json();
          uploadedPaths.push(data.path);
        }
      } catch {
        // skip failed uploads
      }
    }

    if (uploadedPaths.length > 0) {
      return `${text}\n\n[Attached images — file paths on container]\n${uploadedPaths.join('\n')}`;
    }
    return text;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || agents.length === 0) return;

    const fullMessage = await buildFullMessage(text);

    setInput('');
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.url));
      return [];
    });
    setSelectedChip(-1);

    // Send to specific agent, or broadcast to all
    const targets = selectedAgentId
      ? [selectedAgentId]
      : agents.map((a) => a.id);

    try {
      await logger.withSpan('sendMessage', async () => {
        for (const agentId of targets) {
          const { error } = await sendMessageMut({
            input: { agentId, message: fullMessage },
          });
          if (error) throw error;
        }
      });
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

  if (agents.length === 0) return null;

  return (
    <div
      className="px-5 pb-4 pt-2 flex-shrink-0"
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
            border: `2px dashed ${targetColor}`,
            margin: '4px',
          }}
        >
          <span
            className="text-xs font-mono font-bold uppercase tracking-wider"
            style={{ color: targetColor }}
          >
            Drop images here
          </span>
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mb-1.5">
          <div
            ref={chipRowRef}
            className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1"
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
                      ? `color-mix(in srgb, ${targetColor} 15%, transparent)`
                      : 'var(--surface-inset)',
                    border: `1.5px solid ${isSelected ? targetColor : 'var(--border)'}`,
                    outline: 'none',
                  }}
                >
                  <img
                    src={att.url}
                    alt={`Image ${i + 1}`}
                    className="rounded-sm object-cover flex-shrink-0"
                    style={{ width: 28, height: 28 }}
                  />
                  <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                    #{i + 1}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAttachment(att.id);
                    }}
                    className="w-4 h-4 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
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

      {/* Input row: @target selector + text input + send */}
      <div className="flex items-center gap-2">
        {/* Target agent picker */}
        <div className="relative flex-shrink-0" ref={pickerRef}>
          <button
            onClick={() => setShowTargetPicker((v) => !v)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-sm transition-colors"
            style={{
              border: '1px solid var(--border)',
              background: showTargetPicker
                ? 'color-mix(in srgb, var(--accent) 5%, transparent)'
                : 'transparent',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: targetColor }}
            />
            <span
              className="text-[10px] font-mono font-bold truncate max-w-[80px]"
              style={{ color: targetColor }}
            >
              @{targetAgent ? targetAgent.name : 'all'}
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
          </button>

          {showTargetPicker && (
            <div
              className="absolute bottom-full left-0 mb-1 w-44 rounded-sm overflow-hidden z-20"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              {/* All agents option */}
              <button
                onClick={() => {
                  setSelectedAgent(null);
                  setShowTargetPicker(false);
                }}
                className="w-full px-3 py-2 flex items-center gap-2 text-left transition-colors"
                style={{
                  background:
                    selectedAgentId === null
                      ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                      : 'transparent',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: 'var(--accent)' }}
                />
                <span className="text-[10px] font-mono text-muted-foreground">
                  All agents
                </span>
              </button>

              {/* Per-agent options */}
              {agents.map((agent) => {
                const color = getAgentColor(agent.name, agent.role);
                const isTarget = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => {
                      setSelectedAgent(agent.id);
                      setShowTargetPicker(false);
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left transition-colors"
                    style={{
                      background: isTarget
                        ? `color-mix(in srgb, ${color} 10%, transparent)`
                        : 'transparent',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                    <span
                      className="text-[10px] font-mono font-bold"
                      style={{ color }}
                    >
                      {agent.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Text input */}
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="flex-1"
          style={
            {
              '--aug-tl': '8px',
              '--aug-br': '8px',
              '--aug-border-all': '1px',
              '--aug-border-bg': targetColor,
            } as React.CSSProperties
          }
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
              style={{ color: targetColor }}
            >
              &gt;
            </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                targetAgent
                  ? `Message ${targetAgent.name}...`
                  : 'Message all agents...'
              }
              className="w-full bg-transparent text-foreground font-mono text-sm px-2 py-2.5 placeholder:text-muted-foreground placeholder:select-none focus:outline-none selection:bg-accent/20 selection:text-foreground"
            />
          </div>
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          data-augmented-ui="tl-clip br-clip border"
          className="w-9 h-9 flex items-center justify-center transition-colors flex-shrink-0"
          style={
            {
              '--aug-tl': '6px',
              '--aug-br': '6px',
              '--aug-border-all': '1px',
              '--aug-border-bg': targetColor,
              color: targetColor,
            } as React.CSSProperties
          }
          title="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
