import type { AgentStatus } from '@/types';

// Neo-brutalism state colors - use CSS variables
export const STATE_COLORS: Record<AgentStatus, {
  bg: string;
  text: string;
  border: string;
}> = {
  idle: {
    bg: 'bg-[var(--nb-white)]',
    text: 'text-[var(--nb-text-muted)]',
    border: 'border-[var(--nb-border)]',
  },
  working: {
    bg: 'bg-[var(--nb-cyan)]',
    text: 'text-[var(--nb-text)]',
    border: 'border-[var(--nb-border)]',
  },
  completed: {
    bg: 'bg-[var(--nb-green)]',
    text: 'text-[var(--nb-text)]',
    border: 'border-[var(--nb-border)]',
  },
  blocked: {
    bg: 'bg-[var(--nb-yellow)]',
    text: 'text-[var(--nb-text)]',
    border: 'border-[var(--nb-border)]',
  },
  dead: {
    bg: 'bg-[var(--nb-coral)]',
    text: 'text-[var(--nb-text-light)]',
    border: 'border-[var(--nb-border)]',
  },
} as const;

export const STATE_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  completed: 'Completed',
  blocked: 'Blocked',
  dead: 'Dead',
} as const;
