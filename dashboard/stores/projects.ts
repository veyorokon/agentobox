import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProjectsState {
  currentProjectId: string | null;
  setCurrentProject: (id: string | null) => void;
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set) => ({
      currentProjectId: null,
      setCurrentProject: (id) => set({ currentProjectId: id }),
    }),
    { name: 'projects-store' }
  )
);
