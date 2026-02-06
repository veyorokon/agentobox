import { create } from 'zustand';
import type { User } from '@/types';

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token:
    typeof window !== 'undefined'
      ? localStorage.getItem('auth-token')
      : null,
  user: null,

  setAuth: (token, user) => {
    localStorage.setItem('auth-token', token);
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem('auth-token');
    set({ token: null, user: null });
  },

  isAuthenticated: () => get().token !== null,
}));
