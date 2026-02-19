'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from 'urql';
import { ChevronRight, Plus, X, Save } from 'lucide-react';
import { useAgentsStore } from '@/stores/agents';
import { useAgentActions } from '@/hooks/use-agent-actions';
import { AGENT_OPTIONS_QUERY } from '@/lib/graphql/queries';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PopoverContent } from '@/components/ui/popover';

interface ModelEntry {
  value: string;
  label: string;
}

interface McpRegistryEntry {
  name: string;
  compat: string[];
}

interface ConfigPopoverProps {
  agentId: string;
}

// Strips Radix Select trigger down to bare text + chevron — no borders, no shadow, no background
const inlineSelectClasses =
  'inline-flex w-auto border-0 shadow-none rounded-none bg-transparent dark:bg-transparent dark:hover:bg-transparent px-0 py-0 text-[10px] font-mono font-bold tracking-wider gap-1 [&_svg]:size-2.5 [&_svg]:opacity-30 focus-visible:ring-0 focus-visible:ring-offset-0';

export function ConfigPopover({ agentId }: ConfigPopoverProps) {
  const agent = useAgentsStore((s) => s.agents[agentId]);
  const color = useAgentsStore((s) => s.agentColors[agentId]) ?? 'var(--accent)';
  const { updateInstructions, updateAgentConfig } = useAgentActions();

  const [{ data: optionsData }] = useQuery({ query: AGENT_OPTIONS_QUERY });
  const models: ModelEntry[] = optionsData?.availableModels ?? [];
  const registry: McpRegistryEntry[] = optionsData?.mcpRegistry ?? [];
  const registryNames = useMemo(() => new Set(registry.map((r) => r.name)), [registry]);

  // Local state — initialized from agent on mount/open
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [pendingRegistryMcps, setPendingRegistryMcps] = useState<string[] | null>(null);
  const [customMcps, setCustomMcps] = useState<Record<string, { url: string }>>({});
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [instDraft, setInstDraft] = useState('');
  const [instOpen, setInstOpen] = useState(false);

  // Reset local state when agent changes
  useEffect(() => {
    if (!agent) return;
    setPendingModel(null);
    setPendingRole(null);
    setPendingRegistryMcps(null);
    setAddingCustom(false);
    setCustomName('');
    setCustomUrl('');
    setInstDraft(agent.instructions || '');
    setInstOpen(false);

    // Derive custom MCPs from agent's current mcpServers (keys not in registry)
    const agentMcps = agent.mcpServers ?? {};
    const customs: Record<string, { url: string }> = {};
    for (const key of Object.keys(agentMcps)) {
      if (!registryNames.has(key)) {
        const entry = agentMcps[key] as Record<string, unknown>;
        customs[key] = { url: (entry?.url as string) ?? '' };
      }
    }
    setCustomMcps(customs);
  }, [agent?.id, registryNames]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agent) return null;

  // Current values (with pending overrides)
  const currentModel = pendingModel ?? agent.model;
  const currentRole = pendingRole ?? agent.role;

  // Derive which registry MCPs are currently enabled
  const agentMcpKeys = Object.keys(agent.mcpServers ?? {});
  const currentRegistryMcps = pendingRegistryMcps ?? agentMcpKeys.filter((k) => registryNames.has(k));

  // Check if any cold change is pending
  const hasColdChanges =
    pendingModel !== null ||
    pendingRole !== null ||
    pendingRegistryMcps !== null ||
    Object.keys(customMcps).length !== Object.keys(agent.mcpServers ?? {}).filter((k) => !registryNames.has(k)).length ||
    Object.keys(customMcps).some((k) => !(k in (agent.mcpServers ?? {})));

  const instDirty = instDraft !== (agent.instructions || '');

  // Capabilities info
  const caps = agent.capabilities;
  const version = caps?.version ?? '';
  const toolCount = caps?.tools?.length ?? 0;

  const toggleRegistryMcp = (name: string) => {
    const current = pendingRegistryMcps ?? agentMcpKeys.filter((k) => registryNames.has(k));
    const next = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    setPendingRegistryMcps(next);
  };

  const addCustomMcp = () => {
    const trimName = customName.trim();
    const trimUrl = customUrl.trim();
    if (!trimName || !trimUrl) return;
    setCustomMcps((prev) => ({ ...prev, [trimName]: { url: trimUrl } }));
    setCustomName('');
    setCustomUrl('');
    setAddingCustom(false);
  };

  const removeCustomMcp = (name: string) => {
    setCustomMcps((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    // Mark MCP changes as pending
    if (pendingRegistryMcps === null) {
      setPendingRegistryMcps(agentMcpKeys.filter((k) => registryNames.has(k)));
    }
  };

  const handleRestart = async () => {
    const config: {
      model?: string;
      role?: string;
      mcpRegistryNames?: string[];
      mcpCustomServers?: Record<string, { url: string }>;
    } = {};

    if (pendingModel !== null) config.model = pendingModel;
    if (pendingRole !== null) config.role = pendingRole;
    if (pendingRegistryMcps !== null || Object.keys(customMcps).length > 0) {
      config.mcpRegistryNames = currentRegistryMcps;
      if (Object.keys(customMcps).length > 0) {
        config.mcpCustomServers = customMcps;
      }
    }

    await updateAgentConfig(agentId, config);
  };

  const handleSaveInstructions = () => {
    updateInstructions(agentId, instDraft);
  };

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={8}
      className="border-none rounded-none shadow-none p-0 bg-transparent w-auto overflow-visible"
    >
      <div
        className="w-80 p-2.5 space-y-2"
        data-augmented-ui="tl-clip br-clip border"
        style={{
          '--aug-tl': '8px',
          '--aug-br': '8px',
          '--aug-border-all': '1px',
          '--aug-border-bg': color,
          background: 'var(--surface)',
        } as React.CSSProperties}
      >
        {/* Model + Role — inline selects on one row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[7px] font-mono text-muted-foreground/70 uppercase tracking-[0.15em]">
              model
            </span>
            <Select value={currentModel} onValueChange={(v) => setPendingModel(v)}>
              <SelectTrigger
                className={inlineSelectClasses}
                style={{ color, height: 'auto' }}
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-[10px] font-mono">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[7px] font-mono text-muted-foreground/70 uppercase tracking-[0.15em]">
              role
            </span>
            <Select value={currentRole} onValueChange={(v) => setPendingRole(v)}>
              <SelectTrigger
                className={inlineSelectClasses}
                style={{ color, height: 'auto' }}
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worker" className="text-[10px] font-mono">Worker</SelectItem>
                <SelectItem value="lead" className="text-[10px] font-mono">Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Separator */}
        <div className="h-px" style={{ background: `color-mix(in srgb, var(--foreground) 6%, transparent)` }} />

        {/* MCP toggles + custom entries */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {/* Registry toggles — augmented-ui chips matching agent chip style */}
            {registry.map((entry) => {
              const enabled = currentRegistryMcps.includes(entry.name);
              return (
                <button
                  key={entry.name}
                  onClick={() => toggleRegistryMcp(entry.name)}
                  className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-all"
                  data-augmented-ui="tl-clip br-clip border"
                  style={{
                    '--aug-tl': '3px',
                    '--aug-br': '3px',
                    '--aug-border-all': '1px',
                    '--aug-border-bg': enabled ? color : 'var(--border)',
                    color: enabled ? color : 'var(--muted-foreground)',
                    background: enabled
                      ? `color-mix(in srgb, ${color} 10%, transparent)`
                      : 'transparent',
                  } as React.CSSProperties}
                >
                  {entry.name}
                </button>
              );
            })}

            {/* Custom MCP entries — inline with registry chips */}
            {Object.entries(customMcps).map(([name]) => (
              <button
                key={name}
                onClick={() => removeCustomMcp(name)}
                className="group flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-all"
                data-augmented-ui="tl-clip br-clip border"
                style={{
                  '--aug-tl': '3px',
                  '--aug-br': '3px',
                  '--aug-border-all': '1px',
                  '--aug-border-bg': color,
                  color,
                  background: `color-mix(in srgb, ${color} 10%, transparent)`,
                } as React.CSSProperties}
              >
                {name}
                <X className="w-2 h-2 opacity-40 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>

          {/* Add custom MCP — inline form or trigger */}
          {addingCustom ? (
            <div className="flex gap-1.5 items-end">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="name"
                className="flex-1 min-w-0 bg-transparent text-[9px] font-mono px-1.5 py-0.5 focus:outline-none text-foreground placeholder:text-muted-foreground/25"
                style={{ borderBottom: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}
                autoFocus
              />
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="url"
                className="flex-[2] min-w-0 bg-transparent text-[9px] font-mono px-1.5 py-0.5 focus:outline-none text-foreground placeholder:text-muted-foreground/25"
                style={{ borderBottom: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustomMcp();
                  if (e.key === 'Escape') setAddingCustom(false);
                }}
              />
              <button
                onClick={addCustomMcp}
                disabled={!customName.trim() || !customUrl.trim()}
                className="text-[8px] font-mono font-bold uppercase tracking-wider px-1 transition-colors disabled:opacity-20"
                style={{ color }}
              >
                ok
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingCustom(true)}
              className="flex items-center gap-0.5 text-[8px] font-mono text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors uppercase tracking-wider"
            >
              <Plus className="w-2.5 h-2.5" />
              mcp
            </button>
          )}
        </div>

        {/* Separator */}
        <div className="h-px" style={{ background: `color-mix(in srgb, var(--foreground) 6%, transparent)` }} />

        {/* Instructions (collapsible) */}
        <div>
          <button
            onClick={() => setInstOpen(!instOpen)}
            className="flex items-center gap-1 text-[7px] font-mono text-muted-foreground/70 uppercase tracking-[0.15em] hover:text-muted-foreground/80 transition-colors"
          >
            <ChevronRight
              className="w-2.5 h-2.5 transition-transform"
              style={{ transform: instOpen ? 'rotate(90deg)' : 'none' }}
            />
            instructions
          </button>
          {instOpen && (
            <div className="mt-1.5 space-y-1">
              <textarea
                value={instDraft}
                onChange={(e) => setInstDraft(e.target.value)}
                rows={3}
                className="w-full bg-transparent text-[9px] font-mono px-1.5 py-1 resize-none focus:outline-none leading-relaxed text-muted-foreground/80"
                style={{ borderBottom: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}
              />
              {instDirty && (
                <button
                  onClick={handleSaveInstructions}
                  className="flex items-center gap-1 text-[8px] font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{ color }}
                >
                  <Save className="w-2.5 h-2.5" />
                  save
                </button>
              )}
            </div>
          )}
        </div>

        {/* System info (read-only) */}
        <div className="flex items-center gap-1.5 text-[7px] font-mono text-muted-foreground/50 uppercase tracking-wider">
          <span>{agent.permissionMode}</span>
          {version && (
            <>
              <span>·</span>
              <span>{version}</span>
            </>
          )}
          {toolCount > 0 && (
            <>
              <span>·</span>
              <span>{toolCount}t</span>
            </>
          )}
        </div>

        {/* Restart to apply (cold changes only) */}
        {hasColdChanges && (
          <button
            onClick={handleRestart}
            className="w-full text-[9px] font-mono font-bold uppercase tracking-[0.2em] py-1.5 transition-all"
            data-augmented-ui="tl-clip br-clip border"
            style={{
              '--aug-tl': '4px',
              '--aug-br': '4px',
              '--aug-border-all': '1px',
              '--aug-border-bg': color,
              color,
              background: `color-mix(in srgb, ${color} 8%, transparent)`,
            } as React.CSSProperties}
          >
            restart to apply
          </button>
        )}
      </div>
    </PopoverContent>
  );
}
