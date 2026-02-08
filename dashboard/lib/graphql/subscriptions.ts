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
      transcriptPath
      permissionMode
      workspacePath
      instructions
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
