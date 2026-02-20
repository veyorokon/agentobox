import { gql } from 'urql';
import { AGENT_FIELDS_FRAGMENT } from './fragments';

export const AGENT_UPDATED_SUBSCRIPTION = gql`
  subscription AgentUpdated($projectId: ID!) {
    agentUpdated(projectId: $projectId) {
      ...AgentFields
    }
  }
  ${AGENT_FIELDS_FRAGMENT}
`;

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
`;

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
`;
