import { gql } from "@apollo/client"

/* ================================================================== */
/*  AGENT QUERIES                                                       */
/*                                                                      */
/*  The query shape is frontend-driven — it defines what the backend   */
/*  API must return. When the backend connects, its resolvers must     */
/*  conform to this shape, not the other way around.                   */
/*                                                                      */
/*  Fields are grouped by consumption:                                 */
/*  - Identity: id, name (used by every component)                    */
/*  - Status: lifecycleStatus, attentionLevel, phase (cards, badges)  */
/*  - Activity: task, liveAction, lastOutput (detail views)           */
/*  - Metrics: cost, duration, turns (headers, summaries)             */
/*  - Config: model, mode, instructions, tags, mcpServers, etc.       */
/* ================================================================== */

export const GET_AGENTS = gql`
  query GetAgents {
    agents {
      id
      name
      lifecycleStatus
      attentionLevel
      mode
      task
      cost
      duration
      model
      turns
      phase
      liveAction
      lastOutput
      tags
      instructions
      mcpServers
      runtime
      workspacePath
      todoProgress {
        done
        total
      }
    }
  }
`
