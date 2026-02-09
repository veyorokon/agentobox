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
      teamName
      sessionId
      model
      cwd
      permissionMode
      workspacePath
      instructions
      sessionCostUsd
      capabilities
      createdAt
    }
  }
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
