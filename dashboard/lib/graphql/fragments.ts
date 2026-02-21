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
    cwd
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

export const FEED_ITEM_FIELDS = gql`
  fragment FeedItemFields on FeedItemType {
    id
    kind
    agentId
    agentName
    timestamp
    text
    imageUrls
    targetName
    tools {
      name
      input
      result
      isError
    }
    fromStatus
    toStatus
    taskSummary
    errorText
    cumulativeCostUsd
    questions {
      question
      header
      options {
        label
        description
      }
      multiSelect
    }
    memoryContent
    planStatus
    planSummary
    planSteps
    taskDividerSubject
    taskDividerId
    taskDividerActiveForm
    answers {
      selectedIndices
      otherText
    }
    toolUseId
    senderName
    targetAgentIds
  }
`

export const EVENT_FIELDS = gql`
  fragment EventFields on AgentEventType {
    id
    eventType
    data
    summary
    createdAt
    agentId
    agentName
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
