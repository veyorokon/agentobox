'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from 'urql';
import { toast } from 'sonner';
import { CREATE_AGENT_MUTATION } from '@/lib/graphql/mutations';
import { AGENT_OPTIONS_QUERY } from '@/lib/graphql/queries';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DeployAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function DeployAgentDialog({ open, onOpenChange, projectId }: DeployAgentDialogProps) {
  const [{ data: optionsData }] = useQuery({ query: AGENT_OPTIONS_QUERY });
  const models = optionsData?.availableModels ?? [];
  const mcpOptions = optionsData?.mcpRegistry ?? [];
  const [name, setName] = useState('');
  const [model, setModel] = useState<string>('claude-sonnet-4-5-20250929');
  const [role, setRole] = useState<'worker' | 'lead'>('worker');
  const [workspacePath, setWorkspacePath] = useState('');
  const [instructions, setInstructions] = useState('');
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [, executeCreate] = useMutation(CREATE_AGENT_MUTATION);

  const reset = useCallback(() => {
    setName('');
    setModel('claude-sonnet-4-5-20250929');
    setRole('worker');
    setWorkspacePath('');
    setInstructions('');
    setMcpServers([]);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const input: Record<string, unknown> = {
      projectId,
      name: trimmed,
      runtime: 'docker',
      model,
      role,
      workspacePath: workspacePath.trim(),
      instructions: instructions.trim(),
    };
    if (mcpServers.length > 0) {
      input.mcpServers = mcpServers;
    }

    const { error } = await executeCreate({ input });
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Agent "${trimmed}" deploying`);
    reset();
    onOpenChange(false);
  }, [name, projectId, model, role, workspacePath, instructions, mcpServers, executeCreate, reset, onOpenChange]);

  const toggleMcp = useCallback((value: string) => {
    setMcpServers((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Deploy Agent</DialogTitle>
          <DialogDescription className="text-xs">
            Create a new Docker agent for this project.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {/* Name */}
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name" className="text-xs font-mono">
              Name
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. backend, frontend, qa"
              className="text-sm font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              autoFocus
            />
          </div>

          {/* Model + Role row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-mono">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m: { value: string; label: string }) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs font-mono">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-mono">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'worker' | 'lead')}>
                <SelectTrigger className="text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker" className="text-xs font-mono">Worker</SelectItem>
                  <SelectItem value="lead" className="text-xs font-mono">Lead</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Workspace Path */}
          <div className="grid gap-1.5">
            <Label htmlFor="workspace-path" className="text-xs font-mono">
              Workspace Path
            </Label>
            <Input
              id="workspace-path"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder="/home/agent/workspace"
              className="text-xs font-mono"
            />
          </div>

          {/* Instructions */}
          <div className="grid gap-1.5">
            <Label htmlFor="instructions" className="text-xs font-mono">
              Instructions
            </Label>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Agent responsibilities..."
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          {/* MCP Servers */}
          {mcpOptions.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-mono">MCP Servers</Label>
              <div className="flex gap-2">
                {mcpOptions.map((opt: { name: string }) => (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => toggleMcp(opt.name)}
                    className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border transition-colors ${
                      mcpServers.includes(opt.name)
                        ? 'border-accent text-accent bg-accent/10'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.name}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-wider text-accent border border-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            data-augmented-ui="tl-clip br-clip border"
            style={{
              '--aug-tl': '4px',
              '--aug-br': '4px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'var(--accent)',
            } as React.CSSProperties}
          >
            Deploy
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
