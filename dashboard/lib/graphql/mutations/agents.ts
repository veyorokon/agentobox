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

export const KILL_AGENT = gql`
  mutation KillAgent($agentId: ID!) {
    killAgent(agentId: $agentId)
  }
`

export const REMOVE_AGENT = gql`
  mutation RemoveAgent($agentId: ID!) {
    removeAgent(agentId: $agentId)
  }
`

export const HARD_RESTART_AGENT = gql`
  mutation HardRestartAgent($agentId: ID!) {
    hardRestartAgent(agentId: $agentId) {
      id
      lifecycleStatus
    }
  }
`

export const RESTART_AGENT = gql`
  mutation RestartAgent($agentId: ID!) {
    restartAgent(agentId: $agentId)
  }
`

export const UPDATE_AGENT_INSTRUCTIONS = gql`
  mutation UpdateAgentInstructions($input: UpdateAgentInstructionsInput!) {
    updateAgentInstructions(input: $input) {
      id
      instructions
    }
  }
`

export const UPDATE_AGENT_CONFIG = gql`
  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {
    updateAgentConfig(input: $input) {
      id
      model
      role
      tags
      mcpServers
    }
  }
`

export const CREATE_AGENT = gql`
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
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
