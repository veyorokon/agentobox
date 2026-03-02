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

export const SEARCH_MCP_REGISTRY = gql`
  query SearchMcpRegistry($query: String, $limit: Int, $cursor: String) {
    searchMcpRegistry(query: $query, limit: $limit, cursor: $cursor) {
      servers {
        name
        description
        version
        websiteUrl
        hasRemote
        packages {
          registryType
          identifier
          transportType
        }
      }
      nextCursor
    }
  }
`

export const GET_AGENTS = gql`
  query GetAgents($projectId: ID!) {
    agents(projectId: $projectId) {
      id
      name
      lifecycleStatus
      attentionLevel
      relayConnected
      mode
      task
      cost
      duration
      model
      turns
      phase
      liveAction
      lastOutput
      errorMessage
      tags
      instructions
      mcpServers
      runtime
      workspacePath
      taskProgress {
        done
        total
      }
    }
  }
`
