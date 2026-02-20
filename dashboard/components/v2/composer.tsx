'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Send, Paperclip, X, Loader2 } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useAgentActions } from '@/hooks/use-agent-actions';
import { AgentChipBar } from '@/components/v2/agent-chips';
import { ConfigPopover } from '@/components/v2/config-popover';
import { Popover, PopoverAnchor } from '@/components/ui/popover';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } };

interface Attachment {
  url: string;
  preview: string; // local object URL for thumbnail
}

const API_BASE =
  (process.env.NEXT_PUBLIC_GRAPHQL_HTTP ?? 'http://localhost:8000/graphql').replace(/\/graphql$/, '');

export function Composer() {
  const selectedAgentId = useDashboardStore((s) => s.selectedAgentId);

  const agents = useAgentsStore((s) => s.sortedAgents);
  const agentsMap = useAgentsStore((s) => s.agents);
  const colorMap = useAgentsStore((s) => s.agentColors);
  const { sendMessage } = useAgentActions();

  const [msgInput, setMsgInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Message history (shell-style up/down cycling)
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1); // -1 = not cycling
  const draftRef = useRef('');

  const leadAgent = useMemo(() => agents.find((a) => a.role === 'lead') ?? null, [agents]);
  const MAX_HEIGHT = 200;

  const hasContent = msgInput.trim().length > 0 || attachments.length > 0;

  // Close config popover when agent is deselected
  useEffect(() => {
    if (!selectedAgentId) setConfigOpen(false);
  }, [selectedAgentId]);

  // Parse @mentions from message input — supports @all for broadcast
  const { mentionedAgentIds, hasAtAll } = useMemo(() => {
    const mentionRegex = /@(\w[\w-]*)/g;
    const names = new Set<string>();
    let foundAll = false;
    let match;
    while ((match = mentionRegex.exec(msgInput)) !== null) {
      const name = match[1].toLowerCase();
      if (name === 'all') {
        foundAll = true;
      } else {
        names.add(name);
      }
    }
    if (foundAll) {
      return { mentionedAgentIds: agents.map((a) => a.id), hasAtAll: true };
    }
    return {
      mentionedAgentIds: agents.filter((a) => names.has(a.name.toLowerCase())).map((a) => a.id),
      hasAtAll: false,
    };
  }, [msgInput, agents]);

  const mentionedAgents = mentionedAgentIds.map((id) => agentsMap[id]).filter(Boolean);

  // Resolve target agents for sending
  const targetIds = useMemo(() => {
    // @mentions override everything
    if (mentionedAgentIds.length > 0) return mentionedAgentIds;
    // Agent chip selected → target that agent
    if (selectedAgentId) return [selectedAgentId];
    // Default → lead agent (matches Claude Code: user talks to lead, lead delegates)
    if (leadAgent) return [leadAgent.id];
    // Fallback: first agent
    return agents.length > 0 ? [agents[0].id] : [];
  }, [mentionedAgentIds, selectedAgentId, leadAgent, agents]);

  // Resolve the "active target" for display
  const targetAgents = useMemo(
    () => targetIds.map((id) => agentsMap[id]).filter(Boolean),
    [targetIds, agentsMap]
  );
  const isTargetingAll = targetIds.length >= agents.length && agents.length > 0;

  // Determine target color for the composer border
  const targetColor = useMemo(() => {
    if (targetAgents.length === 1) {
      return colorMap[targetAgents[0].id] ?? 'var(--accent)';
    }
    return 'var(--accent)';
  }, [targetAgents, colorMap]);

  // Dynamic placeholder
  const placeholder = useMemo(() => {
    if (isTargetingAll || hasAtAll) return 'Message all agents...';
    if (targetAgents.length === 1) return `Message ${targetAgents[0].name}...`;
    if (targetAgents.length > 1) {
      const names = targetAgents.map((a) => a.name).join(', ');
      return `Message ${names}...`;
    }
    return 'Message...';
  }, [isTargetingAll, hasAtAll, targetAgents]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    autoResize();
  }, [msgInput, autoResize]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    if (!hasContent) return;
    if (targetIds.length === 0) return;

    const content: ContentBlock[] = [];

    // Add image blocks first
    for (const att of attachments) {
      content.push({
        type: 'image',
        source: { type: 'url', url: att.url },
      });
    }

    // Add text block
    const text = msgInput.trim();
    if (text) {
      content.push({ type: 'text', text });
    }

    sendMessage(targetIds, content);

    // Push text to history (skip if duplicate of last entry)
    if (text && (historyRef.current.length === 0 || historyRef.current[historyRef.current.length - 1] !== text)) {
      historyRef.current.push(text);
    }
    historyIndexRef.current = -1;
    draftRef.current = '';

    // Reset
    setMsgInput('');
    attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    setAttachments([]);
  }, [hasContent, attachments, msgInput, targetIds, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (hasContent) handleSend();
      return;
    }

    const history = historyRef.current;
    if (history.length === 0) return;
    const el = textareaRef.current;

    if (e.key === 'ArrowUp') {
      // Only cycle when cursor is at position 0 (or input is empty)
      if (el && el.selectionStart !== 0) return;
      e.preventDefault();

      if (historyIndexRef.current === -1) {
        // Entering history — save current input as draft
        draftRef.current = msgInput;
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      }
      setMsgInput(history[historyIndexRef.current]);
    } else if (e.key === 'ArrowDown') {
      if (historyIndexRef.current === -1) return;
      e.preventDefault();

      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current += 1;
        setMsgInput(history[historyIndexRef.current]);
      } else {
        // Bottom of stack — restore draft
        historyIndexRef.current = -1;
        setMsgInput(draftRef.current);
      }
    }
  };

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setUploading(true);
    try {
      for (const file of imageFiles) {
        const formData = new FormData();
        formData.append('file', file);

        const token = localStorage.getItem('auth-token');
        const resp = await fetch(`${API_BASE}/media/upload`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });

        if (!resp.ok) {
          await resp.json().catch(() => ({}));
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }

        const { url } = await resp.json();
        const preview = URL.createObjectURL(file);
        setAttachments((prev) => [...prev, { url, preview }]);
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    await uploadFiles(files);
  }, [uploadFiles]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  }, []);

  return (
    <div
      className="relative z-10 px-4 pb-3 pt-6 flex-shrink-0 -mt-6"
      style={{
        background:
          'linear-gradient(to bottom, transparent 0%, var(--background) 24px)',
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      <Popover open={configOpen} onOpenChange={setConfigOpen}>
        <PopoverAnchor asChild>
          <div
            data-augmented-ui="bl-clip br-clip border"
            className="relative"
            style={{
              '--aug-bl': '10px',
              '--aug-br': '10px',
              '--aug-border-all': '1px',
              '--aug-border-bg': dragOver ? 'var(--accent)' : targetColor,
              background: 'var(--surface)',
            } as React.CSSProperties}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Drop zone overlay */}
            {dragOver && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 8%, var(--surface) 92%)',
                  border: '2px dashed var(--accent)',
                  borderRadius: '3px',
                }}
              >
                <span className="text-accent text-xs font-mono font-bold uppercase tracking-widest">
                  Drop images
                </span>
              </div>
            )}
            {/* Agent chip bar — targeting + filtering */}
            <div className="px-3 pt-2 pb-1 flex items-center gap-2">
              <AgentChipBar onOpenConfig={() => setConfigOpen(true)} />
              {mentionedAgents.length > 0 && (
                <span className="text-[7px] font-mono text-muted-foreground/30 uppercase tracking-widest flex-shrink-0">
                  via @mention
                </span>
              )}
            </div>

            {/* Attachment thumbnails */}
            {attachments.length > 0 && (
              <div className="flex gap-2 px-3 pt-1 flex-wrap">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={att.preview}
                      alt={`attachment ${i + 1}`}
                      className="h-14 w-14 object-cover rounded-sm"
                      style={{
                        border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                      }}
                    />
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid color-mix(in srgb, var(--foreground) 15%, transparent)',
                      }}
                    >
                      <X className="w-2.5 h-2.5 text-muted-foreground" />
                    </button>
                  </div>
                ))}
                {uploading && (
                  <div
                    className="h-14 w-14 rounded-sm flex items-center justify-center"
                    style={{
                      border: '1px dashed color-mix(in srgb, var(--accent) 30%, transparent)',
                    }}
                  >
                    <Loader2 className="w-3.5 h-3.5 text-muted-foreground/50 animate-spin" />
                  </div>
                )}
              </div>
            )}

            {/* Textarea */}
            <div className="px-3">
              <textarea
                ref={textareaRef}
                value={msgInput}
                onChange={(e) => {
                  setMsgInput(e.target.value);
                  // Any manual typing resets history cycling
                  historyIndexRef.current = -1;
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={1}
                className="w-full bg-transparent text-foreground font-mono text-sm resize-none placeholder:text-muted-foreground/25 placeholder:select-none focus:outline-none leading-relaxed"
                style={{ height: '24px', overflowY: 'hidden' }}
              />
            </div>

            {/* Bottom: actions */}
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <button
                className="text-muted-foreground/25 hover:text-muted-foreground/60 transition-colors disabled:opacity-30"
                title="Attach images"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-3">
                <span className="text-[9px] font-mono text-muted-foreground select-none tracking-wide">
                  {'\u21B5 send \u00B7 \u21E7\u21B5 newline'}
                </span>
                <button
                  onClick={handleSend}
                  disabled={!hasContent}
                  className="flex items-center justify-center transition-all duration-150 rounded-sm"
                  style={{
                    width: 28,
                    height: 28,
                    background: hasContent
                      ? `color-mix(in srgb, ${targetColor} 15%, transparent)`
                      : 'transparent',
                    color: hasContent ? targetColor : 'var(--muted-foreground)',
                    opacity: hasContent ? 1 : 0.2,
                  }}
                  title="Send"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </PopoverAnchor>
        {selectedAgentId && <ConfigPopover agentId={selectedAgentId} />}
      </Popover>
    </div>
  );
}
