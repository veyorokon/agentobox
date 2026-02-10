/**
 * Deterministic agent identity colors.
 * Each agent gets a stable color derived from their name hash,
 * ensuring consistency across views and page refreshes.
 *
 * Lead agents always use the accent color.
 * Workers pick from a curated palette of 6 highly discriminable colors.
 */

const PALETTE = [
  'var(--agent-color-0)',
  'var(--agent-color-1)',
  'var(--agent-color-2)',
  'var(--agent-color-3)',
  'var(--agent-color-4)',
  'var(--agent-color-5)',
] as const;

/** djb2 hash — fast, deterministic, good distribution */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

export function getAgentColor(name: string, role?: string): string {
  if (role === 'lead') return 'var(--accent)';
  return PALETTE[djb2(name) % PALETTE.length];
}

export { PALETTE as AGENT_PALETTE };
