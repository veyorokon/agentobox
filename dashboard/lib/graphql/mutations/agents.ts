import { gql } from "@apollo/client"

/* ================================================================== */
/*  AGENT MUTATIONS                                                     */
/*                                                                      */
/*  Domain verbs, not CRUD. Each mutation maps to a user action.       */
/*  During dev phase: no network call, just cache.modify().            */
/*  Production: mutation fires to backend, optimistic update in cache, */
/*  subscription confirms the final state.                             */
/* ================================================================== */

export const SET_AGENT_MODE = gql`
  mutation SetAgentMode($agentId: ID!, $mode: String!) {
    setAgentMode(agentId: $agentId, mode: $mode) {
      id
      mode
    }
  }
`

export const RESOLVE_PERMISSION = gql`
  mutation ResolvePermission($feedItemId: ID!, $verdict: String!) {
    resolvePermission(feedItemId: $feedItemId, verdict: $verdict) {
      id
      permStatus
    }
  }
`

export const RESOLVE_PLAN = gql`
  mutation ResolvePlan($feedItemId: ID!, $verdict: String!) {
    resolvePlan(feedItemId: $feedItemId, verdict: $verdict) {
      id
      planStatus
    }
  }
`
