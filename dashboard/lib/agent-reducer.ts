import type { FakeAgent, AgentAction } from "@/lib/types"
import { INITIAL_AGENTS } from "@/lib/data/mock"

/* ================================================================== */
/*  AGENT REDUCER                                                      */
/*                                                                     */
/*  Pure reducer for agent state transitions.                          */
/*  Used by useReducer in the prototype and by useTeamStore.           */
/* ================================================================== */

export function agentReducer(state: FakeAgent[], action: AgentAction): FakeAgent[] {
  switch (action.type) {
    case "SET_LIFECYCLE":
      return state.map(a => a.id === action.agentId ? { ...a, lifecycleStatus: action.status } : a)
    case "SET_ATTENTION":
      return state.map(a => a.id === action.agentId ? { ...a, attentionLevel: action.level } : a)
    case "ACKNOWLEDGE":
      return state.map(a => a.id === action.agentId && a.attentionLevel === "review" ? { ...a, attentionLevel: "none" } : a)
    case "RESET":
      return INITIAL_AGENTS
    default:
      return state
  }
}
