import { gql } from 'urql';

export const ME_QUERY = gql`
  query Me {
    me {
      id
      username
      email
    }
  }
`;

export const PROJECTS_QUERY = gql`
  query Projects {
    projects {
      id
      name
      createdAt
    }
  }
`;

export const AGENTS_QUERY = gql`
  query Agents($projectId: ID!) {
    agents(projectId: $projectId) {
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
      mcpServers
      workspacePath
      instructions
      sessionCostUsd
      capabilities
      createdAt
    }
  }
`;

export const AGENT_MESSAGES_QUERY = gql`
  query AgentMessages($agentId: ID!) {
    agent(agentId: $agentId) {
      id
      streamMessages {
        id
        messageId
        agentId
        sessionId
        role
        model
        parts
        usage
        parentToolUseId
        stopReason
        turnNumber
        createdAt
      }
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
      }
    }
  }
`;
