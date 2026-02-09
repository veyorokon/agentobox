'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Send, Search, ChevronsLeft, ChevronsRight, Paperclip, X, ImageIcon } from 'lucide-react';
import { useMutation, useQuery } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { useTheme } from '@/lib/theme';
import { SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import { AGENT_MESSAGES_QUERY } from '@/lib/graphql/queries';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useEventsStore } from '@/stores/events';
import { RosterBadge } from './roster-badge';
import { PanelTabs, type PanelTab } from './panel-tabs';
import { EventFeed } from './event-feed';
import { ProjectSelector } from './project-selector';
import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent, AgentEvent, AgentMessage } from '@/types';

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_EVENTS: AgentEvent[] = [];

/* ── Spinner words (from Claude Code) ── */
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

/** Map PostToolUse tool_name to a human-readable activity label. */
function toolLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  const filePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : '';
  const filename = filePath ? filePath.split('/').pop() : '';
  const pattern = typeof toolInput?.pattern === 'string' ? toolInput.pattern : '';

  switch (toolName) {
    case 'Read': return filename ? `Reading ${filename}` : 'Reading file...';
    case 'Write': return filename ? `Writing ${filename}` : 'Writing file...';
    case 'Edit': return filename ? `Editing ${filename}` : 'Editing file...';
    case 'Bash': return 'Running command...';
    case 'Glob': return pattern ? `Searching for ${pattern}` : 'Searching files...';
    case 'Grep': return 'Searching code...';
    case 'WebFetch': return 'Fetching URL...';
    case 'WebSearch': return 'Searching web...';
    case 'Task': return 'Running sub-task...';
    case 'SendMessage': return 'Sending message...';
    case 'AskUserQuestion': return 'Asking question...';
    case 'NotebookEdit': return 'Editing notebook...';
    case 'TodoWrite': return 'Updating tasks...';
    case 'EnterPlanMode': return 'Planning...';
    default: return toolName ? `Using ${toolName}...` : 'Working...';
  }
}


