/**
 * Agent identity color system.
 *
 * Uses OKLCH color space with golden-angle hue distribution for maximum
 * perceptual spread. Each theme controls lightness (L) and chroma (C)
 * via CSS custom properties --agent-l and --agent-c; hue is computed
 * from sequential index.
 *
 * Lead agents always use the accent color.
 * Workers are sorted alphabetically and assigned hues at golden-angle
 * intervals (137.508°), guaranteeing maximum visual distinction for
 * any number of agents.
 */

const GOLDEN_ANGLE = 137.508;

function agentOklch(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `oklch(var(--agent-l) var(--agent-c) ${hue.toFixed(1)}deg)`;
}

/**
 * Build a color map keyed by agent ID.
 *
 * Lead → var(--accent). Workers → OKLCH with golden-angle hues,
 * sequentially assigned by alphabetical name order for maximum spread.
 */
export function buildAgentColorMap(
  agents: { id: string; name: string; role?: string }[]
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const a of agents) {
    if (a.role === 'lead') {
      map[a.id] = 'var(--accent)';
    }
  }

  const workers = agents
    .filter((a) => a.role !== 'lead')
    .sort((a, b) => a.name.localeCompare(b.name));

  workers.forEach((a, i) => {
    map[a.id] = agentOklch(i);
  });

  return map;
}

// ── Hash-based fallback (for contexts without the full agent list) ──

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

/**
 * Single-agent color lookup (hash-based fallback).
 * Prefer buildAgentColorMap when the full agent list is available.
 */
export function getAgentColor(name: string, role?: string): string {
  if (role === 'lead') return 'var(--accent)';
  return agentOklch(djb2(name) % 32);
}
