import { gql } from "@apollo/client"

export const AGENT_FIELDS = gql`
  fragment AgentFields on AgentType {
    id
    name
    runtime
    sandboxId
    vncUrl
    status
    teamName
    parentSessionId
    sessionId
    model
    permissionMode
    mcpServers
    workspacePath
    volumeMounts
    instructions
    role
    sessionCostUsd
    capabilities
    createdAt
    phase
    sessionResult {
      id
      sessionId
      isError
      totalCostUsd
      durationMs
      durationApiMs
      numTurns
      modelUsage
      permissionDenials
      createdAt
      updatedAt
      agentId
    }
  }
`

export const TIMELINE_FIELDS = gql`
  fragment TimelineFields on TimelineEntryType {
    id
    entryType
    agentId
    agentName
    summary
    data
    createdAt
  }
`
