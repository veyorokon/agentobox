import { gql } from "@apollo/client"

/* ================================================================== */
/*  AGENT SUBSCRIPTIONS                                                 */
/*                                                                      */
/*  Not active during mock phase — defined here to document the        */
/*  real-time strategy and ensure the query shapes are ready.          */
/*                                                                      */
/*  agentUpdated: fires when any agent field changes (status, cost,    */
/*  phase, etc). Backend pushes via Django Channels group_send.        */
/*  Dashboard receives and Apollo merges into normalized cache.        */
/* ================================================================== */

export const ON_AGENT_UPDATED = gql`
  subscription OnAgentUpdated($projectId: ID!) {
    agentUpdated(projectId: $projectId) {
      id
      lifecycleStatus
      attentionLevel
      mode
      cost
      duration
      turns
      phase
      task
      liveAction
      todoProgress {
        done
        total
      }
    }
  }
`
