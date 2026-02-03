import type { AgentStatus } from '@/types';

// Bliss theme colors (base16-ocean) - raw hex values
export const BLISS = {
  // Base colors
  bg: '#2b303b',
  bgLight: '#343d46',
  bgLighter: '#3b404b',
  bgCard: '#333944',
  bgHover: '#363c4a',

  // Selection/borders
  selection: '#4f5b66',
  border: '#343d46',

  // Text colors
  fg: '#c0c5ce',
  fgMuted: '#65737e',

  // Accent colors
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#8fa1b3',
  magenta: '#b48ead',
  cyan: '#96b5b4',
  orange: '#e59758',
} as const;

// Status colors - only badges get color, cards stay dark with shadow depth
export const STATE_COLORS: Record<AgentStatus, {
  bg: string;
  text: string;
  border: string;
}> = {
  idle: {
    bg: 'bg-[#4f5b66]',
    text: 'text-[#65737e]',
    border: 'border-[#4f5b66]',
  },
  working: {
    bg: 'bg-[#96b5b4]',
    text: 'text-[#96b5b4]',
    border: 'border-[#96b5b4]',
  },
  completed: {
    bg: 'bg-[#a3be8c]',
    text: 'text-[#a3be8c]',
    border: 'border-[#a3be8c]',
  },
  blocked: {
    bg: 'bg-[#ebcb8b]',
    text: 'text-[#ebcb8b]',
    border: 'border-[#ebcb8b]',
  },
  dead: {
    bg: 'bg-[#bf616a]',
    text: 'text-[#bf616a]',
    border: 'border-[#bf616a]',
  },
} as const;

export const STATE_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  completed: 'Completed',
  blocked: 'Blocked',
  dead: 'Dead',
} as const;
