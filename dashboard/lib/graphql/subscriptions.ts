import { gql } from 'urql';

export const AGENT_UPDATED_SUBSCRIPTION = gql`
  subscription AgentUpdated($projectId: ID!) {
    agentUpdated(projectId: $projectId) {
      id
      name
      runtime
      sandboxId
      vncUrl
      status
      confidence
      sentiment
      summary
      reasoning
      output
      createdAt
      completedAt
      goal {
        id
        text
        contextPath
        plan
        status
        createdAt
        satisfiedAt
      }
    }
  }
`;

export const NEW_EVENT_SUBSCRIPTION = gql`
  subscription NewEvent($projectId: ID!) {
    newEvent(projectId: $projectId) {
      id
      eventType
      data
      timestamp
      agent {
        id
        name
      }
    }
  }
`;
