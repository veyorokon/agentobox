import { gql } from "@apollo/client"

/* ================================================================== */
/*  AGENT SUBSCRIPTIONS                                                 */
/*                                                                      */
/*  Not active during dev phase — defined here to document the         */
/*  real-time strategy and ensure the query shapes are ready.          */
/*                                                                      */
/*  agentChanged: fires when any agent field changes (status, cost,    */
/*  phase, etc). Backend pushes via Django Channels group_send.        */
/*  Dashboard receives and Apollo merges into normalized cache.        */
/* ================================================================== */

export const ON_AGENT_CHANGED = gql`
  subscription OnAgentChanged($projectId: ID!) {
    agentChanged(projectId: $projectId) {
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
