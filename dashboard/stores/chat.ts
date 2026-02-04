import { create } from 'zustand';
import type { ChatMessage } from '@/types';

interface ChatStore {
  messages: Record<string, ChatMessage[]>; // projectId -> messages
  setMessages: (projectId: string, messages: ChatMessage[]) => void;
  addMessage: (projectId: string, message: Omit<ChatMessage, 'id' | 'ts'>) => void;
  getMessages: (projectId: string) => ChatMessage[];
  clearMessages: (projectId: string) => void;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  messages: {},

  setMessages: (projectId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [projectId]: messages },
    })),

  addMessage: (projectId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [projectId]: [
          ...(state.messages[projectId] || []),
          {
            ...message,
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            ts: new Date().toISOString(),
          },
        ],
      },
    })),

  getMessages: (projectId) => get().messages[projectId] || [],

  clearMessages: (projectId) =>
    set((state) => ({
      messages: { ...state.messages, [projectId]: [] },
    })),
}));
