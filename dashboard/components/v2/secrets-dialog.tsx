'use client';

import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from 'urql';
import { toast } from 'sonner';
import { Plus, Eye, EyeOff, Trash2, KeyRound } from 'lucide-react';
import { useAgentsStore } from '@/stores/agents';
import { RESTART_AGENT_MUTATION } from '@/lib/graphql/mutations';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PROJECT_SECRETS_QUERY } from '@/lib/graphql/queries';
import {
  SET_SECRET_MUTATION,
  DELETE_SECRET_MUTATION,
} from '@/lib/graphql/mutations';
import type { ProjectSecret } from '@/types';

interface SecretsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function SecretsDialog({ open, onOpenChange, projectId }: SecretsDialogProps) {
  const [{ data, fetching }, reexecute] = useQuery({
    query: PROJECT_SECRETS_QUERY,
    variables: { projectId },
    pause: !open,
  });
  const [, executeSet] = useMutation(SET_SECRET_MUTATION);
  const [, executeDelete] = useMutation(DELETE_SECRET_MUTATION);
  const [, executeRestart] = useMutation(RESTART_AGENT_MUTATION);
  const agents = useAgentsStore((s) => s.sortedAgents);

  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showValue, setShowValue] = useState(false);

  const secrets: ProjectSecret[] = data?.projectSecrets ?? [];

  const resetForm = useCallback(() => {
    setAdding(false);
    setNewKey('');
    setNewValue('');
    setShowValue(false);
  }, []);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const handleAdd = useCallback(async () => {
    const key = newKey.trim();
    if (!key) return;
    if (!newValue) {
      toast.error('Value is required');
      return;
    }

    const { error } = await executeSet({ input: { projectId, key, value: newValue } });
    if (error) {
      toast.error(error.message);
      return;
    }

    // Find running/idle agents that need a restart to pick up new env vars
    const restartable = agents.filter(
      (a) => a.status === 'running' || a.status === 'idle'
    );

    if (restartable.length > 0) {
      toast(`Secret "${key}" saved`, {
        description: `${restartable.length} agent${restartable.length !== 1 ? 's' : ''} with MCP servers need a restart to pick up changes.`,
        action: {
          label: 'Restart',
          onClick: () => {
            for (const a of restartable) executeRestart({ agentId: a.id });
            toast.success(`Restarting ${restartable.length} agent${restartable.length !== 1 ? 's' : ''}...`);
          },
        },
        duration: 8000,
      });
    } else {
      toast.success(`Secret "${key}" saved`);
    }

    resetForm();
    reexecute({ requestPolicy: 'network-only' });
  }, [newKey, newValue, projectId, executeSet, executeRestart, agents, resetForm, reexecute]);

  const handleDelete = useCallback(
    async (key: string) => {
      const { error } = await executeDelete({ projectId, key });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Secret "${key}" deleted`);
      reexecute({ requestPolicy: 'network-only' });
    },
    [projectId, executeDelete, reexecute]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent" />
            Secrets
          </DialogTitle>
          <DialogDescription className="text-xs">
            Encrypted key-value pairs injected into all agent environments. Manage per-agent scoping from agent config.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {/* Existing secrets */}
          {!adding && (
            <>
              {fetching && secrets.length === 0 && (
                <span className="text-xs font-mono text-muted-foreground">Loading...</span>
              )}
              {!fetching && secrets.length === 0 && (
                <div
                  className="px-3 py-4 rounded-sm text-center"
                  style={{
                    background: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--foreground) 6%, transparent)',
                  }}
                >
                  <span className="text-xs font-mono text-muted-foreground/60">
                    No secrets yet. Add one to get started.
                  </span>
                </div>
              )}
              {secrets.map((secret) => (
                <SecretRow
                  key={secret.id}
                  secret={secret}
                  onDelete={() => handleDelete(secret.key)}
                />
              ))}
            </>
          )}

          {/* Add form */}
          {adding && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-mono">Key</Label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  placeholder="e.g. ANTHROPIC_API_KEY"
                  className="text-sm font-mono"
                  autoFocus
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono">Value</Label>
                  <button
                    type="button"
                    onClick={() => setShowValue((v) => !v)}
                    className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    {showValue ? (
                      <EyeOff className="w-3 h-3" />
                    ) : (
                      <Eye className="w-3 h-3" />
                    )}
                    {showValue ? 'hide' : 'show'}
                  </button>
                </div>
                <Input
                  type={showValue ? 'text' : 'password'}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="secret value"
                  className="text-sm font-mono"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                  }}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={resetForm}
                  className="px-3 py-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newKey.trim()}
                  className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-wider text-accent border border-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  data-augmented-ui="tl-clip br-clip border"
                  style={{
                    '--aug-tl': '4px',
                    '--aug-br': '4px',
                    '--aug-border-all': '1px',
                    '--aug-border-bg': 'var(--accent)',
                  } as React.CSSProperties}
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Add new button */}
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 hover:text-accent transition-colors self-start"
            >
              <Plus className="w-3 h-3" />
              <span className="uppercase tracking-wider font-bold">Add secret</span>
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecretRow({
  secret,
  onDelete,
}: {
  secret: ProjectSecret;
  onDelete: () => void;
}) {
  const scopeLabel =
    secret.scopedAgentIds.length === 0
      ? 'all agents'
      : `${secret.scopedAgentIds.length} agent${secret.scopedAgentIds.length !== 1 ? 's' : ''}`;

  return (
    <div
      className="flex items-center justify-between px-3 py-2 rounded-sm group"
      style={{
        background: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
        border: '1px solid color-mix(in srgb, var(--foreground) 6%, transparent)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-foreground/80 truncate">
            {secret.key}
          </span>
          <span className="text-[8px] font-mono text-muted-foreground/40 tabular-nums flex-shrink-0">
            {scopeLabel}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
        <button
          onClick={onDelete}
          className="text-muted-foreground/30 hover:text-destructive transition-colors p-1"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
