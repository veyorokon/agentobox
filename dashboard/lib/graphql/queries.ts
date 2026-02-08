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
      createdAt
    }
  }
`;
