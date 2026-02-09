/**
 * Messages store — keyed by messageId for idempotent upserts.
 *
 * Single upsert pattern: subscription pushes Message payloads,
 * store upserts by messageId. No dedup logic needed — messageId
 * is the stable key from Claude Code's msg_xxx identifier.
 *
 * @see docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
 * @see docs/CRUSH-ARCHITECTURE.md, "Message Model"
 */
import { create } from 'zustand';
import type { Message } from '@/types';

interface MessagesState {
  /** agentId -> messageId -> Message */
  byAgent: Record<string, Record<string, Message>>;
  /** Upsert a message (subscription or query hydration) */
  upsert: (message: Message) => void;
  /** Bulk set messages for an agent (initial query) */
  setMessages: (agentId: string, messages: Message[]) => void;
}

export const useMessagesStore = create<MessagesState>((set) => ({
  byAgent: {},

  upsert: (message) =>
    set((state) => {
      const agentMessages = state.byAgent[message.agentId] ?? {};
      return {
        byAgent: {
          ...state.byAgent,
          [message.agentId]: {
            ...agentMessages,
            [message.messageId]: message,
          },
        },
      };
    }),

  setMessages: (agentId, messages) =>
    set((state) => {
      const map: Record<string, Message> = {};
      for (const msg of messages) {
        map[msg.messageId] = msg;
      }
      return {
        byAgent: { ...state.byAgent, [agentId]: map },
      };
    }),
}));
