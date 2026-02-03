import { create } from 'zustand';
import type { ChatMessage } from '@/types';

interface ChatStore {
  messages: Record<string, ChatMessage[]>; // bentoId -> messages
  setMessages: (bentoId: string, messages: ChatMessage[]) => void;
  addMessage: (bentoId: string, message: Omit<ChatMessage, 'id' | 'ts'>) => void;
  getMessages: (bentoId: string) => ChatMessage[];
  clearMessages: (bentoId: string) => void;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  messages: {},

  setMessages: (bentoId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [bentoId]: messages },
    })),

  addMessage: (bentoId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [bentoId]: [
          ...(state.messages[bentoId] || []),
          {
            ...message,
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            ts: new Date().toISOString(),
          },
        ],
      },
    })),

  getMessages: (bentoId) => get().messages[bentoId] || [],

  clearMessages: (bentoId) =>
    set((state) => ({
      messages: { ...state.messages, [bentoId]: [] },
    })),
}));
