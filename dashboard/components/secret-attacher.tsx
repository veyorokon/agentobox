'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { Plus, X, KeyRound, Trash2, Check, Loader2 } from 'lucide-react';
import { SECRET_GROUPS_QUERY } from '@/lib/graphql/queries';
import {
  CREATE_SECRET_GROUP_MUTATION,
  DELETE_SECRET_GROUP_MUTATION,
} from '@/lib/graphql/mutations';
import type { SecretGroup } from '@/types';

interface SecretKeyValue {
  key: string;
  value: string;
}

/**
 * SecretAttacher — select existing secret groups or create new ones.
 *
 * Existing groups are fetched from the backend and shown as toggleable cards.
 * New groups are created via mutation — secrets are encrypted server-side and
 * only key names are returned (never values).
 *
 * Props:
 *   projectId — current project ID (required for query + create mutation)
 *   selectedIds — IDs of secret groups attached to this agent
 *   onSelectionChange — called when selection changes
 */
export function SecretAttacher({
  projectId,
  selectedIds,
  onSelectionChange,
}: {
  projectId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKeys, setNewKeys] = useState<SecretKeyValue[]>([{ key: '', value: '' }]);

  const [{ data, fetching }] = useQuery({
    query: SECRET_GROUPS_QUERY,
    variables: { projectId },
    pause: !projectId,
  });
  const [, createMut] = useMutation(CREATE_SECRET_GROUP_MUTATION);
  const [, deleteMut] = useMutation(DELETE_SECRET_GROUP_MUTATION);

  const groups: SecretGroup[] = data?.secretGroups ?? [];

  const toggleGroup = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const handleDelete = async (id: string) => {
    onSelectionChange(selectedIds.filter((s) => s !== id));
    await deleteMut({ id });
  };

  const startCreate = () => {
    setCreating(true);
    setNewName('');
    setNewKeys([{ key: '', value: '' }]);
  };

  const cancelCreate = () => {
    setCreating(false);
    setNewName('');
    setNewKeys([{ key: '', value: '' }]);
  };

  const addKeyRow = () => {
    setNewKeys([...newKeys, { key: '', value: '' }]);
  };

  const updateKey = (idx: number, field: 'key' | 'value', val: string) => {
    const updated = [...newKeys];
    updated[idx] = { ...updated[idx], [field]: val };
    setNewKeys(updated);
  };

  const removeKeyRow = (idx: number) => {
    if (newKeys.length <= 1) return;
    setNewKeys(newKeys.filter((_, i) => i !== idx));
  };

  const saveGroup = async () => {
    const name = newName.trim();
    if (!name) return;
    const validKeys = newKeys.filter((k) => k.key.trim() && k.value.trim());
    if (validKeys.length === 0) return;

    const secrets: Record<string, string> = {};
    for (const kv of validKeys) {
      secrets[kv.key.trim().toUpperCase()] = kv.value.trim();
    }

    const { data: result } = await createMut({
      input: { projectId, name, secrets },
    });

    if (result?.createSecretGroup?.id) {
      // Auto-select newly created group
      onSelectionChange([...selectedIds, result.createSecretGroup.id]);
    }
    cancelCreate();
  };

  return (
    <div className="space-y-2">
      {/* Loading state */}
      {fetching && groups.length === 0 && (
        <div className="flex items-center gap-2 text-muted-foreground/50 text-[10px] font-mono py-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading secret groups...
        </div>
      )}

      {/* Existing groups (toggleable) */}
      {groups.map((group) => (
        <SecretGroupCard
          key={group.id}
          group={group}
          selected={selectedIds.includes(group.id)}
          onToggle={() => toggleGroup(group.id)}
          onDelete={() => handleDelete(group.id)}
        />
      ))}

      {/* Create new inline */}
      {creating ? (
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="p-3"
          style={{
            '--aug-tl': '8px',
            '--aug-br': '8px',
            '--aug-border-all': '1px',
            '--aug-border-bg': 'var(--accent)',
          } as React.CSSProperties}
        >
          {/* Group name */}
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="group name (e.g. supabase-prod)"
              className="flex-1 bg-transparent text-foreground font-mono text-xs focus:outline-none placeholder:text-muted-foreground/40"
              autoFocus
            />
          </div>

          {/* Key-value pairs */}
          <div className="space-y-1.5 mb-3">
            {newKeys.map((kv, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={kv.key}
                  onChange={(e) => updateKey(idx, 'key', e.target.value)}
                  placeholder="KEY"
                  className="w-[120px] bg-muted/30 text-foreground font-mono text-[11px] px-2 py-1.5 focus:outline-none placeholder:text-muted-foreground/30 rounded-sm"
                />
                <span className="text-muted-foreground/30 text-xs">=</span>
                <input
                  type="password"
                  value={kv.value}
                  onChange={(e) => updateKey(idx, 'value', e.target.value)}
                  placeholder="value"
                  className="flex-1 bg-muted/30 text-foreground font-mono text-[11px] px-2 py-1.5 focus:outline-none placeholder:text-muted-foreground/30 rounded-sm"
                />
                {newKeys.length > 1 && (
                  <button
                    onClick={() => removeKeyRow(idx)}
                    className="text-muted-foreground/40 hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={addKeyRow}
              className="text-muted-foreground hover:text-accent text-[9px] font-mono uppercase tracking-wider transition-colors"
            >
              + Add key
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={cancelCreate}
                className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveGroup}
                disabled={!newName.trim() || !newKeys.some((k) => k.key.trim() && k.value.trim())}
                className="text-accent text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-30 transition-opacity"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={startCreate}
          className="flex items-center gap-2 text-muted-foreground hover:text-accent text-[10px] font-mono uppercase tracking-wider transition-colors"
        >
          <Plus className="w-3 h-3" />
          Create secret group
        </button>
      )}
    </div>
  );
}

function SecretGroupCard({
  group,
  selected,
  onToggle,
  onDelete,
}: {
  group: SecretGroup;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-augmented-ui="tl-clip br-clip border"
      className="group cursor-pointer"
      onClick={onToggle}
      style={{
        '--aug-tl': '6px',
        '--aug-br': '6px',
        '--aug-border-all': '1px',
        '--aug-border-bg': selected ? 'var(--accent)' : 'var(--border)',
      } as React.CSSProperties}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            {selected ? (
              <Check className="w-3 h-3 text-accent" />
            ) : (
              <KeyRound className="w-3 h-3 text-muted-foreground" />
            )}
            <span className={`font-mono text-xs font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
              {group.name}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
            title="Delete secret group"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {group.keys.map((key) => (
            <span
              key={key}
              className="text-[9px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded"
            >
              {key}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
