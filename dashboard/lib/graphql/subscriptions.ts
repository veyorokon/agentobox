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

/**
 * Unified event stream — replaces messageReceived + newEvent + timelineStream.
 * Single subscription for all StreamEvent broadcasts.
 */
export const EVENT_STREAM_SUBSCRIPTION = gql`
  ${TIMELINE_FIELDS}
  subscription EventStream($projectId: ID!) {
    eventStream(projectId: $projectId) {
      ...TimelineFields
    }
  }
`
