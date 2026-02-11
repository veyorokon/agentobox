import { gql } from 'urql';

export const AGENT_UPDATED_SUBSCRIPTION = gql`
  subscription AgentUpdated($projectId: ID!) {
    agentUpdated(projectId: $projectId) {
      id
      name
      role
      runtime
      sandboxId
      vncUrl
      status
      teamName
      sessionId
      model
      cwd
      permissionMode
      mcpServers
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

export const TIMELINE_STREAM_SUBSCRIPTION = gql`
  subscription TimelineStream($projectId: ID!) {
    timelineStream(projectId: $projectId) {
      id
      entryType
      agentId
      agentName
      summary
      data
      createdAt
    }
  }
`;
