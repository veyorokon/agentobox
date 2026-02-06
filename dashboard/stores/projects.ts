import { create } from 'zustand';

interface ProjectsState {
  currentProjectId: string | null;
  setCurrentProject: (id: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  currentProjectId: null,
  setCurrentProject: (id) => set({ currentProjectId: id }),
}));
