import { gql } from "@apollo/client"
import { AGENT_FIELDS, TIMELINE_FIELDS } from "./fragments"

export const AGENT_UPDATED_SUBSCRIPTION = gql`
  ${AGENT_FIELDS}
  subscription AgentUpdated($projectId: ID!) {
    agentUpdated(projectId: $projectId) {
      ...AgentFields
    }
  }
`

export const MESSAGE_RECEIVED_SUBSCRIPTION = gql`
  subscription MessageReceived($projectId: ID!) {
    messageReceived(projectId: $projectId) {
      id
      messageId
      agentId
      agentName
      role
      parts
      sessionId
      turnNumber
      createdAt
    }
  }
`

export const NEW_EVENT_SUBSCRIPTION = gql`
  subscription NewEvent($projectId: ID!) {
    newEvent(projectId: $projectId) {
      id
      eventType
      data
      agentId
      agentName
      createdAt
    }
  }
`

export const TIMELINE_STREAM_SUBSCRIPTION = gql`
  ${TIMELINE_FIELDS}
  subscription TimelineStream($projectId: ID!) {
    timelineStream(projectId: $projectId) {
      ...TimelineFields
    }
  }
`
