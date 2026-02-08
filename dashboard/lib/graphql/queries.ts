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
      transcriptPath
      permissionMode
      mcpServers
      createdAt
    }
  }
`;

export const EVENTS_QUERY = gql`
  query Events($projectId: ID!) {
    events(projectId: $projectId) {
      id
      eventType
      data
      agentId
      agentName
      createdAt
    }
  }
`;

export const AGENT_MESSAGES_QUERY = gql`
  query AgentMessages($agentId: ID!) {
    agent(agentId: $agentId) {
      id
      messages {
        id
        direction
        content
        createdAt
      }
    }
  }
`;