export function CommandPanel({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { theme, setTheme, themes } = useTheme();
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length];

  const projectId = useProjectsStore((s) => s.currentProjectId);
  const allAgents = useAgentsStore((s) =>
    projectId ? (s.agents[projectId] ?? EMPTY_AGENTS) : EMPTY_AGENTS
  );
  const agents = useMemo(
    () => allAgents.filter((a) => a.status !== 'stopped'),
    [allAgents]
  );
  const events = useEventsStore((s) =>
    projectId ? (s.events[projectId] ?? EMPTY_EVENTS) : EMPTY_EVENTS
  );

  const [activeTab, setActiveTab] = useState<PanelTab>('feed');
  const [input, setInput] = useState('');
  const [feedFilter, setFeedFilter] = useState('');
  const [, sendMessageMut] = useMutation(SEND_MESSAGE_MUTATION);

  // Image attachment state
  const [attachments, setAttachments] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const [selectedChip, setSelectedChip] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  let nextAttachId = useRef(0);

  const switchTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab);
    setInput('');
    setFeedFilter('');
    setAttachments([]);
    setSelectedChip(-1);
  }, []);

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
          // Already in chip row, stay put
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

  // Focus chip when selectedChip changes
  useEffect(() => {
    if (selectedChip >= 0 && chipRowRef.current) {
      const chips = chipRowRef.current.querySelectorAll<HTMLElement>('[data-chip]');
      chips[selectedChip]?.focus();
    }
  }, [selectedChip]);

  const isAgentTab = activeTab !== 'feed';
  const selectedAgent = isAgentTab
    ? agents.find((a) => a.name === activeTab)
    : null;

  // Drag-and-drop handlers
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isAgentTab) return;
      e.preventDefault();
      setIsDragging(true);
    },
    [isAgentTab]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!isAgentTab) return;
      if (e.dataTransfer.files.length > 0) {
        addImages(e.dataTransfer.files);
      }
    },
    [isAgentTab, addImages]
  );

  const handleSend = async () => {
    const text = (activeTab === 'feed' ? feedFilter : input).trim();
    if (!text) return;

    // Check for @agent routing from any tab
    const atMatch = text.match(/^@(\S+)\s+([\s\S]+)/);
    if (atMatch) {
      const targetAgent = agents.find((a) => a.name === atMatch[1]);
      if (targetAgent) {
        setFeedFilter('');
        setInput('');
        try {
          await logger.withSpan('sendMessage', () =>
            sendMessageMut({
              input: { agentId: targetAgent.id, message: atMatch[2] },
            }).then(({ error }) => {
              if (error) throw error;
            })
          );
          switchTab(targetAgent.name);
        } catch {
          toast.error('Failed to send message');
        }
        return;
      }
    }

    // Normal send to current agent tab
    if (!selectedAgent) return;

    // Upload images to agent container, then build message with paths
    let fullMessage = text;
    if (attachments.length > 0) {
      const token = localStorage.getItem('auth-token');
      const backendUrl = (process.env.NEXT_PUBLIC_GRAPHQL_HTTP ?? 'http://localhost:8000/graphql').replace('/graphql', '');
      const uploadedPaths: string[] = [];
      for (const att of attachments) {
        try {
          const form = new FormData();
          form.append('file', att.file);
          const res = await fetch(`${backendUrl}/agents/${selectedAgent.id}/upload`, {
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
            agentId: selectedAgent.id,
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
      if (activeTab === 'feed' && !feedFilter.trim().startsWith('@')) return;
      handleSend();
    }
    // Up arrow → move focus to last chip
    if (e.key === 'ArrowUp' && attachments.length > 0) {
      e.preventDefault();
      setSelectedChip(attachments.length - 1);
    }
    // Left arrow at start of input → move focus to last chip
    if (
      e.key === 'ArrowLeft' &&
      attachments.length > 0 &&
      e.currentTarget.selectionStart === 0
    ) {
      e.preventDefault();
      setSelectedChip(attachments.length - 1);
    }
    // Right arrow at end of input → move focus to first chip
    if (
      e.key === 'ArrowRight' &&
      attachments.length > 0 &&
      e.currentTarget.selectionStart === e.currentTarget.value.length
    ) {
      e.preventDefault();
      setSelectedChip(0);
    }
  };

  const inputPrefix = activeTab === 'feed' ? '/' : '>';
  const inputPlaceholder =
    activeTab === 'feed'
      ? 'Filter or @agent message...'
      : `Message ${activeTab}...`;

  const inputBorderColor =
    isAgentTab && selectedAgent
      ? STATUS_COLOR_VAR[selectedAgent.status]
      : 'var(--border)';

  const inputAccentColor =
    isAgentTab && selectedAgent
      ? STATUS_COLOR_VAR[selectedAgent.status]
      : 'var(--accent)';

  if (collapsed) {
    return (
      <aside
        className="w-14 flex-shrink-0 flex flex-col items-center bg-surface py-4 gap-3 transition-all duration-200"
        style={{ borderRight: '1px solid var(--border)' }}
      >
        {/* Logo */}
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="w-9 h-9 flex items-center justify-center flex-shrink-0"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '2px',
            '--aug-border-bg': 'var(--accent)',
          } as React.CSSProperties}
        >
          <span className="text-accent font-bold text-sm">A</span>
        </div>

        {/* Divider */}
        <div className="w-6 h-px bg-border" />

        {/* Agent avatars */}
        <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto scrollbar-thin">
          {agents.map((agent) => {
            const color = STATUS_COLOR_VAR[agent.status];
            const isWorking = agent.status === 'running';
            return (
              <button
                key={agent.name}
                title={`${agent.name} — ${agent.status}`}
                onClick={() => {
                  onToggle();
                  switchTab(agent.name);
                }}
                data-augmented-ui="tl-clip br-clip border"
                className="w-9 h-9 flex items-center justify-center flex-shrink-0"
                style={{
                  '--aug-tl': '6px',
                  '--aug-br': '6px',
                  '--aug-border-all': '1.5px',
                  '--aug-border-bg': color,
                  background: isWorking ? 'var(--agent-glow)' : 'transparent',
                } as React.CSSProperties}
              >
                <span
                  className="text-[10px] font-bold uppercase"
                  style={{ color }}
                >
                  {agent.name.slice(0, 2)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Expand toggle */}
        <button
          onClick={onToggle}
          className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          title="Expand sidebar (⌘B)"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="w-[380px] flex-shrink-0 flex flex-col bg-surface transition-all duration-200"
      style={{ borderRight: '1px solid var(--border)' }}
    >
      {/* Panel Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-10 h-10 flex items-center justify-center"
              style={{
                '--aug-tl': '7px',
                '--aug-br': '7px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              <span className="text-accent font-bold text-lg">A</span>
            </div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              agentobox
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(nextTheme)}
              data-augmented-ui="tl-clip br-clip border"
              className="px-3 py-1.5 text-muted-foreground text-[10px] font-bold uppercase tracking-wider hover:text-foreground transition-colors"
              style={{
                '--aug-tl': '5px',
                '--aug-br': '5px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              {theme}
            </button>
            <button
              onClick={onToggle}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse sidebar (⌘B)"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
        <ProjectSelector />
      </div>

      {/* Agent Roster */}
      <div className="px-5 pb-3">
        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-2">
          Agents
        </p>
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <RosterBadge
              key={agent.name}
              agent={agent}
              isSelected={activeTab === agent.name}
              onClick={() => switchTab(agent.name)}
            />
          ))}
          {agents.length === 0 && (
            <p className="text-muted-foreground text-xs font-mono">
              No agents deployed
            </p>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <PanelTabs
        active={activeTab}
        selectedAgent={selectedAgent}
        onSelect={switchTab}
      />

      {/* Content Area */}
      <div
        key={activeTab}
        className="flex-1 overflow-y-auto scrollbar-thin"
        style={{ animation: 'panel-fade 0.15s ease-out' }}
      >
        {activeTab === 'feed' && (
          <EventFeed
            filter={feedFilter}
            onSelectAgent={switchTab}
          />
        )}
        {isAgentTab && selectedAgent && (
          <ChatView agent={selectedAgent} events={events} />
        )}
      </div>

      {/* Input Bar */}
      <div
        className="px-5 pb-5 pt-2"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          position: 'relative',
        }}
      >
        {/* Drag overlay */}
        {isDragging && isAgentTab && (
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

        {/* Live status line (running) or static context label (idle) */}
        {isAgentTab && selectedAgent && (
          selectedAgent.status === 'running' ? (
            <AgentStatusLine agent={selectedAgent} events={events} />
          ) : (
            <div className="flex items-center gap-2 mb-1.5 px-1">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: STATUS_COLOR_VAR[selectedAgent.status] }}
              />
              <span
                className="text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{ color: STATUS_COLOR_VAR[selectedAgent.status] }}
              >
                {selectedAgent.name} — {selectedAgent.status}
              </span>
            </div>
          )
        )}

        {/* Image chip row */}
        {isAgentTab && attachments.length > 0 && (
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

        {/* Hidden file input */}
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
              {/* Paperclip button (only on agent tabs) */}
              {isAgentTab && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="pl-2 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  title="Attach images"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
              )}
              <span
                className="font-mono text-sm pl-3 select-none font-bold"
                style={{ color: inputAccentColor }}
              >
                {inputPrefix}
              </span>
              <input
                ref={inputRef}
                type="text"
                value={activeTab === 'feed' ? feedFilter : input}
                onChange={(e) =>
                  activeTab === 'feed'
                    ? setFeedFilter(e.target.value)
                    : setInput(e.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder={inputPlaceholder}
                className="w-full bg-transparent text-foreground font-mono text-sm px-2 py-2.5 placeholder:text-muted-foreground placeholder:select-none focus:outline-none selection:bg-accent/20 selection:text-foreground"
              />
            </div>
          </div>
          {activeTab !== 'feed' || feedFilter.trim().startsWith('@') ? (
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
          ) : (
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-9 h-9 flex items-center justify-center text-muted-foreground"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <Search className="w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}


/* ── Live status line ── */

function AgentStatusLine({ agent, events }: { agent: Agent; events: AgentEvent[] }) {
  const [spinnerWord, setSpinnerWord] = useState(() =>
    SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
  );

  // Rotate spinner word every 4 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerWord(
        SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
      );
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Also rotate on new tool events
  const toolActivity = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (evt.agentId === agent.id && evt.eventType === 'PostToolUse') {
        const data = evt.data as {
          tool_name?: string;
          tool_input?: Record<string, unknown>;
        };
        return toolLabel(data.tool_name || '', data.tool_input);
      }
    }
    return null;
  }, [events, agent.id]);

  // Pick a new spinner word when tool activity changes
  useEffect(() => {
    if (toolActivity) {
      setSpinnerWord(
        SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
      );
    }
  }, [toolActivity]);

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
      {toolActivity && (
        <>
          <span className="text-muted-foreground/30 text-[9px] flex-shrink-0">|</span>
          <span className="text-[9px] font-mono text-muted-foreground truncate">
            {toolActivity}
          </span>
        </>
      )}
    </div>
  );
}


/** Parse message content, separating text from image attachment paths. */
function parseMessageContent(content: string): {
  text: string;
  attachments: string[];
} {
  const marker = '[Attached images';
  const idx = content.indexOf(marker);
  if (idx === -1) return { text: content, attachments: [] };

  const text = content.slice(0, idx).trimEnd();
  const attachBlock = content.slice(idx);
  const lines = attachBlock.split('\n').filter((l) => l.trim());
  // Skip the header line(s), collect file paths
  const attachments = lines
    .filter((l) => !l.startsWith('['))
    .map((l) => l.trim())
    .filter(Boolean);

  return { text, attachments };
}

/** Extract a short display name from a file path. */
function attachmentLabel(path: string): string {
  const name = path.split('/').pop() || path;
  // Truncate long filenames
  return name.length > 28 ? name.slice(0, 25) + '...' : name;
}


/* ── Chat view ── */

function ChatView({ agent, events }: { agent: Agent; events: AgentEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const processedRef = useRef<Set<number | string>>(new Set());

  // Fetch messages from backend (refetch on every mount + when agent goes idle)
  const [{ data }] = useQuery({
    query: AGENT_MESSAGES_QUERY,
    variables: { agentId: agent.id },
    requestPolicy: 'network-only',
  });

  // Sync query results
  useEffect(() => {
    if (data?.agent?.messages) {
      setMessages(data.agent.messages);
    }
  }, [data]);

  // Pick up new messages from event stream.
  // Scans ALL new events (not just the latest) to avoid missing outbound_message
  // events that arrive alongside other events in the same render batch.
  useEffect(() => {
    const newMsgs: AgentMessage[] = [];

    for (const evt of events) {
      if (processedRef.current.has(evt.id)) continue;
      processedRef.current.add(evt.id);

      if (evt.agentId !== agent.id) continue;
      if (
        evt.eventType !== 'inbound_message' &&
        evt.eventType !== 'outbound_message'
      )
        continue;

      const msg = evt.data as { message?: string };
      if (!msg.message) continue;

      newMsgs.push({
        id: `evt-${evt.id}`,
        direction:
          evt.eventType === 'inbound_message' ? 'inbound' : 'outbound',
        content: msg.message,
        createdAt: evt.createdAt || new Date().toISOString(),
      });
    }

    if (newMsgs.length > 0) {
      setMessages((prev) => {
        const seen = new Set(
          prev.map((m) => `${m.direction}:${m.content}`)
        );
        const unique = newMsgs.filter(
          (m) => !seen.has(`${m.direction}:${m.content}`)
        );
        return unique.length > 0 ? [...prev, ...unique] : prev;
      });
    }
  }, [events, agent.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const statusColor = STATUS_COLOR_VAR[agent.status];

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-5 py-12">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-mono font-bold"
            style={{ color: statusColor }}
          >
            {agent.name}
          </span>
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              color: statusColor,
              background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
            }}
          >
            {agent.status}
          </span>
        </div>
        <p className="text-muted-foreground/50 text-[10px] font-mono">
          Send a task to begin
          <span className="empty-cursor" />
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      {messages.map((msg) => {
        const isInbound = msg.direction === 'inbound';
        const time = new Date(msg.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={msg.id}
            className={`flex ${isInbound ? 'justify-end' : 'justify-start'}`}
            style={{
              animation:
                'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div className="max-w-[88%]">
              {/* Header: sender + time */}
              <div
                className={`flex items-center gap-2 mb-1 ${
                  isInbound ? 'justify-end' : 'justify-start'
                }`}
              >
                <span
                  className="text-[9px] font-mono font-bold uppercase tracking-wider"
                  style={{
                    color: isInbound ? 'var(--accent)' : statusColor,
                  }}
                >
                  {isInbound ? 'you' : agent.name}
                </span>
                <span className="text-muted-foreground/40 text-[9px] font-mono tabular-nums">
                  {time}
                </span>
              </div>

              {/* Message bubble */}
              {(() => {
                const { text, attachments: imgPaths } = parseMessageContent(msg.content);
                const bubbleColor = isInbound ? 'var(--accent)' : statusColor;
                return (
                  <div
                    data-augmented-ui="tl-clip br-clip border"
                    className={`px-3 py-2.5 ${
                      isInbound ? 'bg-accent/10' : 'bg-card'
                    }`}
                    style={{
                      '--aug-tl': '6px',
                      '--aug-br': '6px',
                      '--aug-border-all': '1px',
                      '--aug-border-bg': bubbleColor,
                    } as React.CSSProperties}
                  >
                    {text && (
                      <p className="text-foreground text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                        {text}
                      </p>
                    )}
                    {imgPaths.length > 0 && (
                      <div className={`flex flex-wrap gap-1.5 ${text ? 'mt-2' : ''}`}>
                        {imgPaths.map((path, j) => (
                          <div
                            key={j}
                            className="flex items-center gap-1.5 px-2 py-1 rounded"
                            style={{
                              background: `color-mix(in srgb, ${bubbleColor} 10%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${bubbleColor} 25%, transparent)`,
                            }}
                          >
                            <ImageIcon
                              className="w-3 h-3 flex-shrink-0"
                              style={{ color: bubbleColor }}
                            />
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {attachmentLabel(path)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
