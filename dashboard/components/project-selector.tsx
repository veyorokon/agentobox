'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from 'urql';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { useProjectsStore } from '@/stores/projects';
import { PROJECTS_QUERY } from '@/lib/graphql/queries';
import { CREATE_PROJECT_MUTATION } from '@/lib/graphql/mutations';
import type { Project } from '@/types';

export function ProjectSelector() {
  const currentProjectId = useProjectsStore((s) => s.currentProjectId);
  const setCurrentProject = useProjectsStore((s) => s.setCurrentProject);

  const [{ data, fetching }] = useQuery({ query: PROJECTS_QUERY });
  const [, createProject] = useMutation(CREATE_PROJECT_MUTATION);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const projects: Project[] = data?.projects ?? [];

  // Auto-select first project
  useEffect(() => {
    if (!currentProjectId && projects.length > 0) {
      setCurrentProject(projects[0].id);
    }
  }, [currentProjectId, projects, setCurrentProject]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const { data: result, error } = await createProject({
      input: { name },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (result?.createProject) {
      setCurrentProject(result.createProject.id);
      setNewName('');
      setShowCreate(false);
    }
  };

  if (fetching) {
    return (
      <div className="px-3 py-1.5 text-muted-foreground text-[10px] font-mono uppercase tracking-wider">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div
        data-augmented-ui="tl-clip br-clip border"
        style={{
          '--aug-tl': '5px',
          '--aug-br': '5px',
          '--aug-border-all': '1px',
          '--aug-border-bg': 'var(--border)',
        } as React.CSSProperties}
      >
        <select
          value={currentProjectId ?? ''}
          onChange={(e) => setCurrentProject(e.target.value)}
          className="bg-transparent text-foreground font-mono text-xs px-3 py-1.5 focus:outline-none appearance-none cursor-pointer pr-6"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id} className="bg-card text-foreground">
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {showCreate ? (
        <div className="flex items-center gap-1.5">
          <div
            data-augmented-ui="tl-clip br-clip border"
            style={{
              '--aug-tl': '5px',
              '--aug-br': '5px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'var(--border)',
            } as React.CSSProperties}
          >
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setShowCreate(false);
              }}
              placeholder="project name"
              className="bg-transparent text-foreground font-mono text-xs px-2 py-1.5 w-32 focus:outline-none placeholder:text-muted-foreground/40"
              autoFocus
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="text-accent text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-30"
          >
            Create
          </button>
          <button
            onClick={() => setShowCreate(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider hover:text-accent transition-colors"
        >
          + New
        </button>
      )}
    </div>
  );
}
