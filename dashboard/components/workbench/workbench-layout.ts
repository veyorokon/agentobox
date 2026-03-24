import type { WorkbenchAgent } from "@/components/workbench/terminal-workbench-prototype"

export type WorkbenchWindowSeed = {
  id: string
  agentId: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  maximized: boolean
  hidden: boolean
}

export function normalizeRequestedAgentIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of ids) {
    for (const part of raw.split(",")) {
      const value = part.trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      normalized.push(value)
    }
  }
  return normalized
}

export function buildInitialWorkbenchWindows(
  agents: readonly WorkbenchAgent[],
  requestedAgentIds: readonly string[],
): WorkbenchWindowSeed[] {
  const agentIds = normalizeRequestedAgentIds(requestedAgentIds)
  if (agentIds.length === 0) return []
  const agentsById = new Map(agents.map(agent => [agent.id, agent]))
  return agentIds.flatMap((agentId, index) => {
    if (!agentsById.has(agentId)) return []
    return [{
      id: `win-${agentId}`,
      agentId,
      x: 48 + (index % 3) * 118,
      y: 40 + index * 54,
      width: 720,
      height: 430,
      z: index + 1,
      minimized: false,
      maximized: false,
      hidden: false,
    }]
  })
}
