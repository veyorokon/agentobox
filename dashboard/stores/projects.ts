import { create } from 'zustand';
import type { Project } from '@/types';

interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string | null) => void;
  getProject: (id: string) => Project | undefined;
  createProject: (name: string) => void;
  deleteProject: (id: string) => void;
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  projects: [],
  currentProjectId: null,

  setProjects: (projects) => set({ projects }),

  setCurrentProject: (id) => set({ currentProjectId: id }),

  getProject: (id) => get().projects.find((p) => p.id === id),

  createProject: (name) =>
    set((state) => ({
      projects: [
        ...state.projects,
        {
          id: `project-${Date.now()}`,
          name,
          agents: [],
          agentoOnline: true,
          lastActivity: new Date().toISOString(),
        },
      ],
    })),

  deleteProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    })),
}));
