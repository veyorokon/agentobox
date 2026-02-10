'use client';

import type { Agent } from '@/types';

interface ConfigViewProps {
  agent: Agent;
}

export function ConfigView({ agent }: ConfigViewProps) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin px-5 py-5">
      <div className="max-w-3xl space-y-5">
        {/* Model */}
        <ConfigSection label="Model" value={agent.model} />

        {/* Instructions */}
        <ConfigSection
          label="Instructions"
          value={agent.instructions || '(none)'}
          multiline
        />

        {/* Workspace Path */}
        <ConfigSection label="Workspace Path" value={agent.workspacePath} />

        {/* MCP Servers */}
        <div>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-2">
            MCP Servers
          </p>
          {Object.keys(agent.mcpServers || {}).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(agent.mcpServers).map(([name, config]) => (
                <div
                  key={name}
                  data-augmented-ui="tl-clip br-clip border"
                  className="px-3 py-2"
                  style={{
                    '--aug-tl': '6px',
                    '--aug-br': '6px',
                    '--aug-border-all': '1px',
                    '--aug-border-bg': 'var(--border)',
                    background: 'var(--surface-inset)',
                  } as React.CSSProperties}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-foreground">
                      {name}
                    </span>
                  </div>
                  {config && typeof config === 'object' && (
                    <pre className="text-[10px] font-mono text-muted-foreground mt-1.5 whitespace-pre-wrap break-all">
                      {JSON.stringify(config, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="px-3 py-2"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
                background: 'var(--surface-inset)',
              } as React.CSSProperties}
            >
              <span className="text-xs font-mono text-muted-foreground/50">
                (none)
              </span>
            </div>
          )}
        </div>

        {/* Session Info */}
        <div className="grid grid-cols-2 gap-4">
          <ConfigSection label="Session ID" value={agent.sessionId} />
          <ConfigSection label="Sandbox ID" value={agent.sandboxId} />
        </div>

        {/* Runtime Info */}
        <div className="grid grid-cols-2 gap-4">
          <ConfigSection label="Runtime" value={agent.runtime} />
          <ConfigSection label="Permission Mode" value={agent.permissionMode} />
        </div>

        {/* CWD */}
        <ConfigSection label="Current Directory" value={agent.cwd} />

        {/* Cost */}
        {agent.sessionCostUsd !== null && (
          <ConfigSection
            label="Session Cost"
            value={`$${Number(agent.sessionCostUsd || 0).toFixed(4)}`}
          />
        )}

        {/* Capabilities */}
        {agent.capabilities && (
          <div>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-2">
              Capabilities
            </p>
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="px-3 py-2.5"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
                background: 'var(--surface-inset)',
              } as React.CSSProperties}
            >
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                    Tools
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {agent.capabilities.tools.map((tool) => (
                      <span
                        key={tool}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--background)',
                          color: 'var(--foreground)',
                        }}
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                    Version
                  </span>
                  <p className="text-xs font-mono text-foreground mt-1">
                    {agent.capabilities.version}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Created At */}
        <ConfigSection
          label="Created At"
          value={new Date(agent.createdAt).toLocaleString()}
        />
      </div>
    </div>
  );
}

function ConfigSection({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-2">
        {label}
      </p>
      <div
        data-augmented-ui="tl-clip br-clip border"
        className="px-3 py-2"
        style={{
          '--aug-tl': '6px',
          '--aug-br': '6px',
          '--aug-border-all': '1px',
          '--aug-border-bg': 'var(--border)',
          background: 'var(--surface-inset)',
        } as React.CSSProperties}
      >
        {multiline ? (
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
            {value}
          </pre>
        ) : (
          <span className="text-xs font-mono text-foreground">{value}</span>
        )}
      </div>
    </div>
  );
}
