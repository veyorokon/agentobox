/**
 * Skill notification system for agent cards
 * Tracks which skills have been dismissed per agent
 */

const STORAGE_KEY = "abox-dismissed-skills"

interface DismissedSkills {
  [agentId: string]: string[] // skillIds
}

function loadDismissed(): DismissedSkills {
  if (typeof window === "undefined") return {}
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveDismissed(data: DismissedSkills) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export function dismissSkillForAgent(agentId: string, skillId: string) {
  const dismissed = loadDismissed()
  if (!dismissed[agentId]) {
    dismissed[agentId] = []
  }
  if (!dismissed[agentId].includes(skillId)) {
    dismissed[agentId].push(skillId)
    saveDismissed(dismissed)
  }
}

export function isSkillDismissed(agentId: string, skillId: string): boolean {
  const dismissed = loadDismissed()
  return dismissed[agentId]?.includes(skillId) ?? false
}

export function getUndismissedSkills(agentId: string, skillIds: string[]): string[] {
  const dismissed = loadDismissed()
  const agentDismissed = dismissed[agentId] || []
  return skillIds.filter(id => !agentDismissed.includes(id))
}
